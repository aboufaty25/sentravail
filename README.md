# SenTravail

Le réseau social de l'emploi au Sénégal — https://sentravail.com

Node.js 20+ · Express 5 · EJS + htmx + Alpine.js · Tailwind CSS · **MySQL / MariaDB (Sequelize)**

## Démarrage local

```bash
cp .env.example .env        # puis renseigner la base MySQL
npm install
npm run seed                # crée les tables + comptes de démo (EFFACE la base)
npm run dev                 # http://localhost:3000 (nodemon + Tailwind en watch)
```

Comptes de démo (mot de passe : `SEED_PASSWORD`, par défaut `Sentravail2026!`) :

| Rôle | Email | Téléphone |
|---|---|---|
| Admin | admin@sentravail.com | 77 000 00 01 |
| Recruteur | recruteur@sentravail.com | 77 000 00 02 |
| Candidat | candidat@sentravail.com | 77 000 00 04 |

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement + watch Tailwind |
| `npm start` | Production |
| `npm run build` | Compile le CSS (à lancer avant `npm start`) |
| `npm run db:sync` | Crée les tables manquantes (`-- --alter` pour mettre à jour les colonnes) |
| `npm run seed` | Données de démonstration (refuse de tourner en production) |
| `npm run scores` | Recalcule les scores du fil (à mettre en tâche Cron hPanel toutes les 15 min) |
| `npm test` | Tests Jest + Supertest (base `DB_NAME_TEST`, vidée à chaque exécution) |

## Choix techniques liés à MySQL / Hostinger mutualisé

- **Sequelize + mysql2** à la place de Mongoose. Les listes (compétences, expériences…) sont stockées en JSON dans des colonnes `TEXT`, compatibles MySQL 5.7/8 et MariaDB.
- **Sessions** en base MySQL (`express-mysql-session`, table `sessions` créée automatiquement).
- **bcryptjs** (JavaScript pur) au lieu de `bcrypt` : aucun module natif à compiler sur l'hébergement.
- **htmx et Alpine.js servis localement** depuis `node_modules` (pas de CDN) : plus fiable en 3G.
- Pool de connexions limité à 5 (limite des hébergements mutualisés).
- CSRF : jeton de synchronisation maison (`src/middlewares/csrf.js`), envoyé en champ `_csrf` ou en en-tête `X-CSRF-Token` (htmx).

## Déploiement sur Hostinger (aperçu — guide complet en phase 11)

1. hPanel → **Bases de données MySQL** : créer la base et l'utilisateur, reporter les valeurs dans les variables d'environnement.
2. hPanel → **Node.js** (offres Business / Cloud) : créer l'application, fichier d'entrée `src/server.js`, Node 20+.
3. Variables d'environnement : copier `.env.example`, mettre `NODE_ENV=production`, un `SESSION_SECRET` long et aléatoire, `APP_URL=https://sentravail.com`, la configuration SMTP (adresse email Hostinger).
4. Build : `npm install && npm run build`. Les tables sont créées au démarrage.
5. **Photos** : renseigner `CLOUDINARY_*`. Sans Cloudinary, les photos sont stockées dans `public/uploads`, qui peut être effacé à chaque redéploiement.
6. hPanel → Avancé → **Tâches Cron** : `npm run scores` toutes les 15 minutes (le serveur le fait aussi tant qu'il est actif).

## Feuille de route

- [x] **Phase 1 — Socle** : projet, Tailwind, MySQL, inscription/connexion (email ou téléphone) avec choix du rôle, mot de passe oublié, layout mobile façon Facebook + desktop 3 colonnes, profil public + modification, pages légales, seed, tests
- [x] **Phase 2 — Fil** : publications texte/photo (redimensionnées dans le navigateur avant envoi), fil classé par score avec défilement infini, réactions (appui long), commentaires et réponses, j'aime sur commentaires, partages (fil, WhatsApp, Facebook, lien), enregistrements
- [ ] Phase 3 — Offres
- [ ] Phase 4 — Candidature
- [ ] Phase 5 — Créateur de CV
- [ ] Phase 6 — Réseau
- [ ] Phase 7 — Réels
- [ ] Phase 8 — Admin
- [ ] Phase 9 — Notifications
- [ ] Phase 10 — PWA, SEO, AdSense
- [ ] Phase 11 — Production
