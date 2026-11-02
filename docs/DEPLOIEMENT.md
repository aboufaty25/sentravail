# Déployer SenTravail sur Hostinger

Ce guide part d'une offre **Hostinger Business ou Cloud** (hébergement Node.js inclus) et du dépôt GitHub `aboufaty25/sentravail`.
Les intitulés exacts des menus de hPanel peuvent varier légèrement selon votre offre.

---

## 1. Avant de commencer

- Le domaine `sentravail.com` est rattaché à votre hébergement.
- Le **SSL (HTTPS) est actif** (hPanel → Sécurité → SSL). Indispensable : la connexion, l'installation de l'application (PWA) et AdSense ne fonctionnent qu'en HTTPS.
- Node.js **20 ou plus** est disponible dans hPanel.

## 2. Base de données MySQL

hPanel → **Bases de données → MySQL** :

1. Créez une base, par exemple `u123456789_sentravail`.
2. Créez un utilisateur avec un mot de passe fort et donnez-lui tous les droits sur cette base.
3. Notez : nom de la base, utilisateur, mot de passe. L'hôte est en général `localhost`.

Les tables sont créées **automatiquement au premier démarrage**, puis mises à jour par les migrations à chaque redémarrage. Il n'y a rien à importer.

## 3. Adresse email d'envoi

hPanel → **Emails** : créez `no-reply@sentravail.com` (ou `contact@…`). Elle sert à :
mot de passe oublié, « Envoyer via SenTravail », réponses aux candidatures, décisions de mise à la une.

Paramètres SMTP Hostinger : serveur `smtp.hostinger.com`, port `465`, SSL activé.

## 4. Créer l'application Node.js

hPanel → **Sites web → Node.js** (ou « Ajouter un site → Application Node.js ») → importer depuis **GitHub** :

| Réglage | Valeur |
|---|---|
| Dépôt / branche | `aboufaty25/sentravail` / `main` |
| Version de Node.js | 20 ou plus récente |
| Fichier d'entrée | `src/server.js` |
| Commande d'installation | `npm install` |
| Commande de build | `npm run build` |
| Commande de démarrage | `npm start` |

## 5. Variables d'environnement

À saisir dans les réglages de l'application (**et** dans un fichier `.env` sur le serveur si vous utilisez les tâches Cron, voir §8).

| Variable | Valeur | Obligatoire |
|---|---|---|
| `NODE_ENV` | `production` | oui |
| `APP_URL` | `https://sentravail.com` (sans `/` final) | oui |
| `SESSION_SECRET` | 64 caractères aléatoires (`openssl rand -hex 32`) | oui |
| `DB_HOST` | `localhost` | oui |
| `DB_PORT` | `3306` | oui |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | valeurs du §2 | oui |
| `SMTP_HOST` | `smtp.hostinger.com` | recommandé |
| `SMTP_PORT` / `SMTP_SECURE` | `465` / `true` | recommandé |
| `SMTP_USER` / `SMTP_PASSWORD` | adresse et mot de passe du §3 | recommandé |
| `MAIL_FROM` | `SenTravail <no-reply@sentravail.com>` | recommandé |
| `ADSENSE_CLIENT_ID` | `ca-pub-…` (après acceptation par Google) | non |
| `ADSENSE_SLOT_FEED` / `_SIDEBAR` / `_JOB` | identifiants des 3 blocs d'annonces | non |
| `UPLOAD_DIR` | vide = `~/sentravail-uploads` | non |
| `CV_DIR` | vide = `~/sentravail-private/cvs` | non |
| `CLOUDINARY_*` | vide = images stockées sur Hostinger | non |
| `FEATURED_DAYS`, `VIRAL_THRESHOLD`, `REPORT_AUTOHIDE`, `FEED_PAGE_SIZE`, `CV_LINK_DAYS` | réglages (valeurs par défaut correctes) | non |

Ne définissez pas `PORT` : Hostinger le fournit. L'application refuse de démarrer en production si `SESSION_SECRET` est trop court.

## 6. Premier démarrage et vérifications

1. Déployez, puis ouvrez les logs de l'application. Vous devez voir :
   `Uploads stored in /home/u…/sentravail-uploads` puis `SenTravail running on https://sentravail.com`.
2. Ouvrez `https://sentravail.com/sante` : la réponse doit être `{"status":"ok",…}`.
3. Inscrivez-vous sur le site avec votre adresse.
4. Nommez-vous **administrateur** :
   - par SSH : `cd` dans le dossier de l'application puis `npm run make-admin -- votre@email.com` ;
   - ou dans phpMyAdmin : `UPDATE users SET role = 'admin' WHERE email = 'votre@email.com';`
5. Allez sur `/admin` : publiez une première offre officielle, ajustez villes et secteurs.
6. Vérifiez `https://sentravail.com/sitemap.xml` et `https://sentravail.com/robots.txt`.

Les données de démonstration (`npm run seed`) **ne doivent pas** être utilisées en production (le script refuse de tourner avec `NODE_ENV=production`).

## 7. Dossiers de données (à sauvegarder)

| Dossier | Contenu | Public ? |
|---|---|---|
| `~/sentravail-uploads` | logos, affiches, photos de CV | oui (adresses aléatoires) |
| `~/sentravail-private/cvs` | CV importés et générés | **non**, uniquement par lien signé |

Ils sont **en dehors** du dossier de l'application : un redéploiement depuis GitHub ne les efface pas.
Après le premier déploiement, publiez une photo, redéployez et vérifiez qu'elle s'affiche toujours.

## 8. Tâches planifiées (hPanel → Avancé → Tâches Cron)

Les tâches Cron ne voient pas les variables saisies dans l'interface de l'application : créez un fichier `.env` dans le dossier de l'application (via le gestionnaire de fichiers ou SSH, jamais dans GitHub) avec les mêmes valeurs qu'au §5.

| Fréquence | Commande | Rôle |
|---|---|---|
| toutes les 15 min (facultatif) | `cd ~/CHEMIN_APP && node scripts/refreshScores.js` | recalcul du score du fil si l'application a été mise en veille (elle le fait elle-même quand elle tourne) |
| chaque nuit | `mysqldump --no-tablespaces -u UTILISATEUR -p'MOT_DE_PASSE' NOM_BASE \| gzip > ~/backups/sentravail-$(date +\%F).sql.gz` | sauvegarde de la base |
| chaque semaine | `find ~/backups -name 'sentravail-*.sql.gz' -mtime +30 -delete` | ne garde que 30 jours de sauvegardes |

Remplacez `CHEMIN_APP` par le dossier de l'application (visible dans le gestionnaire de fichiers) et créez d'abord le dossier `~/backups`.
Activez aussi les **sauvegardes automatiques** de hPanel, et téléchargez de temps en temps une copie des dossiers du §7.

## 9. Mettre à jour le site

1. Les nouveautés sont poussées sur la branche `main` de GitHub.
2. hPanel → application Node.js → **Redéployer** (ou déploiement automatique s'il est activé).
3. Au redémarrage, les migrations de base de données s'appliquent seules. Le CSS et le JavaScript changent d'adresse (`?v=…`) : les utilisateurs reçoivent la nouvelle version immédiatement.

## 10. Google

- **Search Console** : ajoutez `sentravail.com`, puis déclarez `https://sentravail.com/sitemap.xml`. Les offres apparaissent dans Google Emplois grâce aux données structurées `JobPosting`.
- **AdSense** : demandez l'accès (les pages À propos, Contact, Confidentialité et Conditions sont en place, la modération aussi). Une fois accepté : renseignez `ADSENSE_CLIENT_ID` et les 3 blocs, redémarrez. `/ads.txt` est généré automatiquement.

## 11. Liste de contrôle sécurité

- [ ] HTTPS actif, `APP_URL` en `https://`
- [ ] `SESSION_SECRET` aléatoire de 64 caractères, jamais publié
- [ ] mot de passe MySQL fort ; base inaccessible depuis l'extérieur
- [ ] aucun fichier `.env` dans GitHub (il est dans `.gitignore`)
- [ ] un seul compte administrateur au départ, mot de passe fort
- [ ] sauvegardes de la base et des deux dossiers de données
- [ ] `/sante` surveillé (par exemple UptimeRobot, gratuit)

## 12. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Erreur 503 / page blanche | l'application ne démarre pas | lire les logs ; souvent une variable d'environnement manquante ou une base inaccessible |
| « Invalid environment configuration » dans les logs | variable manquante ou mal écrite | corriger la variable indiquée |
| On revient sans cesse à la page de connexion | site ouvert en `http://` | activer le SSL et utiliser `https://` |
| « Jeton de sécurité invalide » | page restée ouverte très longtemps, ou cookies bloqués | recharger la page |
| Les photos disparaissent après un redéploiement | `UPLOAD_DIR` pointe dans le dossier de l'application | laisser `UPLOAD_DIR` vide (§7) |
| « Upload folder … is not writable » | droits du dossier | définir `UPLOAD_DIR` vers un dossier de votre espace personnel |
| Les emails ne partent pas | SMTP non configuré ou mot de passe faux | vérifier `SMTP_*` ; en attendant, les emails sont écrits dans les logs |
| Notifications avec quelques secondes de retard | WebSockets bloqués par l'hébergeur | normal : repli automatique en HTTP, rien à faire |

---

## Annexe — hébergement sur un VPS (Ubuntu)

Si vous passez un jour sur un VPS :

```bash
sudo apt install -y nginx mysql-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2
git clone https://github.com/aboufaty25/sentravail.git && cd sentravail
cp .env.example .env   # puis compléter (NODE_ENV=production, base, SMTP…)
npm install && npm run build
pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup
sudo cp deploy/nginx.conf /etc/nginx/sites-available/sentravail && sudo ln -s /etc/nginx/sites-available/sentravail /etc/nginx/sites-enabled/
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d sentravail.com -d www.sentravail.com
```

`deploy/ecosystem.config.js` lance une seule instance (les notifications temps réel l'exigent) et le recalcul des scores toutes les 15 minutes ; `deploy/nginx.conf` gère HTTPS, les WebSockets et les envois jusqu'à 45 Mo.
