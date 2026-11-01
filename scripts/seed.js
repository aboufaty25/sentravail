// Demo data. WARNING: drops and recreates all tables.
const bcrypt = require('bcryptjs');
const env = require('../src/config/env');
const { sequelize, User, Post, Reaction, Comment } = require('../src/models');
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
    sector: 'Comptabilité',
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
    const postsData = [
      { author: 'admin', h: 2, text: "Bienvenue sur SenTravail ! 🇸🇳\n\nLe réseau social de l'emploi au Sénégal : suivez les recruteurs, partagez votre parcours et postulez aux offres en un clic.\n\nRappel : aucun recruteur sérieux ne vous demandera de payer pour obtenir un emploi. Signalez toute annonce suspecte." },
      { author: 'teranga-digital', h: 5, text: "Nous agrandissons l'équipe de Teranga Digital à Dakar ! 🚀 Développeurs, chargés de clientèle et data analysts : suivez notre page, les offres arrivent cette semaine." },
      { author: 'aissatou-fall', h: 9, text: "Ravie d'avoir obtenu ma certification en fiscalité OHADA ce week-end 🎓 Merci à tous ceux qui m'ont soutenue pendant ces mois de préparation !" },
      { author: 'cabinet-ndiaye', h: 20, text: "Conseil du jour pour les candidats : adaptez votre CV à chaque offre. Mettez en avant les 3 compétences demandées dans l'annonce, dès les premières lignes. Un recruteur passe en moyenne moins d'une minute sur un CV." },
      { author: 'moussa-sarr', h: 30, text: "Premier projet terminé : une application de gestion de stock pour une boutique de Thiès, en Node.js. Les retours sont les bienvenus ! 💻" },
      { author: 'fatou-sow', h: 50, text: "Question aux professionnels de santé : quelles formations continues recommandez-vous pour une infirmière qui veut se spécialiser en pédiatrie ?" },
      { author: 'teranga-digital', h: 72, text: "Retour en images sur notre journée portes ouvertes à Diamniadio. Merci aux 200 étudiants venus nous rencontrer !" },
    ];
    const created = [];
    for (const d of postsData) {
      created.push(await Post.create({ authorId: users[d.author].id, type: 'text', text: d.text, createdAt: hoursAgo(d.h), updatedAt: hoursAgo(d.h) }, { silent: true }));
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

    const c1 = await Comment.create({ postId: created[2].id, authorId: users['cabinet-ndiaye'].id, text: 'Félicitations Aïssatou, bien mérité ! 👏' });
    await Comment.create({ postId: created[2].id, authorId: users['aissatou-fall'].id, parentCommentId: c1.id, text: 'Merci beaucoup Ousmane, et merci pour vos conseils pendant mon stage !' });
    await Comment.create({ postId: created[2].id, authorId: users['moussa-sarr'].id, text: 'Bravo ! Tu as utilisé quels supports pour réviser ?' });
    await created[2].update({ commentsCount: 3 }, { silent: true });
    await Comment.create({ postId: created[3].id, authorId: users['fatou-sow'].id, text: 'Merci pour ce conseil, je vais revoir mon CV ce soir.' });
    await created[3].update({ commentsCount: 1 }, { silent: true });

    await Post.create({ authorId: users['moussa-sarr'].id, type: 'text', text: 'Très bon conseil, à lire pour tous ceux qui cherchent un emploi 👇', sharedPostId: created[3].id, createdAt: hoursAgo(12), updatedAt: hoursAgo(12) }, { silent: true });
    await created[3].update({ sharesCount: 1 }, { silent: true });

    await refreshRecentScores(365);
    console.log(`Seeded ${people.length} users, ${postsData.length + 1} posts. Password for all accounts: ${env.SEED_PASSWORD}`);
    console.log('  admin@sentravail.com (admin) · recruteur@sentravail.com (recruteur) · candidat@sentravail.com (candidat)');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
