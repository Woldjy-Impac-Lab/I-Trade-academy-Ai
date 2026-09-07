// ============================================================================
// Client Supabase partagé — I Trade Academy AI
// ============================================================================
// Chargé via CDN dans chaque page :
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="js/supabase-client.js"></script>

// "var" (et non "const") volontairement : si ce script est chargé deux fois
// sur la même page (double <script src>, cache, etc.), "const" provoquerait
// un "Identifier has already been declared" qui casse tout le fichier.
var SUPABASE_URL = "https://scefzisfmsplrphtfzqt.supabase.co";
var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_20rfAUlYM17FDvI12C-zdw_jQCdED97";

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
// Communauté
// ----------------------------------------------------------------------------

// Filtre de modération automatique très simple, côté client : une liste de
// mots-clés interdits. Pour une modération automatique sérieuse, remplacer
// par un appel à une Edge Function utilisant une vraie API de modération de
// contenu (voir le modèle des fonctions de paiement dans supabase/functions/).
const COMMUNITY_FORBIDDEN_WORDS = [
  "arnaque garantie", "gain garanti à 100", "signal payant", "pyramide financière"
];

function containsForbiddenContent(text) {
  const lower = (text || "").toLowerCase();
  return COMMUNITY_FORBIDDEN_WORDS.some(word => lower.includes(word));
}

async function getCommunityCategories() {
  const { data, error } = await supabase
    .from("community_categories")
    .select("id, name");
  if (error) {
    console.error("Erreur lors du chargement des catégories :", error);
    return [];
  }
  return data;
}

async function getCommunityPosts(categoryId) {
  let query = supabase
    .from("community_posts")
    .select("id, title, content, is_hidden, created_at, user_id, category_id, profiles ( email, full_name ), community_categories ( name )")
    .order("created_at", { ascending: false });
  if (categoryId) query = query.eq("category_id", categoryId);
  const { data, error } = await query;
  if (error) {
    console.error("Erreur lors du chargement des sujets :", error);
    return [];
  }
  return data;
}

async function getPostDetail(postId) {
  const { data, error } = await supabase
    .from("community_posts")
    .select("id, title, content, is_hidden, created_at, user_id, category_id, profiles ( email, full_name ), community_categories ( name )")
    .eq("id", postId)
    .single();
  if (error) {
    console.error("Erreur lors du chargement du sujet :", error);
    return null;
  }
  return data;
}

async function getPostComments(postId) {
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

// Retourne { post, flagged } — flagged indique si le filtre de modération
// automatique a mis le sujet en attente (is_hidden = true) à la création.
async function createCommunityPost(userId, categoryId, title, content) {
  const flagged = containsForbiddenContent(title) || containsForbiddenContent(content);
  const { data, error } = await supabase
    .from("community_posts")
    .insert({ user_id: userId, category_id: categoryId, title, content, is_hidden: flagged })
    .select()
    .single();
  if (error) {
    console.error("Erreur lors de la création du sujet :", error);
    return { post: null, flagged: false, error };
  }
  return { post: data, flagged };
}

async function createComment(postId, userId, content) {
  const flagged = containsForbiddenContent(content);
  const { data, error } = await supabase
    .from("community_comments")
    .insert({ post_id: postId, user_id: userId, content, is_hidden: flagged })
    .select()
    .single();
  if (error) {
    console.error("Erreur lors de la publication du commentaire :", error);
    return { comment: null, flagged: false, error };
  }
  return { comment: data, flagged };
}

// Bascule la visibilité (masquer/afficher) — auteur ou admin selon les
// policies RLS "community_posts_update" / "community_comments_update".
async function setPostHidden(postId, hidden) {
  const { error } = await supabase.from("community_posts").update({ is_hidden: hidden }).eq("id", postId);
  return !error;
}

async function setCommentHidden(commentId, hidden) {
  const { error } = await supabase.from("community_comments").update({ is_hidden: hidden }).eq("id", commentId);
  return !error;
}

// Suppression définitive d'un sujet (auteur ou admin uniquement, voir policy
// "community_posts_delete"). Les commentaires n'ont pas de policy de
// suppression : on ne peut que les masquer, jamais les effacer définitivement.
async function deleteCommunityPost(postId) {
  const { error } = await supabase.from("community_posts").delete().eq("id", postId);
  return !error;
}
