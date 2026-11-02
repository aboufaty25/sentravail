// Demo data. WARNING: drops and recreates all tables.
const bcrypt = require('bcryptjs');
const env = require('../src/config/env');
const { sequelize, User, Post, Reaction, Comment, Job, Follow, Report } = require('../src/models');
const refs = require('../src/services/refs');
const { buildSlug, featuredUntilDate } = require('../src/services/jobs');
const { refreshRecentScores } = require('../src/services/feedRanking');

if (env.isProd && !process.argv.includes('--force')) {
  console.error('Refusing to seed in production (this wipes the database). Use --force if you really mean it.');
  process.exit(1);
}

const people = [
  {
    username: 'admin', firstName: 'Équipe', lastName: 'SenTravail', email: 'admin@sentravail.com', phone: '+221770000001',
    role: 'admin', headline: 'Administration SenTravail', city: 'Dakar', isVerified: true,
    bio: "Compte officiel de SenTravail. Nous publions des offres vérifiées et veillons au respect des règles de la communauté.",
  },
  {
    username: 'teranga-digital', firstName: 'Mariama', lastName: 'Diop', email: 'recruteur@sentravail.com', phone: '+221770000002',
    role: 'recruiter', companyName: 'Teranga Digital', headline: 'Responsable RH chez Teranga Digital', city: 'Dakar',
    sector: 'Informatique & Télécoms', isVerified: true,
    bio: "Teranga Digital recrute des talents en développement, data et relation client à Dakar et Thiès.",
  },
  {
    username: 'cabinet-ndiaye', firstName: 'Ousmane', lastName: 'Ndiaye', email: 'ousmane@cabinet-ndiaye.sn', phone: '+221770000003',
    role: 'recruiter', companyName: 'Cabinet Ndiaye & Associés', headline: 'Associé — Cabinet Ndiaye & Associés', city: 'Thiès',
    sector: 'Comptabilité', isVerified: true,
  },
  {
    username: 'aissatou-fall', firstName: 'Aïssatou', lastName: 'Fall', email: 'candidat@sentravail.com', phone: '+221770000004',
    role: 'candidate', headline: "Comptable — 5 ans d'expérience", city: 'Dakar', sector: 'Comptabilité',
    bio: "Comptable rigoureuse, spécialisée en fiscalité sénégalaise et en logiciels Sage. À la recherche d'un poste en CDI à Dakar.",
    skills: ['Sage', 'Excel', 'Fiscalité', 'SYSCOHADA', 'Paie'],
    experiences: [
      { title: 'Comptable', company: 'Société Agricole du Saloum', period: '2021 — aujourd’hui' },
      { title: 'Assistante comptable', company: 'Cabinet Ndiaye & Associés', period: '2019 — 2021' },
    ],
    educations: [{ degree: 'Licence en Comptabilité-Finance', school: 'UCAD — FASEG', period: '2016 — 2019' }],
    languages: ['Français', 'Wolof', 'Anglais'],
  },
  {
    username: 'moussa-sarr', firstName: 'Moussa', lastName: 'Sarr', email: 'moussa.sarr@example.com',
    role: 'candidate', headline: 'Développeur web junior', city: 'Thiès', sector: 'Informatique & Télécoms',
    skills: ['JavaScript', 'Node.js', 'HTML/CSS'],
  },
  {
    username: 'fatou-sow', firstName: 'Fatou', lastName: 'Sow', email: 'fatou.sow@example.com',
    role: 'candidate', headline: 'Infirmière diplômée d’État', city: 'Saint-Louis', sector: 'Santé',
  },
];

(async () => {
  try {
    await sequelize.sync({ force: true });
    const passwordHash = await bcrypt.hash(env.SEED_PASSWORD, 10);
    const users = {};
    for (const p of people) users[p.username] = await User.create({ ...p, passwordHash });

    const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000);
    const inDaysAt = (n, hour = 9) => new Date(`${new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00Z`);
    // Structured publications only (see src/config/postTypes.js).
    const postsData = [
      { author: 'admin', h: 2, type: 'advice', title: 'Bienvenue sur SenTravail : postulez en toute sécurité',
        text: "Le réseau social de l'emploi au Sénégal : suivez les recruteurs, présentez-vous et postulez aux offres en un clic.\n\nUn vrai recruteur ne demande jamais d'argent. Frais de dossier, paiement par mobile money, « investissement » : signalez immédiatement l'annonce." },
      { author: 'teranga-digital', h: 5, type: 'event', title: 'Journée portes ouvertes Teranga Digital', city: 'Diamniadio', eventDate: inDaysAt(10, 9),
        details: { eventKind: 'portes_ouvertes', place: 'Parc des technologies numériques', hasTime: true },
        text: "Venez rencontrer nos équipes produit, data et relation client. Entretiens sur place pour nos postes ouverts : apportez votre CV !" },
      { author: 'aissatou-fall', h: 9, type: 'job_search', title: 'Comptable', city: 'Dakar', details: { experienceYears: 5, availability: 'Immédiatement' },
        text: "Comptable rigoureuse, certifiée en fiscalité OHADA, 5 ans d'expérience (Sage, SYSCOHADA, paie). Je recherche un CDI à Dakar." },
      { author: 'cabinet-ndiaye', h: 20, type: 'advice', title: 'Adaptez votre CV à chaque offre',
        text: "Mettez en avant les 3 compétences demandées dans l'annonce, dès les premières lignes. Un recruteur passe en moyenne moins d'une minute sur un CV : il doit trouver tout de suite ce qu'il cherche." },
      { author: 'moussa-sarr', h: 30, type: 'job_search', title: 'Développeur web junior', city: 'Thiès', details: { experienceYears: 1, availability: 'Sous 1 mois' },
        text: "Développeur Node.js et JavaScript, j'ai réalisé une application de gestion de stock pour une boutique de Thiès. Ouvert aux stages et CDD." },
      { author: 'fatou-sow', h: 50, type: 'hired', title: 'Infirmière en pédiatrie', details: { company: 'Clinique Les Filaos' },
        text: "Après 6 mois de recherche, je commence lundi ! Merci à tous pour vos conseils 🙏" },
      { author: 'teranga-digital', h: 72, type: 'event', title: "Salon de l'emploi numérique de Dakar", city: 'Dakar', eventDate: inDaysAt(21, 10),
        details: { eventKind: 'salon', place: 'CICAD', hasTime: true },
        text: "Plus de 40 entreprises du numérique recrutent : développeurs, designers, commerciaux, techniciens. Entrée libre." },
    ];
    const created = [];
    for (const d of postsData) {
      const { author, h, ...fields } = d;
      created.push(await Post.create({ ...fields, authorId: users[author].id, createdAt: hoursAgo(h), updatedAt: hoursAgo(h) }, { silent: true }));
    }

    const reactionPlan = [
      [0, ['teranga-digital', 'aissatou-fall', 'moussa-sarr', 'fatou-sow', 'cabinet-ndiaye'], ['like', 'love', 'like', 'support', 'like']],
      [1, ['aissatou-fall', 'moussa-sarr', 'fatou-sow'], ['like', 'love', 'like']],
      [2, ['admin', 'teranga-digital', 'cabinet-ndiaye', 'moussa-sarr', 'fatou-sow'], ['bravo', 'bravo', 'like', 'bravo', 'love']],
      [3, ['aissatou-fall', 'moussa-sarr'], ['like', 'support']],
      [4, ['teranga-digital'], ['bravo']],
    ];
    for (const [i, who, types] of reactionPlan) {
      for (let k = 0; k < who.length; k += 1) await Reaction.create({ userId: users[who[k]].id, postId: created[i].id, type: types[k] });
      await created[i].update({ likesCount: who.length }, { silent: true });
    }

    const c1 = await Comment.create({ postId: created[2].id, authorId: users['cabinet-ndiaye'].id, text: 'Profil intéressant, envoyez-nous votre CV par message 👍' });
    await Comment.create({ postId: created[2].id, authorId: users['aissatou-fall'].id, parentCommentId: c1.id, text: 'Merci beaucoup Ousmane, je vous envoie mon CV aujourd’hui !' });
    await Comment.create({ postId: created[2].id, authorId: users['moussa-sarr'].id, text: 'Bonne chance Aïssatou !' });
    await created[2].update({ commentsCount: 3 }, { silent: true });
    await Comment.create({ postId: created[3].id, authorId: users['fatou-sow'].id, text: 'Merci pour ce conseil, je vais revoir mon CV ce soir.' });
    await created[3].update({ commentsCount: 1 }, { silent: true });

    await Post.create({ authorId: users['moussa-sarr'].id, type: 'share', text: 'Très bon conseil, à lire pour tous ceux qui cherchent un emploi 👇', sharedPostId: created[3].id, createdAt: hoursAgo(12), updatedAt: hoursAgo(12) }, { silent: true });
    await created[3].update({ sharesCount: 1 }, { silent: true });

    const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const jobsData = [
      {
        author: 'admin', h: 3, official: true, text: 'Offre vérifiée par SenTravail ✅',
        job: { title: 'Agent de saisie (H/F)', companyName: 'Société Sénégalaise de Logistique', location: 'Dakar', contractType: 'CDD', sector: 'Logistique & Transport',
          salary: '150 000 FCFA / mois', deadline: day(10), applyEmail: 'rh@ssl-logistique.example',
          description: "Au sein du service des opérations, vous assurez la saisie des bons de livraison et la mise à jour des stocks dans notre logiciel de gestion.\n\n• Saisie et contrôle des documents de transport\n• Mise à jour quotidienne des tableaux de bord\n• Archivage",
          requirements: '• Niveau BAC minimum\n• Maîtrise d\'Excel\n• Rigueur et rapidité', benefits: 'Transport pris en charge · Mutuelle' },
      },
      {
        author: 'admin', h: 26, official: true,
        job: { title: 'Infirmier(ère) diplômé(e) d\'État', companyName: 'Clinique Les Filaos', location: 'Saint-Louis', contractType: 'CDI', sector: 'Santé',
          deadline: day(20), applyEmail: 'recrutement@clinique-filaos.example',
          description: 'La Clinique Les Filaos recherche un(e) infirmier(ère) pour son service de pédiatrie. Vous assurez les soins, le suivi des patients et l\'accueil des familles en lien avec l\'équipe médicale.',
          requirements: '• Diplôme d\'État d\'infirmier\n• 2 ans d\'expérience\n• Disponibilité pour les gardes' },
      },
      {
        author: 'teranga-digital', h: 4, feature: 'pending', text: 'Nous recrutons ! Partagez autour de vous 🙏',
        job: { title: 'Développeur(se) Node.js', companyName: 'Teranga Digital', location: 'Dakar', contractType: 'CDI', sector: 'Informatique & Télécoms',
          salary: '600 000 – 900 000 FCFA / mois', deadline: day(15), applyEmail: 'recruteur@sentravail.com',
          description: "Rejoignez notre équipe produit pour développer des applications web utilisées par des milliers de clients au Sénégal.\n\n• Développement d'API Node.js / Express\n• Bases de données MySQL\n• Revue de code et tests",
          requirements: '• 2 ans d\'expérience en JavaScript\n• Git, SQL\n• Esprit d\'équipe', benefits: 'Télétravail partiel · Assurance santé · Formation' },
      },
      {
        author: 'teranga-digital', h: 30,
        job: { title: 'Chargé(e) de clientèle', companyName: 'Teranga Digital', location: 'Thiès', contractType: 'CDD', sector: 'Commerce & Vente',
          deadline: day(2), applyEmail: 'recruteur@sentravail.com',
          description: "Vous accueillez et conseillez nos clients par téléphone et WhatsApp, traitez leurs demandes et assurez leur satisfaction.",
          requirements: '• BAC+2\n• Excellente expression en français et en wolof' },
      },
      {
        author: 'cabinet-ndiaye', h: 48,
        job: { title: 'Comptable confirmé(e)', companyName: 'Cabinet Ndiaye & Associés', location: 'Thiès', contractType: 'CDI', sector: 'Comptabilité',
          applyEmail: 'ousmane@cabinet-ndiaye.sn',
          description: 'Tenue de la comptabilité d\'un portefeuille de PME, déclarations fiscales et sociales, préparation des bilans selon le SYSCOHADA révisé.',
          requirements: '• BAC+3 en comptabilité\n• 3 ans d\'expérience\n• Maîtrise de Sage' },
      },
      {
        author: 'cabinet-ndiaye', h: 24 * 20,
        job: { title: 'Stagiaire en audit', companyName: 'Cabinet Ndiaye & Associés', location: 'Dakar', contractType: 'Stage', sector: 'Comptabilité',
          deadline: day(-5), applyEmail: 'ousmane@cabinet-ndiaye.sn',
          description: 'Stage de 6 mois au sein de notre pôle audit : participation aux missions de commissariat aux comptes et d\'audit contractuel.' },
      },
    ];
    for (const d of jobsData) {
      const createdAt = hoursAgo(d.h);
      const post = await Post.create({
        authorId: users[d.author].id, type: 'job', text: d.text || null, createdAt, updatedAt: createdAt,
        isFeatured: !!d.official, featuredUntil: d.official ? featuredUntilDate(createdAt) : null,
        featureStatus: d.official ? 'approved' : d.feature || 'none',
      }, { silent: true });
      await Job.create({ ...d.job, postId: post.id, slug: buildSlug(d.job.title, d.job.location), isOfficial: !!d.official });
    }

    // Network: who follows whom
    const followPlan = [
      ['aissatou-fall', ['teranga-digital', 'cabinet-ndiaye', 'admin']],
      ['moussa-sarr', ['teranga-digital', 'aissatou-fall', 'admin']],
      ['fatou-sow', ['admin', 'aissatou-fall']],
      ['cabinet-ndiaye', ['aissatou-fall']],
      ['teranga-digital', ['admin']],
    ];
    for (const [who, targets] of followPlan) {
      for (const t of targets) await Follow.create({ followerId: users[who].id, followingId: users[t].id });
    }
    for (const u of Object.values(users)) {
      await u.update({
        followersCount: await Follow.count({ where: { followingId: u.id } }),
        followingCount: await Follow.count({ where: { followerId: u.id } }),
      });
    }
    await Post.create({ authorId: users['aissatou-fall'].id, type: 'hired', visibility: 'network', title: 'Certification en fiscalité OHADA', details: { company: null }, text: 'Petite victoire partagée avec mon réseau : certification obtenue ce week-end 🎓', createdAt: hoursAgo(6), updatedAt: hoursAgo(6) }, { silent: true });

    // Reference lists and a few demo reports for the moderation screen
    await refs.seedDefaults();
    const spam = await Post.create({ authorId: users['moussa-sarr'].id, type: 'event', title: 'Formation rémunérée à domicile', city: 'Dakar', eventDate: inDaysAt(3), details: { eventKind: 'formation', place: 'En ligne', hasTime: false }, text: 'Gagnez 500 000 FCFA par semaine depuis chez vous !!! Envoyez 10 000 FCFA de frais d\'inscription par Wave pour recevoir le lien.' });
    await Report.create({ reporterId: users['aissatou-fall'].id, targetType: 'post', targetId: spam.id, targetOwnerId: users['moussa-sarr'].id, reason: 'payment', details: "Demande de frais d'inscription" });
    await Report.create({ reporterId: users['fatou-sow'].id, targetType: 'post', targetId: spam.id, targetOwnerId: users['moussa-sarr'].id, reason: 'scam' });

    await refreshRecentScores(365);
    console.log(`Seeded ${people.length} users, ${postsData.length + 1} posts, ${jobsData.length} jobs. Password for all accounts: ${env.SEED_PASSWORD}`);
    console.log('  admin@sentravail.com (admin) · recruteur@sentravail.com (recruteur) · candidat@sentravail.com (candidat)');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
