# I Trade Academy AI

Plateforme d'éducation au trading pour débutants — HTML/CSS/JS vanilla + Supabase.

## Ce qui est fonctionnel dans ce livrable

- **Base de données complète** (`supabase/schema.sql`) : profils, niveaux/cours/modules/leçons,
  progression, quiz (20 questions/cours), certificats, paiements + accès par niveau, simulateur
  (comptes + trades), journal de trading, conversations Atlas, communauté, audit admin — avec
  Row Level Security sur chaque table (chacun ne voit que ses données ; les admins voient tout).
- **Authentification** (`signup.html`, `login.html`) : inscription, connexion, réinitialisation
  de mot de passe, via Supabase Auth. Un profil est créé automatiquement à l'inscription
  (trigger `handle_new_user`).
- **Landing page** (`index.html`) présentant les 4 niveaux et les fonctionnalités.
- **Tableau de bord étudiant** (`dashboard.html`) : affiche les niveaux, cours, modules et la
  progression réelle depuis Supabase, distingue les niveaux débloqués/verrouillés.

## Mise en route

1. **Base de données** : ouvre le SQL Editor de ton projet Supabase
   (`https://scefzisfmsplrphtfzqt.supabase.co`) et exécute tout le contenu de
   `supabase/schema.sql`. Il est idempotent (relançable sans erreur).
2. **Authentification par email** : dans Supabase, Authentication > Providers, active Email.
   Si tu veux que les comptes soient utilisables immédiatement sans confirmation par email
   (utile en développement), désactive "Confirm email" dans Authentication > Settings.
3. **Contenu académique** : le schéma crée les 4 niveaux mais pas encore les cours/modules/
   leçons (2 cours × 3 modules × 5 leçons par niveau, à écrire). Le plus rapide est d'insérer
   ce contenu directement en SQL ou via le futur tableau de bord admin.
4. **Servir les fichiers** : ce sont des pages statiques — n'importe quel serveur statique
   fonctionne (`npx serve .`, GitHub Pages, Vercel, Netlify...). Aucune étape de build.
5. Ouvre `index.html`, crée un compte, tu arrives sur `dashboard.html`.

## Ce qu'il reste à construire

Le schéma de données est déjà prêt pour tout ce qui suit — il s'agit d'ajouter les pages/
fonctions correspondantes :

- **Paiements** : intégrer Stripe ou PayPal. Le flux prévu : la page `checkout.html`
  (référencée par le dashboard mais pas encore créée) déclenche le paiement, puis un
  **webhook côté serveur** (Supabase Edge Function) confirme la transaction et insère
  la ligne dans `payments` + `level_access`. Ne jamais valider un paiement uniquement
  côté client — la clé publique Supabase actuelle ne permet pas d'écrire dans ces tables
  sans passer par une fonction serveur qui vérifie la signature du paiement.
- **Coach IA Atlas** : Edge Function Supabase qui reçoit la question (+ image de graphique
  optionnelle) et appelle une API IA (OpenAI ou équivalent) avec un system prompt qui lui
  interdit d'émettre des recommandations d'achat/vente directes. Stocke l'échange dans
  `coach_conversations` / `coach_messages`.
- **Simulateur de trading** : page qui lit/écrit dans `simulator_accounts` et
  `simulator_trades`. Le champ `ai_feedback_*` de `simulator_trades` est prévu pour recevoir
  l'explication post-transaction générée par Atlas.
- **Quiz** : page qui lit `quiz_questions`, enregistre la tentative dans `quiz_attempts` +
  `quiz_answers`, calcule le score et déclenche la génération du certificat (table
  `certificates`) si ≥ 75%.
- **Journal de trading** : formulaire lié à `trading_journal_entries` ; la détection des
  erreurs répétées (`system_flags`) peut être une simple requête SQL (regrouper par type
  d'erreur) ou passer par Atlas.
- **Communauté** : liste/formulaire sur `community_posts` / `community_comments`, filtrés
  par `community_categories`. La modération manuelle bascule `is_hidden` ; une modération
  automatique peut appeler une API de modération de contenu avant insertion.
- **Tableau de bord admin** : page réservée aux profils `role = 'admin'` (vérifié par la
  policy RLS `is_admin()`) pour gérer cours/modules/leçons, utilisateurs, paiements et
  consulter `admin_audit_log`.

## Sécurité — points à ne pas oublier

- La clé Supabase utilisée côté client est la clé **publique** (`publishable`) : c'est
  normal et sans danger, mais toute logique sensible (validation de paiement, attribution
  de rôle admin, calcul de score de quiz si tu veux éviter la triche) doit passer par une
  Edge Function côté serveur, jamais uniquement par le client.
- Le premier compte admin doit être créé manuellement : après inscription normale, exécute
  `update public.profiles set role = 'admin' where email = 'toi@exemple.com';` dans le SQL
  Editor.
