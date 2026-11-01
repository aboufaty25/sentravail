// Demo data. WARNING: drops and recreates all tables.
const bcrypt = require('bcryptjs');
const env = require('../src/config/env');
const { sequelize, User } = require('../src/models');

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
    for (const p of people) await User.create({ ...p, passwordHash });
    console.log(`Seeded ${people.length} users. Password for all accounts: ${env.SEED_PASSWORD}`);
    console.log('  admin@sentravail.com (admin) · recruteur@sentravail.com (recruteur) · candidat@sentravail.com (candidat)');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
