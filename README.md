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
  progression réelle depuis Supabase, distingue les niveaux débloqués/verrouillés, lien vers
  chaque leçon et vers le quiz une fois toutes les leçons d'un cours terminées.
- **Leçons** (`lesson.html`) : affiche le contenu d'une leçon, vérifie l'accès au niveau,
  navigation précédent/suivant, bouton "Marquer comme terminée".
- **Quiz** (`quiz.html`) : 20 questions par cours lues dynamiquement, correction, score,
  génération automatique du certificat de niveau quand les conditions sont réunies.
  Exécute `supabase/quiz-questions.sql` (après `schema.sql` et `seed-content.sql`) pour
  insérer les 160 questions (20 par cours × 8 cours, 4 choix chacune).
  ⚠️ Limite de sécurité connue : les bonnes réponses (`correct_choice_id`) sont lisibles par
  n'importe quel client authentifié via la policy RLS `quiz_questions_select_all`, et la
  correction est calculée côté client. Un utilisateur techniquement averti pourrait donc
  tricher en lisant la réponse dans les requêtes réseau. Pour un usage sérieux, il faudrait
  déplacer la correction vers une Edge Function côté serveur.
- **Administration** (`admin.html`) : réservée aux profils `role = 'admin'` (vérifié par la
  policy RLS `is_admin()` et par un contrôle côté client). Onglets : vue d'ensemble
  (statistiques), utilisateurs (réinitialiser la progression, changer le rôle), contenu
  académique (ajouter/modifier/supprimer cours, modules, leçons), paiements (valider
  manuellement un paiement et accorder l'accès au niveau), certificats (voir/révoquer),
  et journal d'audit (`admin_audit_log`, alimenté automatiquement par chaque action admin).
  Un lien "⚙ Administration" apparaît dans le tableau de bord étudiant pour les comptes admin.
- **Checkout** (`checkout.html`) : page de paiement manuel pour débloquer un niveau — MonCash,
  NatCash ou virement bancaire. L'utilisateur voit les coordonnées de réception (⚠️ à
  remplacer par les vraies dans les constantes `PAYMENT_METHODS` en haut du fichier), envoie
  le paiement lui-même, puis soumet la référence de transaction et, en option, une capture
  d'écran (déposée dans le bucket privé `payment-proofs`, voir
  `supabase/storage-payment-proofs-setup.sql`). Le paiement est créé en base avec le statut
  `pending`. Un administrateur confirme ensuite manuellement dans `admin.html` (onglet
  Paiements, bouton "Marquer complété + accès" — et "Voir la preuve" si une capture a été
  jointe), ce qui accorde l'accès au niveau. Le prix vient toujours de la table `levels`,
  jamais du client. Des Edge Functions Stripe/PayPal existent aussi dans `supabase/functions/`
  (voir leur README) si un processeur international devient utilisable plus tard, mais elles
  ne sont pas utilisées par ce flux manuel.
- **Communauté** (`community.html`, `community-post.html`) : sujets filtrables par catégorie
  (stratégies, questions techniques, journal de trading, général), création de sujet et de
  réponses, modération manuelle (masquer/réafficher/supprimer) accessible à l'auteur ou à un
  admin — chaque action de modération admin est aussi enregistrée dans `admin_audit_log`.
  ⚠️ Si ton projet Supabase a été initialisé **avant** cette mise à jour, exécute
  `supabase/patch-community-comments-delete.sql` une fois (idempotent) : `schema.sql`
  définissait une policy de suppression sur les sujets mais pas sur les commentaires ; c'est
  corrigé dans `schema.sql` pour les nouvelles installations. La modération automatique de
  contenu (appel à une API de modération avant publication) n'est pas implémentée.
- **Simulateur** (`simulator.html`) : se débloque quand le certificat du niveau Intermédiaire
  existe. Solde virtuel de départ (100 000 $, réinitialisable), 4 instruments crypto
  (BTC/ETH/SOL/DOGE) avec prix réels récupérés directement depuis le navigateur de
  l'utilisateur via l'API publique CoinGecko (aucune clé requise). Positions longues/courtes,
  P&L non réalisé en direct, et à la clôture de chaque position : une analyse pédagogique
  (bien fait / à améliorer / leçon à retenir) générée par des **règles simples côté client**
  (taille de position vs solde, ampleur du gain/perte, durée très courte de la position) —
  ce n'est pas encore Atlas (IA) : à terme, `generateTradeFeedback()` dans
  `js/supabase-client.js` pourrait être remplacée par un appel à une Edge Function faisant
  intervenir un vrai modèle de langage, sans changer le reste de la page.
- **Journal de trading** (`journal.html`) : chaque entrée peut être liée à une position
  clôturée du simulateur (préremplissage instrument/action/montant) ou saisie librement, avec
  objectif, signal identifié et risque accepté. `analyzeJournalPatterns()` (règles, pas d'IA)
  détecte des habitudes récurrentes — champs souvent laissés vides, concentration excessive
  sur un seul instrument, taux de perte plus élevé quand le risque n'était pas noté à
  l'avance — affichées en synthèse et, par entrée, dans `system_flags`.
- **Certificats** (`certificates.html`) : liste les certificats obtenus (nom, niveau, date,
  identifiant unique) avec un rendu imprimable/exportable en PDF via l'impression du
  navigateur (`window.print()` + CSS dédiée), sans dépendance externe.
- **Atlas — coach IA** (`atlas.html`) : conversations multiples, historique persistant
  (`coach_conversations` / `coach_messages`), upload d'image de graphique (bucket Storage
  `chart-images`, voir `supabase/storage-setup.sql`). Passe par l'Edge Function `atlas-chat`
  (voir `supabase/functions/README.md`) qui appelle une API IA multimodale (OpenAI par
  défaut) avec un system prompt imposant la règle centrale : **jamais de recommandation
  d'achat/vente directe**, toujours une explication pédagogique de la méthode. Sans cette
  fonction déployée (clé API IA requise), le chat affiche un message clair au lieu
  d'échouer silencieusement.

## Mise en route

1. **Base de données** : ouvre le SQL Editor de ton projet Supabase
   (`https://scefzisfmsplrphtfzqt.supabase.co`) et exécute tout le contenu de
   `supabase/schema.sql`. Il est idempotent (relançable sans erreur).
2. **Authentification par email** : dans Supabase, Authentication > Providers, active Email.
   Si tu veux que les comptes soient utilisables immédiatement sans confirmation par email
   (utile en développement), désactive "Confirm email" dans Authentication > Settings.
3. **Contenu académique** : le schéma crée les 4 niveaux. Exécute ensuite, dans cet ordre :
   - `supabase/seed-content.sql` : crée les 8 cours, 24 modules et 120 leçons (titres + résumé court).
   - `supabase/lesson-content-full.sql` : remplace le résumé court de chaque leçon par un
     paragraphe pédagogique complet (les 120 leçons ont un vrai contenu rédigé).
   Les deux scripts sont idempotents.
4. **Stockage des graphiques (Atlas)** : exécute `supabase/storage-setup.sql` pour créer le
   bucket `chart-images` utilisé quand un utilisateur joint un graphique dans le chat Atlas.
5. **Stockage des preuves de paiement** : exécute `supabase/storage-payment-proofs-setup.sql`
   pour créer le bucket privé `payment-proofs` (captures d'écran MonCash/NatCash/virement).
   Remplace aussi les placeholders (numéros, nom de banque) dans les constantes
   `PAYMENT_METHODS` en haut de `checkout.html`.
6. **Servir les fichiers** : ce sont des pages statiques — n'importe quel serveur statique
   fonctionne (`npx serve .`, GitHub Pages, Vercel, Netlify...). Aucune étape de build.
7. Ouvre `index.html`, crée un compte, tu arrives sur `dashboard.html`.

## Ce qu'il reste à construire

Le schéma de données est déjà prêt si tu veux ajouter, au-delà du périmètre initial :

- Un vrai flux de récupération de mot de passe testé de bout en bout (la fonction existe
  côté `login.html`, mais dépend de la configuration email de ton projet Supabase).
- Une modération automatique de contenu pour la Communauté (appel à une API de modération
  avant publication, en complément de la modération manuelle déjà en place).

## Sécurité — points à ne pas oublier

- La clé Supabase utilisée côté client est la clé **publique** (`publishable`) : c'est
  normal et sans danger, mais toute logique sensible (validation de paiement, attribution
  de rôle admin, calcul de score de quiz si tu veux éviter la triche) doit passer par une
  Edge Function côté serveur, jamais uniquement par le client.
- Le premier compte admin doit être créé manuellement : après inscription normale, exécute
  `update public.profiles set role = 'admin' where email = 'toi@exemple.com';` dans le SQL
  Editor.
