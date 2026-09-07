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
