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
| `npm run db:sync` | Crée les tables manquantes et applique les migrations (`src/migrations`) — fait aussi automatiquement au démarrage |
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
4b. **Premier administrateur** : inscrivez-vous, puis dans phpMyAdmin : `UPDATE users SET role = 'admin' WHERE email = 'votre@email.com';`. Les autres admins se nomment ensuite depuis `/admin/utilisateurs`.
5. **Photos** : sans Cloudinary, elles sont stockées automatiquement dans `~/sentravail-uploads` (dossier personnel Hostinger, hors de l'application, donc conservé lors des redéploiements). Le chemin exact s'affiche dans les logs au démarrage : « Uploads stored in … ». Pensez à inclure ce dossier dans vos sauvegardes.
6. **Réels** : les vidéos (jusqu'à 40 Mo) sont stockées dans `~/sentravail-uploads/reels`. Vérifiez que la limite de taille d'envoi de l'hébergement accepte 40 Mo. Les vidéos ne sont pas réencodées : une vidéo iPhone en HEVC peut ne pas se lire sur certains Android (réglage iPhone : Appareil photo → Formats → « Le plus compatible »).
7. **CV** : stockés en privé dans `~/sentravail-private/cvs` (jamais accessibles publiquement, téléchargeables uniquement par lien signé). À inclure dans les sauvegardes.
8. **SMTP** (obligatoire pour « Envoyer via SenTravail » et « Mot de passe oublié ») : hPanel → Emails → créer `no-reply@sentravail.com`, puis `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER` / `SMTP_PASSWORD` = cette adresse et son mot de passe.
9. hPanel → Avancé → **Tâches Cron** : `npm run scores` toutes les 15 minutes (le serveur le fait aussi tant qu'il est actif).

## Feuille de route

- [x] **Phase 1 — Socle** : projet, Tailwind, MySQL, inscription/connexion (email ou téléphone) avec choix du rôle, mot de passe oublié, layout mobile façon Facebook + desktop 3 colonnes, profil public + modification, pages légales, seed, tests
- [x] **Phase 2 — Fil** : publications texte/photo (redimensionnées dans le navigateur avant envoi), fil classé par score avec défilement infini, réactions (appui long), commentaires et réponses, j'aime sur commentaires, partages (fil, WhatsApp, Facebook, lien), enregistrements
- [x] **Phase 3 — Offres** : publication d'offres (recruteurs/admin, logo), offres officielles et demandes de mise à la une, carte offre dans le fil, page `/offres/:slug` avec données structurées JobPosting, modification/suppression, recherche (mot-clé, ville, secteur, contrat), « Mes offres »
- [x] **Phase 4 — Candidature** : modal « Postuler » (pré-rempli si connecté, invités acceptés), import de CV PDF/Word stocké en privé, email `mailto:` avec lien de CV signé 90 jours, écran « Avez-vous bien envoyé l'email ? », envoi de secours par SenTravail (CV en pièce jointe + accusé au candidat), « Mes candidatures », candidatures reçues et décisions côté recruteur, page « Mon CV »
- [x] **Phase 5 — Créateur de CV** : 7 étapes avec brouillon automatique, aperçu en direct, 2 modèles (Classique, Moderne), photo, export PDF (PDFKit), CV enregistré dans le profil et utilisé pour les candidatures, accessible aux invités depuis le modal « Postuler » avec retour automatique
- [x] **Phase 6 — Réseau** : abonnements (profil, en-tête des publications, suggestions), onglet Réseau (même ville, même secteur, populaires), listes abonnés/abonnements, visibilité « Mon réseau », offres de recruteur non approuvées réservées aux abonnés sauf viralité (`VIRAL_THRESHOLD`), fil personnalisé (auteur suivi ×1,5, offre de ma ville/mon secteur ×1,3), recherche globale personnes/entreprises/offres
- [x] **Phase 7 — Réels** : vidéos de 30 s max (MP4/MOV, 40 Mo) stockées sur le serveur, durée vérifiée dans le navigateur et côté serveur (lecture de l'en-tête MP4, sans ffmpeg), miniature générée dans le navigateur, envoi avec barre de progression, onglet Réels plein écran (lecture auto, son coupé, j'aime/commentaires/partage/abonnement), réels dans le fil (lecture auto sauf connexion lente) et sur le profil, vues comptées une fois par session
- [x] **Phase 8 — Admin** : tableau de bord, file d'approbation des mises à la une (durée ou refus motivé), gestion des offres à la une, signalements (publications, commentaires, profils) avec masquage automatique (`REPORT_AUTOHIDE`) et modération (supprimer, suspendre, classer), gestion des utilisateurs (suspension, rôle, badge vérifié), villes et secteurs modifiables
- [ ] Phase 9 — Notifications
- [ ] Phase 10 — PWA, SEO, AdSense
- [ ] Phase 11 — Production
