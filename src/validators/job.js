const { z } = require('zod');
const { CITIES, SECTORS, CONTRACT_TYPES } = require('../config/constants');

const text = (min, max, label) =>
  z.string().trim().min(min, `${label} : ${min} caractères minimum.`).max(max, `${label} : ${max} caractères maximum.`);
const optional = (max) => z.string().trim().max(max, `${max} caractères maximum.`).optional().default('');

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

const jobSchema = z.object({
  title: text(3, 120, 'Intitulé du poste'),
  companyName: text(2, 120, "Nom de l'entreprise"),
  location: z.string().refine((v) => CITIES.includes(v), 'Choisissez une ville.'),
  contractType: z.enum(CONTRACT_TYPES, { message: 'Choisissez un type de contrat.' }),
  sector: z.string().refine((v) => SECTORS.includes(v), 'Choisissez un secteur.'),
  salary: optional(80),
  // One description field: missions, profile and benefits together.
  description: text(30, 8000, 'Description'),
  applyMode: z.enum(['email', 'link'], { message: 'Choisissez comment recevoir les candidatures.' }).catch('email'),
  applyEmail: z.string().trim().toLowerCase().max(190).optional().default(''),
  applyUrl: z.string().trim().max(500).optional().default(''),
  deadline: z
    .string()
    .optional()
    .default('')
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Date invalide.')
    .refine((v) => !v || v >= todayUtc(), 'La date limite doit être dans le futur.'),
  text: optional(2000), // optional intro shown above the job card in the feed
  requestFeatured: z.string().optional(),
  isOfficial: z.string().optional(),
}).superRefine((d, ctx) => {
  if (d.applyMode === 'email') {
    if (!d.applyEmail) ctx.addIssue({ code: 'custom', path: ['applyEmail'], message: "Indiquez l'adresse email qui recevra les candidatures." });
    else if (!z.email().safeParse(d.applyEmail).success) ctx.addIssue({ code: 'custom', path: ['applyEmail'], message: 'Adresse email de candidature invalide.' });
  } else if (!/^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(d.applyUrl)) {
    ctx.addIssue({ code: 'custom', path: ['applyUrl'], message: 'Indiquez un lien valide, commençant par https://' });
  }
});

const searchSchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  ville: z.string().optional().default('').transform((v) => (CITIES.includes(v) ? v : '')),
  secteur: z.string().optional().default('').transform((v) => (SECTORS.includes(v) ? v : '')),
  contrat: z.string().optional().default('').transform((v) => (CONTRACT_TYPES.includes(v) ? v : '')),
  page: z.coerce.number().int().min(1).max(100).catch(1).default(1),
});

module.exports = { jobSchema, searchSchema, todayUtc };
