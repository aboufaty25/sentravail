# SenTravail — Le réseau social de l'emploi au Sénégal

Domaine : sentravail.com — monétisé avec Google AdSense.
**Plateforme 100 % emploi** : un réseau social qui reprend les usages de Facebook/LinkedIn (fil, j'aime, commentaires, partages, abonnements, notifications, onglets mobiles) mais où **chaque publication a un type structuré lié à l'emploi**. Pas de publication libre, pas de vidéo.

## Règles pour Claude Code

- Interface en **français**. Code, noms de variables et commentaires en **anglais**.
- Avancer étape par étape. Une étape n'est terminée que lorsque l'application démarre, que c'est **testé dans le navigateur en mobile (375 px)** et sur desktop, que `npm test` passe et que c'est **commité dans git**.
- Mobile d'abord, façon application Facebook Android. Pages légères (3G), images en lazy-loading.
- **Aucun secret dans le code** : tout passe par `.env` ; maintenir `.env.example` à jour.
- Toute action sensible est vérifiée **côté serveur** (rôle, propriété, statut de modération), jamais seulement dans l'interface.
- Écrire des tests Jest + Supertest pour toute règle métier (auth, permissions, candidature, fil, modération, garde-fous).
- Base de données : modifier le modèle **et** ajouter une migration idempotente dans `src/migrations/` (appliquée au démarrage). Ne jamais compter sur `sync({ alter })`.
- CSP stricte : **aucun gestionnaire d'événement en ligne** (`onclick=`, `onsubmit=`…) — utiliser Alpine (`@click`, `x-data @submit`) ou un attribut `data-*` géré dans `public/js/app.js`. Un test le vérifie.
- En-tête `HX-Trigger` : toujours via `hxTrigger(res, payload)` (`src/utils/hx.js`), qui échappe les caractères non Latin-1.
- Hébergement cible : **Hostinger mutualisé** (MySQL, une seule instance Node, pas de ffmpeg). Voir `docs/DEPLOIEMENT.md`.

## Stack

Node.js 20+, Express 5 · EJS rendu serveur + htmx + Alpine.js · Tailwind CSS 3 · **MySQL/MariaDB avec Sequelize** · sessions `express-mysql-session` · bcryptjs · Nodemailer · PDFKit (CV) · Socket.io (notifications, repli long-polling) · helmet, express-rate-limit, zod, CSRF maison (session ou double cookie pour les invités).
Images stockées sur le serveur (`UPLOAD_DIR`, hors du dossier de l'application) ; Cloudinary optionnel.

## Structure

```
src/
  app.js, server.js
  config/        env (zod), db, session, mailer, socket, migrate, constants, postTypes
  models/        User, Post, Job, Application, Reaction, Comment, CommentLike, Save, Follow,
                 Notification, Report, RefItem, BannedTerm, SiteSetting
  controllers/   publish, post, job, event, application, cv, comment, follow, search,
                 notification, report, verification, admin, seo, page, auth, profile
  services/      feedRanking, posts, jobs, follows, notifications, moderation, moderationActions,
                 verification, reactions, cv/ (CV PDF), cvStorage, storage, mail, refs, branding, adsConfig, googleConfig, oauth, jobImport
  middlewares/   auth, roles, csrf, upload, rateLimit, errors, flash
  migrations/    001… (idempotentes)
  views/         layouts, partials (postCard, postContent, cards/*, jobCard, applyModal,
                 loginPrompt, scamWarning, adSlot…), pages
public/          css, js (app.js, ads.js), icons, manifest, sw.js, offline.html
tests/           Jest + Supertest
docs/DEPLOIEMENT.md
```

## Rôles

- **Candidat** : profil, CV, publier (directement, sans validation préalable) « Je cherche un emploi », « Événement », « J'ai été recruté ! », postuler, s'abonner, aimer, commenter, partager.
- **Recruteur** : inscription avec le **nom de l'entreprise seulement** (pas de prénom ni de nom : `firstName` = nom de l'entreprise, `lastName` vide, initiales tirées des deux premiers mots) ; tout sauf « Je cherche un emploi » + page entreprise, offres d'emploi, candidatures reçues, demande de badge vérifié.
- **Admin** : tout + offres officielles, modération, vérifications, filtre anti-arnaque, utilisateurs, villes et secteurs.

## Types de publication (`src/config/postTypes.js`)

« Quoi de neuf ? » ouvre un choix de type ; chaque type a son formulaire, ses champs obligatoires (`src/validators/post.js`) et sa carte reconnaissable (`views/partials/cards/`).

| Type | Qui | Champs | Texte max |
|---|---|---|---|
| Offre d'emploi (`job`) | recruteurs, admin | poste, entreprise, ville, contrat, **une seule description** (missions, profil, avantages), mode de candidature, date limite | 8000 |
| Je cherche un emploi (`job_search`) | candidats | métier, ville, années d'expérience, disponibilité, présentation | 600 |
| Événement emploi (`event`) | tous | type (salon, concours, portes ouvertes, formation), titre, date, ville, lieu, description, affiche facultative | 1500 |
| J'ai été recruté ! (`hired`) | tous | poste obtenu, entreprise facultative, message court | 300 |
| Conseil carrière (`advice`) | comptes vérifiés et admin | titre, conseil | 2000 |
| Partage (`share`) | tous | commentaire facultatif | 280 |

- Commentaires libres, **500 caractères max**, soumis au filtre de contenu.
- **Au maximum une image** par publication (affiche), compressée dans le navigateur, **2 Mo max**. Exception : une offre peut avoir en plus le **logo de l'entreprise** (champ `companyLogo` du formulaire ; pas de logo par défaut pour l'admin, qui publie pour d'autres entreprises).
- **Image d'une offre** (`jobs.image`, distincte du logo `companyLogo`) : affichée en grand dans le fil comme une photo Facebook, avec le titre et un court extrait en dessous ; en haut de la page de l'offre ; et comme aperçu de partage (`og:image`, `summary_large_image`). Le partage externe d'une offre pointe toujours vers `/offres/:slug`.
- **Candidature à une offre** (`jobs.applyMode`) : « Sur SenTravail » (`platform`, par défaut pour les recruteurs : candidature reçue directement, sans étape email, gérée dans l'ATS), « Par email » (modal Postuler sur SenTravail, envoi à `applyEmail`) ou « Par lien externe » (`applyUrl`, réservé aux comptes vérifiés et à l'admin, vérifié côté serveur ; « Postuler » ouvre le lien, pas de candidature sur le site). Aucun email pré-rempli pour l'admin ; celui du compte pour un recruteur.
- Les anciennes publications libres (`text`/`photo`) restent en base mais sont masquées.

## Garde-fous (`src/services/moderation.js`)

- **Pas de modération a priori** : tous les comptes, nouveaux compris, publient directement. Seuls le filtre anti-arnaque et les signalements envoient un contenu en modération.
- **Affichage du badge** : rosette bleue avec coche blanche, façon Facebook — toujours via `verifiedBadge(taille)` (`src/utils/viewHelpers.js`), jamais une simple coche.
- **Badge vérifié (recruteurs)** : demande avec NINEA, RCCM ou email professionnel (Gmail, Yahoo, Hotmail… refusés ; propriété confirmée par lien), validation par l'admin.
- **Filtre anti-arnaque** : publication, offre (création et modification), partage ou commentaire contenant un terme interdit (« frais de dossier », « paiement », « payer », « investissement », « argent facile », « Wave », « Orange Money », « dépôt »…) → bloqué et envoyé en modération. Liste modifiable dans l'administration (`/admin/filtre`), comparaison sans accents ni majuscules, mots entiers.
- Message **« Un vrai recruteur ne demande jamais d'argent »** sur chaque page d'offre et dans le modal Postuler.
- **Limites** : 1 « Je cherche un emploi » par jour et par utilisateur ; liens externes interdits aux comptes non vérifiés (les adresses email restent autorisées) ; longueur maximale par type.
- **Signalements** : à partir de **3** (`REPORT_AUTOHIDE`), la publication ou le commentaire est masqué en attendant la décision de l'admin.
- **Administration** : file de modération `/admin/moderation` avec 2 onglets — Bloqués par le filtre, Signalés — plus `/admin/verifications` et `/admin/filtre`.

## Apparence (`/admin/apparence`, `src/services/branding.js`)

- L'admin change le **logo** (en-tête, connexion/inscription ; PNG conservé pour la transparence), l'**icône de l'application** (favicon + écran d'accueil ; recadrée au carré en PNG 512 et 192 px dans le navigateur) et l'**image de partage par défaut** (`og:image`). « Rétablir l'original » revient aux fichiers de `public/icons/`.
- Valeurs dans la table `site_settings`, gardées en mémoire et exposées aux vues dans `brand` ; le manifeste PWA est généré par la route `/manifest.webmanifest`. Ne pas coder en dur `/icons/logo.svg` ou `/icons/icon-192.png` dans les vues : utiliser `brand.*`.

## Pas de vidéo

Aucun réel, aucun upload vidéo : ni onglet, ni route, ni modèle, ni code front. Ne pas réintroduire.

## Accès ouvert (important pour AdSense et le SEO)

- **Consultable sans compte et indexable** : fil (accueil), offres, pages offre complètes, profils, événements, recherche, pages de publication.
- **Même interface pour tous** : un visiteur voit exactement ce que voit un membre (onglets Réseau et Notifications, bouton +, « Quoi de neuf ? », menu, colonnes latérales, suggestions). Seuls les boutons réservés changent de comportement : ils ouvrent la fenêtre de connexion. Utiliser `loginAttr(currentUser, message)` et `guestAvatar()` (`src/utils/viewHelpers.js`) plutôt que des variantes « invité » de la page.
- **Connexion obligatoire** pour : publier, commenter, aimer, partager dans son fil, s'abonner, enregistrer, signaler, créer un CV. Côté visiteur, ces boutons portent `data-login="message"` et ouvrent la fenêtre « Connectez-vous pour continuer » (Se connecter / Créer un compte) ; après connexion ou inscription, retour à la page d'origine via `?retour=` (chemins du site uniquement, `src/utils/returnTo.js`). Côté serveur, `requireAuth` répond 401 + `require-login` aux actions htmx et redirige les pages vers `/connexion?retour=…`.
- Le partage externe (WhatsApp, Facebook, copier le lien) reste ouvert à tous.

## Connexion Google / Apple (`src/services/oauth.js`, `src/controllers/oauthController.js`)

- OpenID Connect (code d'autorisation) : `/auth/:provider` → fournisseur → `/auth/:provider/callback` (Apple en POST `form_post`, exempté du CSRF, protégé par l'état signé). État, nonce et `retour` dans le cookie signé `st_oauth` (10 min, SameSite=None en https). Le jeton d'identité est vérifié (émetteur, audience, expiration, nonce).
- Compte connu (`googleId` / `appleId`) → connecté ; email **vérifié** d'un compte existant → rattaché ; sinon `/inscription/finaliser` : choix **Candidat / Recruteur** (jamais admin ; entreprise obligatoire pour un recruteur), CGU, puis création (mot de passe aléatoire : « Mot de passe oublié » permet d'en définir un). Le profil choisi sur `/inscription` est transmis (`?role=`).
- Boutons affichés seulement si les variables `GOOGLE_*` / `APPLE_*` sont remplies (`docs/DEPLOIEMENT.md`). Comptes suspendus refusés comme pour la connexion classique.

## Candidature (fonctionnalité centrale)

1. « Voir l'offre » → `/offres/:slug` (données structurées `JobPosting`, bouton « Postuler » fixe sur mobile).
2. « Postuler » ouvre un modal, **possible sans inscription** : nom, prénom, email, téléphone, message, import du CV (PDF/Word, 5 Mo). Connecté : champs pré-remplis et CV du profil proposé. « Créer mon CV » demande la connexion puis revient au modal.
3. Envoi : candidature enregistrée, messagerie ouverte en `mailto:` avec un lien de CV signé (90 jours), puis « Avez-vous bien envoyé l'email ? » (Oui / Réessayer / Envoyer via SenTravail avec le CV en pièce jointe).
4. Sans compte : proposition discrète « Créez un compte pour suivre vos candidatures », jamais imposée.
5. Anti-spam : champ piège invisible (`website`) et limites par IP (6/heure, 20/jour pour les visiteurs).
6. CV stockés hors du dossier public, téléchargeables uniquement par lien signé.

## Créateur de CV (`/cv/creer`, `src/services/cv/`)

- **7 modèles** (`src/config/cvTemplates.js`) : Rubis, Terracotta, Classique, Émeraude, Encadré, Prune, Horizon ; options : couleur (palette ou libre), police (Inter, Lora, mixte, intégrées en sous-ensemble), photo oui/non, niveaux oui/non, **ordre des rubriques**. Rubriques : coordonnées (adresse, nationalité, site, permis), titre, profil, expériences, formation, compétences (niveau 0-5), langues, qualités, centres d'intérêt, certificats, rubrique libre.
- **Rendu unique PDFKit** (`templates/*.js` + `layout.js`) : colonnes `Flow` avec **sauts de page automatiques** (en-tête d'entrée gardé avec sa 1ʳᵉ ligne, rubriques courtes non coupées, fond/colonnes redessinés à chaque page). Polices WOFF converties en TTF une fois en mémoire (~0,1 s par CV).
- **Aperçu en direct = le vrai PDF** : `POST /cv/apercu` (souple, rien n'est stocké, limité) affiché avec **pdf.js** (`/vendor/pdfjs/`, chargé à la demande) ; ordinateur : colonne à droite ; mobile : vignette en direct dans la barre du bas + aperçu plein écran. Brouillon dans `localStorage`.
- **Téléchargement en un clic** : `POST /cv/creer` (strict, `src/validators/cv.js`) enregistre le CV (`users.cvBuilt`, format normalisé par `normalize.js`, anciens CV compris), le rend CV de candidature et déclenche le téléchargement.
- Vignettes des modèles : `public/img/cv/*.jpg`, régénérées par `npm run cv:thumbs` (développement, Playwright).

## Recrutement sur la plateforme (ATS)

- Étapes d'une candidature (`Application.status`) : `confirmed_sent` (nouvelle) → `viewed` (à examiner) → `shortlisted` → `interview` → `offer` → `hired`, ou `rejected` à tout moment (`opened_mail` = email pas encore confirmé, hors pipeline).
- **Recruteur** : `/mes-offres` = tableau de recrutement (offres, candidatures, entretiens, embauches) ; `/mes-offres/:slug/candidatures` = tableau Kanban 6 colonnes sur ordinateur, filtres par étape sur mobile, changement d'étape par liste déroulante ; `/candidatures/:id` = fiche avec progression, boutons d'étape, planification d'entretien (date, lieu ou lien), **notes privées** (`recruiterNote`, jamais montrées au candidat). Propriétaire de l'offre ou admin uniquement (vérifié côté serveur).
- **Candidat** : `/mes-candidatures` = résumé + barre de progression par candidature, détails de l'entretien, « Partager la bonne nouvelle » une fois embauché.
- **Admin** : rubrique « Recrutement sur la plateforme » du tableau de bord (`/admin`) et page `/admin/candidatures` (`src/services/atsStats.js`) : candidatures par étape, 7 et 30 jours, SenTravail / email, entretiens à venir, embauches, taux de réponse des recruteurs, offres les plus demandées ; liste de toutes les candidatures filtrable (étape, mode, recherche) avec accès aux fiches et aux tableaux.
- Notification (dans l'application + email) au candidat à chaque étape importante, y compris pour les candidats sans compte (par email) ; le recruteur reçoit un email pour chaque candidature « Sur SenTravail ».

## Fil d'actualité

- En haut du fil : **les offres ouvertes publiées par un admin et les offres « À la une » (mise en avant approuvée par l'admin), mélangées et triées par date de publication, de la plus récente à la plus ancienne**, puis le fil classé (`pinnedJobs` dans `src/services/posts.js`). La page `/offres` suit le même ordre.
- **Toutes les offres sont visibles par tous dès leur publication** (approuvées automatiquement). Chaque offre de recruteur est **automatiquement proposée à l'admin pour la mise à la une** (`featureStatus: 'pending'`, plus de case à cocher) ; l'admin approuve ou refuse dans `/admin/offres`.
- Puis tri par score : `engagement = likes×1 + comments×3 + shares×5 + saves×2 + views×0.05`, `score = (engagement + 1) / (heures + 2)^1.5`, bonus ×1.5 si l'auteur est suivi, ×1.3 si l'offre/la recherche/l'événement correspond à la ville ou au secteur du lecteur. Recalcul à chaque interaction et toutes les 15 min.
- Visibilité : « Mon réseau » = abonnés seulement ; publications en modération visibles seulement par l'auteur et l'admin.

## AdSense

- Réglages dans l'administration (`/admin/publicites`, `src/services/adsConfig.js`, table `site_settings`, `.env` en repli) : identifiant éditeur, bloc par défaut, bloc par emplacement, interrupteur marche/arrêt. Valeurs initiales de sentravail.com insérées par la migration 013.
- Emplacements : fil après la **1ʳᵉ publication puis toutes les 3** (après 1, 4, 7…) ; **colonnes de gauche et de droite** (ordinateur) ; page offre **sous le titre** (`jobTop`) et **entre « Postuler » et les offres similaires** (`jobBottom`). Annonces automatiques : même script, activées depuis le compte AdSense.
- **Visibilité d'abord** (`public/js/ads.js`) : chaque bloc est demandé environ deux écrans avant d'être vu (défilement rapide ; un demi-écran après aussi) (IntersectionObserver) et jamais dans une colonne masquée ; la balise `<ins>` n'est créée qu'au moment de la demande (`adsbygoogle.push()` remplit la **première** `<ins>` vide de la page : n'en jamais écrire dans le HTML) ; le bloc reste replié (hauteur 0, `.ad-unit`) jusqu'à ce que Google le remplisse (`data-ad-status="filled"` → `.ad-filled`) ; non rempli ou bloqué, il disparaît. Préconnexion aux domaines Google dans `head.ejs`.
- Jamais sur : connexion, inscription, formulaires de publication, modal de candidature, créateur de CV, administration, pages d'erreur.
- **Pas de bandeau cookies** : les annonces se chargent directement (choix du propriétaire). Les visiteurs d'Europe/Royaume-Uni passent par le message de consentement de Google, à activer dans AdSense (Confidentialité et messages → RGPD). La page Confidentialité explique les cookies publicitaires.
- `/ads.txt` généré depuis l'identifiant éditeur (admin ou `ADSENSE_CLIENT_ID`). Pages obligatoires : À propos, Contact, Confidentialité, Conditions.

## Google Analytics et Search Console (`/admin/google`, `src/services/googleConfig.js`)

- **GA4** : ID de mesure (`G-…`) saisi dans l'admin (`.env` `GA_MEASUREMENT_ID` en repli) ; chargé par `public/js/analytics.js` (pas de script en ligne, CSP), jamais sur `/admin`. Événements : `sign_up` et `login` (mis en file côté serveur avec `queueEvent(req, …)` de `src/utils/analytics.js`, envoyés à la page suivante), `generate_lead` à chaque candidature envoyée (`window.stTrack`), plus la mesure améliorée de GA (clics sortants, recherche `?q=`). Propriété utilisateur `role`.
- **Search Console** : balise `google-site-verification` (collée entière ou code seul) ajoutée à la page d'accueil ; sitemap `/sitemap.xml` à déclarer dans Search Console.

## Commandes

- `npm run dev` : développement (nodemon + Tailwind en watch)
- `npm run build` puis `npm start` : production
- `npm test` : tests (base `DB_NAME_TEST`, vidée à chaque exécution)
- `npm run seed` : données de démonstration (refuse de tourner en production)
- `npm run make-admin -- email` : nommer un administrateur (ou variable `ADMIN_EMAILS`, appliquée au démarrage aux comptes existants)
- `npm run set-password -- email` : changer le mot de passe d'un compte (saisi au clavier, déconnecte ses sessions)
- `npm run scores` : recalcul des scores du fil
- `npm run cv:thumbs` : régénère les vignettes des modèles de CV (application démarrée)
- `npm run import-jobs -- fichier.json [email-admin]` : publier des offres préparées en JSON sous un compte admin. Les fichiers de `data/imports/` sont aussi importés **automatiquement une seule fois** au démarrage (repère `import:<fichier>` dans `site_settings` ; offres déjà présentes ou clôturées ignorées ; publiées « validées par l'admin », visibles dans le fil, sans être mises à la une). Un fichier peut aussi contenir `advice` : des conseils carrière (titre + texte ≤ 2000 caractères), pour une information qui n'est pas une offre (ex. programme de travail à l'étranger).
