

// ============================================================================
// Client Supabase partagé — I Trade Academy AI
// ============================================================================
// Chargé via CDN dans chaque page :
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="js/supabase-client.js"></script>

// "var" (et non "const") volontairement : si ce script est chargé deux fois
// sur la même page (double <script src>, cache, etc.), "const" provoquerait
// un "Identifier has already been declared" qui casse tout le fichier.
var SUPABASE_URL = "https://lvghtaqhzssasmldmkqq.supabase.co";
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


