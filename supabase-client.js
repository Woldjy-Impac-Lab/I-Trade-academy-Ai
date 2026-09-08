// ============================================================================
// Client Supabase partagé — I Trade Academy AI
// ============================================================================
// Chargé via CDN dans chaque page :
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="js/supabase-client.js"></script>

// "var" (et non "const") volontairement : si ce script est chargé deux fois
// sur la même page (double <script src>, cache, etc.), "const" provoquerait
// un "Identifier has already been declared" qui casse tout le fichier.
var SUPABASE_URL = https://lvghtaqhzssasmldmkqq.supabase.co";
var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1woMQp6pTiZIG3lzMVdV7g_mfFdN0Rp";

// Garde en plus : ne recrée pas le client s'il existe déjà.
var supabase = (window.__itradeSupabaseClient =
  window.__itradeSupabaseClient ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY));

// ----------------------------------------------------------------------------
// Auth helpers
// ----------------------------------------------------------------------------

async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error) {
    console.error("Erreur lors du chargement du profil :", error);
    return null;
  }
  return data;
}

async function requireAuth(redirectTo = "login.html") {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = redirectTo;
    return null;
  }
  return user;
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "index.html";
}

// ----------------------------------------------------------------------------
// Structure académique
// ----------------------------------------------------------------------------

async function getLevelsWithCourses() {
  const { data, error } = await supabase
    .from("levels")
    .select(`
      id, name, order_index, price_usd, description,
      courses ( id, title, description, order_index,
        modules ( id, title, order_index,
          lessons ( id, title, order_index )
        )
      )
    `)
    .order("order_index");
  if (error) {
    console.error("Erreur lors du chargement des niveaux :", error);
    return [];
  }
  // Trie les sous-collections car Supabase ne garantit pas l'ordre imbriqué
  data.forEach(level => {
    level.courses.sort((a, b) => a.order_index - b.order_index);
    level.courses.forEach(course => {
      course.modules.sort((a, b) => a.order_index - b.order_index);
      course.modules.forEach(m => m.lessons.sort((a, b) => a.order_index - b.order_index));
    });
  });
  return data;
}

async function getUserLevelAccess(userId) {
  const { data, error } = await supabase
    .from("level_access")
    .select("level_id")
    .eq("user_id", userId);
  if (error) {
    console.error("Erreur lors du chargement des accès :", error);
    return ["debutant"];
  }
  return ["debutant", ...data.map(r => r.level_id)];
}

async function getUserCompletedLessonIds(userId) {
  const { data, error } = await supabase
    .from("lesson_progress")
    .select("lesson_id")
    .eq("user_id", userId);
  if (error) {
    console.error("Erreur lors du chargement de la progression :", error);
    return new Set();
  }
  return new Set(data.map(r => r.lesson_id));
}

// Récupère une leçon avec tout son contexte (module > cours > niveau),
// nécessaire pour vérifier l'accès et afficher le fil d'ariane.
async function getLessonWithContext(lessonId) {
  const { data, error } = await supabase
    .from("lessons")
    .select(`
      id, title, content, order_index, module_id,
      modules (
        id, title, order_index, course_id,
        courses (
          id, title, order_index, level_id,
          levels ( id, name, order_index, price_usd )
        )
      )
    `)
    .eq("id", lessonId)
    .single();
  if (error) {
    console.error("Erreur lors du chargement de la leçon :", error);
    return null;
  }
  return data;
}

// Toutes les leçons d'un même module, triées, pour la navigation précédent/suivant.
async function getModuleLessons(moduleId) {
  const { data, error } = await supabase
    .from("lessons")
    .select("id, title, order_index")
    .eq("module_id", moduleId)
    .order("order_index");
  if (error) {
    console.error("Erreur lors du chargement des leçons du module :", error);
    return [];
  }
  return data;
}

// Marque une leçon comme terminée pour l'utilisateur (idempotent).
async function markLessonComplete(userId, lessonId) {
  const { error } = await supabase
    .from("lesson_progress")
    .upsert({ user_id: userId, lesson_id: lessonId }, { onConflict: "user_id,lesson_id" });
  if (error) {
    console.error("Erreur lors de l'enregistrement de la progression :", error);
    return false;
  }
  return true;
}

// L'utilisateur a-t-il déjà terminé cette leçon précise ?
async function isLessonCompleted(userId, lessonId) {
  const { data, error } = await supabase
    .from("lesson_progress")
    .select("lesson_id")
    .eq("user_id", userId)
    .eq("lesson_id", lessonId)
    .maybeSingle();
  if (error) {
    console.error("Erreur lors de la vérification de la progression :", error);
    return false;
  }
  return !!data;
}

// ----------------------------------------------------------------------------
// Quiz et certificats
// ----------------------------------------------------------------------------

async function getCourseQuizContext(courseId) {
  const { data, error } = await supabase
    .from("courses")
    .select(`
      id, title, order_index, level_id,
      levels ( id, name, order_index, price_usd )
    `)
    .eq("id", courseId)
    .single();
  if (error) {
    console.error("Erreur lors du chargement du cours :", error);
    return null;
  }
  return data;
}

// Progression de leçons pour UN cours précis (pas tout le niveau).
async function getCourseLessonCompletion(userId, courseId) {
  const { data, error } = await supabase
    .from("courses")
    .select("id, modules ( id, lessons ( id ) )")
    .eq("id", courseId)
    .single();
  if (error) {
    console.error("Erreur lors du chargement des leçons du cours :", error);
    return { total: 0, done: 0 };
  }
  const lessonIds = [];
  data.modules.forEach(m => m.lessons.forEach(l => lessonIds.push(l.id)));
  const completed = await getUserCompletedLessonIds(userId);
  const done = lessonIds.filter(id => completed.has(id)).length;
  return { total: lessonIds.length, done };
}

async function getQuizQuestions(courseId) {
  const { data, error } = await supabase
    .from("quiz_questions")
    .select("id, question, choices, correct_choice_id, order_index")
    .eq("course_id", courseId)
    .order("order_index");
  if (error) {
    console.error("Erreur lors du chargement des questions du quiz :", error);
    return [];
  }
  return data;
}

// Enregistre une tentative de quiz + le détail des réponses, calcule le score.
// userAnswers : { [questionId]: choixChoisiId }
async function submitQuizAttempt(userId, courseId, questions, userAnswers) {
  let correctCount = 0;
  const graded = questions.map(q => {
    const chosen = userAnswers[q.id] || null;
    const isCorrect = chosen === q.correct_choice_id;
    if (isCorrect) correctCount++;
    return { question_id: q.id, chosen_choice_id: chosen, is_correct: isCorrect };
  });
  const scorePercent = questions.length
    ? Math.round((correctCount / questions.length) * 10000) / 100
    : 0;
  const passed = scorePercent >= 75;

  const { data: attempt, error: attemptError } = await supabase
    .from("quiz_attempts")
    .insert({ user_id: userId, course_id: courseId, score_percent: scorePercent, passed })
    .select()
    .single();
  if (attemptError) {
    console.error("Erreur lors de l'enregistrement de la tentative :", attemptError);
    return { scorePercent, passed, correctCount, total: questions.length, graded, saved: false };
  }

  const { error: answersError } = await supabase
    .from("quiz_answers")
    .insert(graded.map(g => ({ ...g, attempt_id: attempt.id })));
  if (answersError) {
    console.error("Erreur lors de l'enregistrement des réponses :", answersError);
  }

  return { scorePercent, passed, correctCount, total: questions.length, graded, saved: true };
}

async function hasUserPassedCourse(userId, courseId) {
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("id")
    .eq("user_id", userId)
    .eq("course_id", courseId)
    .eq("passed", true)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Erreur lors de la vérification des tentatives :", error);
    return false;
  }
  return !!data;
}

async function hasUserCompletedAllLessonsInLevel(userId, levelId) {
  const { data, error } = await supabase
    .from("levels")
    .select("id, courses ( id, modules ( id, lessons ( id ) ) )")
    .eq("id", levelId)
    .single();
  if (error) {
    console.error("Erreur lors du chargement du niveau :", error);
    return false;
  }
  const allLessonIds = [];
  data.courses.forEach(c => c.modules.forEach(m => m.lessons.forEach(l => allLessonIds.push(l.id))));
  const completed = await getUserCompletedLessonIds(userId);
  return allLessonIds.length > 0 && allLessonIds.every(id => completed.has(id));
}

async function hasUserPassedAllCoursesInLevel(userId, levelId) {
  const { data, error } = await supabase
    .from("courses")
    .select("id")
    .eq("level_id", levelId);
  if (error || !data || data.length === 0) return false;
  for (const c of data) {
    if (!(await hasUserPassedCourse(userId, c.id))) return false;
  }
  return true;
}

// Vérifie les conditions du niveau (toutes leçons + tous quiz réussis) et
// génère le certificat si nécessaire. Idempotent (unique sur user_id+level_id).
async function issueCertificateIfEligible(userId, levelId) {
  const [lessonsDone, coursesPassed] = await Promise.all([
    hasUserCompletedAllLessonsInLevel(userId, levelId),
    hasUserPassedAllCoursesInLevel(userId, levelId)
  ]);
  if (!lessonsDone || !coursesPassed) return { issued: false, eligible: false };

  const { data: existing } = await supabase
    .from("certificates")
    .select("id, certificate_uid, issued_at")
    .eq("user_id", userId)
    .eq("level_id", levelId)
    .maybeSingle();
  if (existing) return { issued: false, eligible: true, certificate: existing };

  const { data, error } = await supabase
    .from("certificates")
    .insert({ user_id: userId, level_id: levelId })
    .select()
    .single();
  if (error) {
    console.error("Erreur lors de la génération du certificat :", error);
    return { issued: false, eligible: true, error: true };
  }
  return { issued: true, eligible: true, certificate: data };
}

// ----------------------------------------------------------------------------
// Administration
// ----------------------------------------------------------------------------

// Enregistre une action admin dans admin_audit_log (best-effort : n'échoue pas
// bruyamment si le log échoue, car il ne doit jamais bloquer l'action elle-même).
async function logAdminAction(adminId, action, targetTable, targetId, details) {
  const { error } = await supabase.from("admin_audit_log").insert({
    admin_id: adminId,
    action,
    target_table: targetTable || null,
    target_id: targetId ? String(targetId) : null,
    details: details || null
  });
  if (error) console.error("Erreur lors de l'enregistrement de l'audit :", error);
}

async function getAdminAuditLog(limitCount) {
  const { data, error } = await supabase
    .from("admin_audit_log")
    .select("id, action, target_table, target_id, details, created_at, profiles ( email, full_name )")
    .order("created_at", { ascending: false })
    .limit(limitCount || 50);
  if (error) {
    console.error("Erreur lors du chargement du journal d'audit :", error);
    return [];
  }
  return data;
}

// ---- Statistiques ----

async function getPlatformStats() {
  const [
    { count: totalUsers },
    { data: profilesByLevel },
    { data: payments },
    { count: certificatesIssued },
    { count: lessonsCompletedTotal },
    { count: totalLessons }
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("current_level"),
    supabase.from("payments").select("amount_usd, status"),
    supabase.from("certificates").select("*", { count: "exact", head: true }),
    supabase.from("lesson_progress").select("*", { count: "exact", head: true }),
    supabase.from("lessons").select("*", { count: "exact", head: true })
  ]);

  const levelCounts = {};
  (profilesByLevel || []).forEach(p => {
    levelCounts[p.current_level] = (levelCounts[p.current_level] || 0) + 1;
  });

  const totalRevenue = (payments || [])
    .filter(p => p.status === "completed")
    .reduce((sum, p) => sum + Number(p.amount_usd), 0);

  const completionRate = (totalUsers && totalLessons)
    ? Math.round(((lessonsCompletedTotal || 0) / (totalUsers * totalLessons)) * 1000) / 10
    : 0;

  return {
    totalUsers: totalUsers || 0,
    levelCounts,
    totalRevenue,
    certificatesIssued: certificatesIssued || 0,
    lessonsCompletedTotal: lessonsCompletedTotal || 0,
    totalLessons: totalLessons || 0,
    completionRate
  };
}

// ---- Utilisateurs ----

async function getAllProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, current_level, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Erreur lors du chargement des utilisateurs :", error);
    return [];
  }
  return data;
}

// Supprime la progression (leçons + tentatives de quiz, qui entraîne la
// suppression en cascade des réponses de quiz) d'un utilisateur.
async function resetUserProgress(userId) {
  const [lessonRes, quizRes] = await Promise.all([
    supabase.from("lesson_progress").delete().eq("user_id", userId),
    supabase.from("quiz_attempts").delete().eq("user_id", userId)
  ]);
  if (lessonRes.error || quizRes.error) {
    console.error("Erreur lors de la réinitialisation :", lessonRes.error || quizRes.error);
    return false;
  }
  return true;
}

async function setUserRole(userId, role) {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) {
    console.error("Erreur lors du changement de rôle :", error);
    return false;
  }
  return true;
}

async function setUserLevel(userId, levelId) {
  const { error } = await supabase.from("profiles").update({ current_level: levelId }).eq("id", userId);
  if (error) {
    console.error("Erreur lors du changement de niveau :", error);
    return false;
  }
  return true;
}

// ---- Paiements ----

async function getAllPayments() {
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount_usd, provider, provider_reference, status, created_at, user_id, level_id, profiles ( email ), levels ( name )")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Erreur lors du chargement des paiements :", error);
    return [];
  }
  return data;
}

// Marque un paiement comme complété et accorde l'accès au niveau correspondant.
async function markPaymentCompletedAndGrantAccess(paymentId, userId, levelId) {
  const { error: payError } = await supabase
    .from("payments")
    .update({ status: "completed" })
    .eq("id", paymentId);
  if (payError) {
    console.error("Erreur lors de la mise à jour du paiement :", payError);
    return false;
  }
  const { error: accessError } = await supabase
    .from("level_access")
    .upsert({ user_id: userId, level_id: levelId }, { onConflict: "user_id,level_id" });
  if (accessError) {
    console.error("Erreur lors de l'attribution de l'accès :", accessError);
    return false;
  }
  return true;
}

// ---- Certificats ----

async function getAllCertificates() {
  const { data, error } = await supabase
    .from("certificates")
    .select("id, certificate_uid, issued_at, user_id, level_id, profiles ( email, full_name ), levels ( name )")
    .order("issued_at", { ascending: false });
  if (error) {
    console.error("Erreur lors du chargement des certificats :", error);
    return [];
  }
  return data;
}

async function revokeCertificate(certificateId) {
  const { error } = await supabase.from("certificates").delete().eq("id", certificateId);
  if (error) {
    console.error("Erreur lors de la révocation du certificat :", error);
    return false;
  }
  return true;
}

// ---- Contenu académique (cours / modules / leçons) ----

async function adminUpdateCourse(courseId, title, description) {
  const { error } = await supabase.from("courses").update({ title, description }).eq("id", courseId);
  return !error;
}

async function adminInsertCourse(levelId, title, description, orderIndex) {
  const { data, error } = await supabase
    .from("courses")
    .insert({ level_id: levelId, title, description, order_index: orderIndex })
    .select()
    .single();
  if (error) console.error("Erreur lors de la création du cours :", error);
  return data || null;
}

async function adminDeleteCourse(courseId) {
  const { error } = await supabase.from("courses").delete().eq("id", courseId);
  return !error;
}

async function adminUpdateModule(moduleId, title) {
  const { error } = await supabase.from("modules").update({ title }).eq("id", moduleId);
  return !error;
}

async function adminInsertModule(courseId, title, orderIndex) {
  const { data, error } = await supabase
    .from("modules")
    .insert({ course_id: courseId, title, order_index: orderIndex })
    .select()
    .single();
  if (error) console.error("Erreur lors de la création du module :", error);
  return data || null;
}

async function adminDeleteModule(moduleId) {
  const { error } = await supabase.from("modules").delete().eq("id", moduleId);
  return !error;
}

async function adminUpdateLesson(lessonId, title, content) {
  const { error } = await supabase.from("lessons").update({ title, content }).eq("id", lessonId);
  return !error;
}

async function adminInsertLesson(moduleId, title, content, orderIndex) {
  const { data, error } = await supabase
    .from("lessons")
    .insert({ module_id: moduleId, title, content, order_index: orderIndex })
    .select()
    .single();
  if (error) console.error("Erreur lors de la création de la leçon :", error);
  return data || null;
}

async function adminDeleteLesson(lessonId) {
  const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
  return !error;
}

// ----------------------------------------------------------------------------
// Paiement (checkout)
// ----------------------------------------------------------------------------

async function getLevelById(levelId) {
  const { data, error } = await supabase
    .from("levels")
    .select("id, name, order_index, price_usd, description")
    .eq("id", levelId)
    .single();
  if (error) {
    console.error("Erreur lors du chargement du niveau :", error);
    return null;
  }
  return data;
}

// Appelle une Supabase Edge Function déployée séparément (voir
// supabase/functions/) en transmettant automatiquement le jeton de
// l'utilisateur connecté. Retourne { data } ou { error }.
async function invokeEdgeFunction(name, body) {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      console.error(`Erreur lors de l'appel à la fonction "${name}" :`, error);
      return { error };
    }
    return { data };
  } catch (err) {
    console.error(`Exception lors de l'appel à la fonction "${name}" :`, err);
    return { error: err };
  }
}

// Vérifie périodiquement si l'accès au niveau a été accordé (utilisé après un
// retour de paiement, en attendant la confirmation asynchrone du webhook).
async function pollForLevelAccess(userId, levelId, maxTries, intervalMs) {
  for (let i = 0; i < (maxTries || 20); i++) {
    const access = await getUserLevelAccess(userId);
    if (access.includes(levelId)) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs || 3000));
  }
  return false;
}

// ----------------------------------------------------------------------------
// Communauté
// ----------------------------------------------------------------------------

async function getCommunityCategories() {
  const { data, error } = await supabase
    .from("community_categories")
    .select("id, name")
    .order("id");
  if (error) {
    console.error("Erreur lors du chargement des catégories :", error);
    return [];
  }
  return data;
}

// categoryId optionnel : sans filtre, retourne tous les sujets visibles
// (la RLS masque déjà automatiquement ceux marqués is_hidden pour les
// non-auteurs et non-admins).
async function getCommunityPosts(categoryId) {
  let query = supabase
    .from("community_posts")
    .select(`
      id, title, content, category_id, is_hidden, created_at, user_id,
      profiles ( email, full_name ),
      community_comments ( count )
    `)
    .order("created_at", { ascending: false });
  if (categoryId) query = query.eq("category_id", categoryId);
  const { data, error } = await query;
  if (error) {
    console.error("Erreur lors du chargement des sujets :", error);
    return [];
  }
  return data;
}

async function getCommunityPostDetail(postId) {
  const { data, error } = await supabase
    .from("community_posts")
    .select(`
      id, title, content, category_id, is_hidden, created_at, user_id,
      profiles ( email, full_name ),
      community_categories ( id, name )
    `)
    .eq("id", postId)
    .maybeSingle();
  if (error) {
    console.error("Erreur lors du chargement du sujet :", error);
    return null;
  }
  return data;
}

async function getCommunityComments(postId) {
  const { data, error } = await supabase
    .from("community_comments")
    .select("id, content, is_hidden, created_at, user_id, profiles ( email, full_name )")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Erreur lors du chargement des commentaires :", error);
    return [];
  }
  return data;
}

async function createCommunityPost(userId, categoryId, title, content) {
  const { data, error } = await supabase
    .from("community_posts")
    .insert({ user_id: userId, category_id: categoryId, title, content })
    .select()
    .single();
  if (error) {
    console.error("Erreur lors de la création du sujet :", error);
    return null;
  }
  return data;
}

async function createCommunityComment(userId, postId, content) {
  const { data, error } = await supabase
    .from("community_comments")
    .insert({ user_id: userId, post_id: postId, content })
    .select()
    .single();
  if (error) {
    console.error("Erreur lors de l'envoi du commentaire :", error);
    return null;
  }
  return data;
}

// ---- Modération (auteur ou admin) ----

async function setCommunityPostHidden(postId, hidden) {
  const { error } = await supabase.from("community_posts").update({ is_hidden: hidden }).eq("id", postId);
  return !error;
}

async function deleteCommunityPost(postId) {
  const { error } = await supabase.from("community_posts").delete().eq("id", postId);
  return !error;
}

async function setCommunityCommentHidden(commentId, hidden) {
  const { error } = await supabase.from("community_comments").update({ is_hidden: hidden }).eq("id", commentId);
  return !error;
}

async function deleteCommunityComment(commentId) {
  const { error } = await supabase.from("community_comments").delete().eq("id", commentId);
  return !error;
}

// ----------------------------------------------------------------------------
// Simulateur de trading
// ----------------------------------------------------------------------------

// Le simulateur se débloque quand le niveau Intermédiaire est terminé —
// l'existence d'un certificat pour ce niveau en est la preuve la plus directe.
async function getUserCertificateForLevel(userId, levelId) {
  const { data, error } = await supabase
    .from("certificates")
    .select("id, certificate_uid, issued_at")
    .eq("user_id", userId)
    .eq("level_id", levelId)
    .maybeSingle();
  if (error) {
    console.error("Erreur lors de la vérification du certificat :", error);
    return null;
  }
  return data;
}

// Crée le compte simulateur (solde de départ) s'il n'existe pas encore.
async function ensureSimulatorAccount(userId) {
  const { data: existing, error: fetchError } = await supabase
    .from("simulator_accounts")
    .select("user_id, virtual_balance, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchError) {
    console.error("Erreur lors du chargement du compte simulateur :", fetchError);
    return null;
  }
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("simulator_accounts")
    .insert({ user_id: userId })
    .select()
    .single();
  if (insertError) {
    console.error("Erreur lors de la création du compte simulateur :", insertError);
    return null;
  }
  return created;
}

async function updateSimulatorBalance(userId, newBalance) {
  const { error } = await supabase
    .from("simulator_accounts")
    .update({ virtual_balance: newBalance })
    .eq("user_id", userId);
  return !error;
}

async function resetSimulatorBalance(userId) {
  return updateSimulatorBalance(userId, 100000.0);
}

async function getOpenSimulatorTrades(userId) {
  const { data, error } = await supabase
    .from("simulator_trades")
    .select("*")
    .eq("user_id", userId)
    .is("closed_at", null)
    .order("opened_at", { ascending: false });
  if (error) {
    console.error("Erreur lors du chargement des positions ouvertes :", error);
    return [];
  }
  return data;
}

async function getClosedSimulatorTrades(userId, limitCount) {
  const { data, error } = await supabase
    .from("simulator_trades")
    .select("*")
    .eq("user_id", userId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(limitCount || 20);
  if (error) {
    console.error("Erreur lors du chargement de l'historique :", error);
    return [];
  }
  return data;
}

async function openSimulatorTrade(userId, instrument, side, quantity, entryPrice) {
  const { data, error } = await supabase
    .from("simulator_trades")
    .insert({
      user_id: userId,
      instrument,
      side,
      quantity,
      entry_price: entryPrice,
    })
    .select()
    .single();
  if (error) {
    console.error("Erreur lors de l'ouverture de la position :", error);
    return null;
  }
  return data;
}

async function closeSimulatorTrade(tradeId, exitPrice, feedback) {
  const { data, error } = await supabase
    .from("simulator_trades")
    .update({
      exit_price: exitPrice,
      closed_at: new Date().toISOString(),
      ai_feedback: feedback.summary,
      ai_feedback_good: feedback.good,
      ai_feedback_bad: feedback.bad,
      ai_feedback_lessons: feedback.lessons,
    })
    .eq("id", tradeId)
    .select()
    .single();
  if (error) {
    console.error("Erreur lors de la clôture de la position :", error);
    return null;
  }
  return data;
}

// Génère un retour d'expérience pédagogique par règles (pas d'appel IA
// externe dans cette version) à partir des paramètres du trade fermé.
// Retourne { summary, good: [...], bad: [...], lessons: [...] }.
function generateTradeFeedback({ side, quantity, entryPrice, exitPrice, openedAt, closedAt, balanceBeforeTrade }) {
  const pnl = side === "buy" ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
  const positionValue = entryPrice * quantity;
  const positionPercentOfBalance = balanceBeforeTrade > 0 ? (positionValue / balanceBeforeTrade) * 100 : 0;
  const pnlPercentOfBalance = balanceBeforeTrade > 0 ? (pnl / balanceBeforeTrade) * 100 : 0;
  const durationMinutes = (new Date(closedAt) - new Date(openedAt)) / 60000;

  const good = [];
  const bad = [];
  const lessons = [];

  if (positionPercentOfBalance <= 10) {
    good.push(`Taille de position raisonnable : environ ${positionPercentOfBalance.toFixed(1)}% du solde engagés sur ce trade.`);
  } else if (positionPercentOfBalance <= 25) {
    bad.push(`Position représentant ${positionPercentOfBalance.toFixed(1)}% du solde — plus élevée que ce qui est généralement recommandé pour un seul trade.`);
    lessons.push("Revois le calcul de taille de position vu au niveau Intermédiaire : la taille devrait découler du risque accepté, pas l'inverse.");
  } else {
    bad.push(`Position très importante : ${positionPercentOfBalance.toFixed(1)}% du solde exposés sur une seule transaction.`);
    lessons.push("Une position aussi large expose le compte à une perte disproportionnée en cas de mouvement défavorable, même modéré.");
  }

  if (pnl > 0) {
    good.push(`Trade clôturé en gain de +${pnl.toFixed(2)} $ (+${pnlPercentOfBalance.toFixed(2)}% du solde).`);
  } else if (pnl < 0) {
    bad.push(`Trade clôturé en perte de ${pnl.toFixed(2)} $ (${pnlPercentOfBalance.toFixed(2)}% du solde).`);
    if (Math.abs(pnlPercentOfBalance) > 5) {
      lessons.push("Cette perte dépasse largement la règle des 1-2% de risque par transaction — une taille de position plus petite l'aurait limitée.");
    }
  } else {
    good.push("Trade clôturé à l'équilibre, sans gain ni perte.");
  }

  if (durationMinutes < 2) {
    bad.push("Position fermée en moins de 2 minutes.");
    lessons.push("Une sortie très rapide mérite d'être vérifiée : répondait-elle à un critère défini à l'avance, ou à une réaction impulsive au mouvement du prix ?");
  }

  lessons.push("Compare ce trade à ton journal : la justification (objectif, signal identifié, risque accepté) avait-elle été notée avant l'ouverture de la position ?");

  const summary = pnl >= 0
    ? `Trade gagnant de ${pnl.toFixed(2)} $. ${good[0] || ""}`
    : `Trade perdant de ${Math.abs(pnl).toFixed(2)} $. ${bad[0] || ""}`;

  return { summary, good, bad, lessons, pnl };
}

// ----------------------------------------------------------------------------
// Journal de trading
// ----------------------------------------------------------------------------

async function getJournalEntries(userId) {
  const { data, error } = await supabase
    .from("trading_journal_entries")
    .select(`
      id, instrument, action, amount, goal, signal_identified, risk_accepted,
      entry_date, system_flags, trade_id,
      simulator_trades ( id, instrument, side, quantity, entry_price, exit_price, closed_at )
    `)
    .eq("user_id", userId)
    .order("entry_date", { ascending: false });
  if (error) {
    console.error("Erreur lors du chargement du journal :", error);
    return [];
  }
  return data;
}

// Trades clôturés du simulateur qui n'ont pas encore d'entrée de journal liée.
async function getJournalableClosedTrades(userId) {
  const [{ data: trades, error: tradesError }, { data: journaled, error: journaledError }] = await Promise.all([
    supabase
      .from("simulator_trades")
      .select("id, instrument, side, quantity, entry_price, exit_price, closed_at")
      .eq("user_id", userId)
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false }),
    supabase
      .from("trading_journal_entries")
      .select("trade_id")
      .eq("user_id", userId)
      .not("trade_id", "is", null),
  ]);
  if (tradesError) {
    console.error("Erreur lors du chargement des trades :", tradesError);
    return [];
  }
  const journaledIds = new Set((journaled || []).map(j => j.trade_id));
  return (trades || []).filter(t => !journaledIds.has(t.id));
}

async function createJournalEntry(userId, entry) {
  const { data, error } = await supabase
    .from("trading_journal_entries")
    .insert({
      user_id: userId,
      trade_id: entry.tradeId || null,
      instrument: entry.instrument,
      action: entry.action,
      amount: entry.amount || null,
      goal: entry.goal || null,
      signal_identified: entry.signalIdentified || null,
      risk_accepted: entry.riskAccepted || null,
      entry_date: entry.entryDate || new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    console.error("Erreur lors de la création de l'entrée de journal :", error);
    return null;
  }
  return data;
}

async function updateJournalEntry(entryId, entry) {
  const { error } = await supabase
    .from("trading_journal_entries")
    .update({
      instrument: entry.instrument,
      action: entry.action,
      amount: entry.amount || null,
      goal: entry.goal || null,
      signal_identified: entry.signalIdentified || null,
      risk_accepted: entry.riskAccepted || null,
    })
    .eq("id", entryId);
  return !error;
}

async function deleteJournalEntry(entryId) {
  const { error } = await supabase.from("trading_journal_entries").delete().eq("id", entryId);
  return !error;
}

async function setJournalEntryFlags(entryId, flags) {
  const { error } = await supabase
    .from("trading_journal_entries")
    .update({ system_flags: flags })
    .eq("id", entryId);
  return !error;
}

// Analyse par règles simples des habitudes de l'utilisateur à partir de son
// journal (aucun appel IA externe). Retourne :
//  - overall : liste de messages d'ensemble (à afficher en tête de page)
//  - perEntry : Map(entryId -> string[]) des drapeaux propres à chaque entrée
function analyzeJournalPatterns(entries) {
  const overall = [];
  const perEntry = new Map();
  const total = entries.length;
  if (total === 0) return { overall, perEntry };

  entries.forEach(e => perEntry.set(e.id, []));

  const missingGoal = entries.filter(e => !e.goal || !e.goal.trim());
  const missingSignal = entries.filter(e => !e.signal_identified || !e.signal_identified.trim());
  const missingRisk = entries.filter(e => !e.risk_accepted || !e.risk_accepted.trim());

  missingGoal.forEach(e => perEntry.get(e.id).push("Objectif non précisé"));
  missingSignal.forEach(e => perEntry.get(e.id).push("Signal non précisé"));
  missingRisk.forEach(e => perEntry.get(e.id).push("Risque accepté non précisé"));

  if (missingGoal.length / total >= 0.3) {
    overall.push(`L'objectif n'est pas renseigné dans ${missingGoal.length} entrée(s) sur ${total}. Noter l'objectif avant chaque transaction aide à distinguer une décision réfléchie d'une improvisation.`);
  }
  if (missingSignal.length / total >= 0.3) {
    overall.push(`Le signal identifié manque dans ${missingSignal.length} entrée(s) sur ${total}. Sans signal noté, il est difficile de savoir plus tard si une entrée répondait à une méthode ou à une impulsion.`);
  }
  if (missingRisk.length / total >= 0.3) {
    overall.push(`Le risque accepté n'est pas précisé dans ${missingRisk.length} entrée(s) sur ${total}. C'est justement l'information la plus utile pour repérer une prise de risque disproportionnée.`);
  }

  // Concentration des pertes par instrument, pour les entrées liées à un trade clôturé du simulateur.
  const lossCountByInstrument = {};
  const entryIdsByLossInstrument = {};
  entries.forEach(e => {
    const t = e.simulator_trades;
    if (t && t.exit_price != null) {
      const pnl = t.side === "buy"
        ? (t.exit_price - t.entry_price) * t.quantity
        : (t.entry_price - t.exit_price) * t.quantity;
      if (pnl < 0) {
        lossCountByInstrument[e.instrument] = (lossCountByInstrument[e.instrument] || 0) + 1;
        (entryIdsByLossInstrument[e.instrument] ||= []).push(e.id);
      }
    }
  });
  Object.entries(lossCountByInstrument).forEach(([instrument, count]) => {
    if (count >= 3) {
      overall.push(`${count} transactions liées à ${instrument} se sont soldées par une perte. Vérifie si ta méthode est réellement adaptée à cet instrument, ou si le contexte a changé.`);
      entryIdsByLossInstrument[instrument].forEach(id => perEntry.get(id).push(`Perte répétée sur ${instrument}`));
    }
  });

  return { overall, perEntry };
}
