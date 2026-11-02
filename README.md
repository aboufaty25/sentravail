# SenTravail

Le réseau social de l'emploi au Sénégal — https://sentravail.com

Plateforme 100 % emploi : offres, recherches d'emploi, événements (salons, concours, formations), annonces de recrutement et conseils carrière, candidatures en un clic (même sans compte), créateur de CV, abonnements, notifications en temps réel. Consultable sans compte, installable (PWA), légère en 3G, financée par AdSense.

Les règles du projet (types de publication, garde-fous, accès ouvert, conventions) sont dans **[CLAUDE.md](CLAUDE.md)**.

**Stack** : Node.js 20+ · Express 5 · EJS + htmx + Alpine.js · Tailwind CSS · MySQL/MariaDB (Sequelize) · Socket.io · PDFKit · Nodemailer

➡️ **Mise en ligne : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)** (Hostinger pas à pas, variables d'environnement, sauvegardes, dépannage, annexe VPS).

## Démarrage local

```bash
cp .env.example .env        # renseigner la base MySQL
npm install
npm run seed                # tables + données de démonstration (EFFACE la base)
npm run dev                 # http://localhost:3000 (nodemon + Tailwind en watch)
```

Comptes de démo (mot de passe `Sentravail2026!`) :

| Rôle | Email | Téléphone |
|---|---|---|
| Admin | admin@sentravail.com | 77 000 00 01 |
| Recruteur | recruteur@sentravail.com | 77 000 00 02 |
| Candidat | candidat@sentravail.com | 77 000 00 04 |

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | développement (rechargement automatique + Tailwind) |
| `npm run build` | compile le CSS (avant `npm start`) |
| `npm start` | production |
| `npm test` | 280 tests Jest + Supertest (base `DB_NAME_TEST`, vidée à chaque exécution) |
| `npm run seed` | données de démonstration (refuse de tourner en production) |
| `npm run db:sync` | crée les tables et applique les migrations (fait aussi au démarrage) |
| `npm run scores` | recalcule les scores du fil (fait aussi toutes les 15 min par le serveur) |
| `npm run make-admin -- email` | nomme un compte administrateur |

## Fonctionnalités

| Domaine | Contenu |
|---|---|
| Comptes | inscription candidat/recruteur, connexion email ou téléphone, mot de passe oublié, profils publics, paramètres |
| Publications | 5 types structurés (offre, je cherche un emploi, événement, j'ai été recruté, conseil carrière), une carte par type, une image de 2 Mo max |
| Fil | public, classement par score (`services/feedRanking.js`), défilement infini, réactions (appui long), commentaires (500 car.), partages, enregistrements |
| Garde-fous | niveaux de confiance, badge vérifié recruteur (NINEA/RCCM/email pro), filtre anti-arnaque modifiable, limites, masquage à 3 signalements |
| Accès ouvert | tout est consultable sans compte ; fenêtre « Connectez-vous pour continuer » sur les actions réservées, retour à la page d'origine |
| Offres | publication (recruteurs/admin), pages `/offres/:slug` avec données `JobPosting`, recherche par mot-clé/ville/secteur/contrat, mise à la une |
| Candidatures | modal pré-rempli, invités acceptés, CV importé ou créé, `mailto:` avec lien de CV signé, confirmation, envoi de secours par le serveur, suivi des deux côtés |
| CV | créateur en 7 étapes, aperçu en direct, 2 modèles, export PDF |
| Réseau | abonnements, suggestions, visibilité « Mon réseau », viralité, fil personnalisé, recherche de personnes et entreprises |
| Administration | tableau de bord, file de modération (en attente, signalés, bloqués par le filtre), vérifications, filtre, mises à la une, utilisateurs, villes et secteurs |
| Notifications | temps réel (Socket.io, repli HTTP), regroupement, page dédiée, emails importants désactivables |
| PWA / SEO / AdSense | installable, hors-ligne, sitemap/robots/Open Graph, publicités après consentement uniquement, `ads.txt` généré |

## Architecture

```
src/
  app.js, server.js          Express, sécurité, Socket.io, tâches périodiques
  config/                    env (validé par zod), db, session, mailer, socket, migrations
  models/                    User, Post, Job, Application, Reaction, Comment, Follow, Notification, Report…
  controllers/               une responsabilité par fichier (posts, jobs, applications, cv, admin…)
  services/                  feedRanking, posts, jobs, follows, notifications, cvPdf, cvStorage, storage, mail
  middlewares/               auth, roles, csrf, upload, rateLimit, errors
  migrations/                migrations idempotentes appliquées au démarrage
  views/                     layouts, partials (postCard, jobCard, applyModal, adSlot…), pages
public/                      css, js (app.js, ads.js), icons, manifest, sw.js, offline.html
scripts/                     seed, makeAdmin, refreshScores, dbSync
deploy/                      PM2 et Nginx (VPS uniquement)
docs/DEPLOIEMENT.md          guide de mise en production
tests/                       Jest + Supertest
```

## Sécurité (résumé)

Contrôles de rôle et de propriété côté serveur sur chaque action, CSRF (session ou double cookie pour les invités, sans créer de session en base), helmet + CSP stricte (aucun script en ligne), limitation de débit, validation zod, contenu utilisateur échappé, mots de passe bcrypt, jetons de réinitialisation hachés, session renouvelée à la connexion, uploads vérifiés par leur contenu réel, CV privés téléchargeables uniquement par lien signé, pages dynamiques jamais mises en cache partagé.

## Feuille de route

Toutes les phases du cahier des charges sont livrées : socle, fil, offres, candidature, créateur de CV, réseau, administration, notifications, PWA/SEO/AdSense, production.
