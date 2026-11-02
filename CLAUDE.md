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
                 Notification, Report, RefItem, BannedTerm
  controllers/   publish, post, job, event, application, cv, comment, follow, search,
                 notification, report, verification, admin, seo, page, auth, profile
  services/      feedRanking, posts, jobs, follows, notifications, moderation, moderationActions,
                 verification, reactions, cvPdf, cvStorage, storage, mail, refs
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
- **Recruteur** : tout sauf « Je cherche un emploi » + page entreprise, offres d'emploi, candidatures reçues, demande de badge vérifié.
- **Admin** : tout + offres officielles, modération, vérifications, filtre anti-arnaque, utilisateurs, villes et secteurs.

## Types de publication (`src/config/postTypes.js`)

« Quoi de neuf ? » ouvre un choix de type ; chaque type a son formulaire, ses champs obligatoires (`src/validators/post.js`) et sa carte reconnaissable (`views/partials/cards/`).

| Type | Qui | Champs | Texte max |
|---|---|---|---|
| Offre d'emploi (`job`) | recruteurs, admin | poste, entreprise, ville, contrat, description, email de candidature, date limite | 8000 |
| Je cherche un emploi (`job_search`) | candidats | métier, ville, années d'expérience, disponibilité, présentation | 600 |
| Événement emploi (`event`) | tous | type (salon, concours, portes ouvertes, formation), titre, date, ville, lieu, description, affiche facultative | 1500 |
| J'ai été recruté ! (`hired`) | tous | poste obtenu, entreprise facultative, message court | 300 |
| Conseil carrière (`advice`) | comptes vérifiés et admin | titre, conseil | 2000 |
| Partage (`share`) | tous | commentaire facultatif | 280 |

- Commentaires libres, **500 caractères max**, soumis au filtre de contenu.
- **Au maximum une image** par publication (logo ou affiche), compressée dans le navigateur, **2 Mo max**.
- Les anciennes publications libres (`text`/`photo`) restent en base mais sont masquées.

## Garde-fous (`src/services/moderation.js`)

- **Pas de modération a priori** : tous les comptes, nouveaux compris, publient directement. Seuls le filtre anti-arnaque et les signalements envoient un contenu en modération.
- **Badge vérifié (recruteurs)** : demande avec NINEA, RCCM ou email professionnel (Gmail, Yahoo, Hotmail… refusés ; propriété confirmée par lien), validation par l'admin.
- **Filtre anti-arnaque** : publication, offre (création et modification), partage ou commentaire contenant un terme interdit (« frais de dossier », « paiement », « payer », « investissement », « argent facile », « Wave », « Orange Money », « dépôt »…) → bloqué et envoyé en modération. Liste modifiable dans l'administration (`/admin/filtre`), comparaison sans accents ni majuscules, mots entiers.
- Message **« Un vrai recruteur ne demande jamais d'argent »** sur chaque page d'offre et dans le modal Postuler.
- **Limites** : 1 « Je cherche un emploi » par jour et par utilisateur ; liens externes interdits aux comptes non vérifiés (les adresses email restent autorisées) ; longueur maximale par type.
- **Signalements** : à partir de **3** (`REPORT_AUTOHIDE`), la publication ou le commentaire est masqué en attendant la décision de l'admin.
- **Administration** : file de modération `/admin/moderation` avec 2 onglets — Bloqués par le filtre, Signalés — plus `/admin/verifications` et `/admin/filtre`.

## Pas de vidéo

Aucun réel, aucun upload vidéo : ni onglet, ni route, ni modèle, ni code front. Ne pas réintroduire.

## Accès ouvert (important pour AdSense et le SEO)

- **Consultable sans compte et indexable** : fil (accueil), offres, pages offre complètes, profils, événements, recherche, pages de publication.
- **Même interface pour tous** : un visiteur voit exactement ce que voit un membre (onglets Réseau et Notifications, bouton +, « Quoi de neuf ? », menu, colonnes latérales, suggestions). Seuls les boutons réservés changent de comportement : ils ouvrent la fenêtre de connexion. Utiliser `loginAttr(currentUser, message)` et `guestAvatar()` (`src/utils/viewHelpers.js`) plutôt que des variantes « invité » de la page.
- **Connexion obligatoire** pour : publier, commenter, aimer, partager dans son fil, s'abonner, enregistrer, signaler, créer un CV. Côté visiteur, ces boutons portent `data-login="message"` et ouvrent la fenêtre « Connectez-vous pour continuer » (Se connecter / Créer un compte) ; après connexion ou inscription, retour à la page d'origine via `?retour=` (chemins du site uniquement, `src/utils/returnTo.js`). Côté serveur, `requireAuth` répond 401 + `require-login` aux actions htmx et redirige les pages vers `/connexion?retour=…`.
- Le partage externe (WhatsApp, Facebook, copier le lien) reste ouvert à tous.

## Candidature (fonctionnalité centrale)

1. « Voir l'offre » → `/offres/:slug` (données structurées `JobPosting`, bouton « Postuler » fixe sur mobile).
2. « Postuler » ouvre un modal, **possible sans inscription** : nom, prénom, email, téléphone, message, import du CV (PDF/Word, 5 Mo). Connecté : champs pré-remplis et CV du profil proposé. « Créer mon CV » demande la connexion puis revient au modal.
3. Envoi : candidature enregistrée, messagerie ouverte en `mailto:` avec un lien de CV signé (90 jours), puis « Avez-vous bien envoyé l'email ? » (Oui / Réessayer / Envoyer via SenTravail avec le CV en pièce jointe).
4. Sans compte : proposition discrète « Créez un compte pour suivre vos candidatures », jamais imposée.
5. Anti-spam : champ piège invisible (`website`) et limites par IP (6/heure, 20/jour pour les visiteurs).
6. CV stockés hors du dossier public, téléchargeables uniquement par lien signé.

## Fil d'actualité

- Offres à la une (approuvées par l'admin ou officielles) épinglées en haut.
- Puis tri par score : `engagement = likes×1 + comments×3 + shares×5 + saves×2 + views×0.05`, `score = (engagement + 1) / (heures + 2)^1.5`, bonus ×1.5 si l'auteur est suivi, ×1.3 si l'offre/la recherche/l'événement correspond à la ville ou au secteur du lecteur. Recalcul à chaque interaction et toutes les 15 min.
- Visibilité : « Mon réseau » = abonnés seulement ; offre de recruteur non approuvée = auteur + abonnés, sauf si virale (`VIRAL_THRESHOLD`) ; publications en modération visibles seulement par l'auteur et l'admin.

## AdSense

- Emplacements : fil toutes les 6 publications, colonne de droite (desktop), bas de la page offre.
- Jamais sur : connexion, inscription, formulaires de publication, modal de candidature, créateur de CV, administration, pages d'erreur.
- Rien de Google n'est chargé avant le consentement (bandeau cookies) ; en cas de refus, aucune publicité.
- `/ads.txt` généré depuis `ADSENSE_CLIENT_ID`. Pages obligatoires : À propos, Contact, Confidentialité, Conditions.

## Commandes

- `npm run dev` : développement (nodemon + Tailwind en watch)
- `npm run build` puis `npm start` : production
- `npm test` : tests (base `DB_NAME_TEST`, vidée à chaque exécution)
- `npm run seed` : données de démonstration (refuse de tourner en production)
- `npm run make-admin -- email` : nommer un administrateur (ou variable `ADMIN_EMAILS`, appliquée au démarrage aux comptes existants)
- `npm run set-password -- email` : changer le mot de passe d'un compte (saisi au clavier, déconnecte ses sessions)
- `npm run scores` : recalcul des scores du fil
