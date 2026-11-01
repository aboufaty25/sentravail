const { z } = require('zod');

const LANGUAGE_LEVELS = ['Langue maternelle', 'Courant', 'Intermédiaire', 'Notions'];
const TEMPLATES = ['classic', 'modern'];

const str = (max) => z.string().trim().max(max).optional().default('');
const month = z
  .string()
  .trim()
  .optional()
  .default('')
  .refine((v) => !v || /^\d{4}-(0[1-9]|1[0-2])$/.test(v), 'Date invalide.');

const cvSchema = z.object({
  template: z.enum(TEMPLATES).default('classic'),
  personal: z.object({
    firstName: z.string().trim().min(2, 'Prénom : 2 caractères minimum.').max(60),
    lastName: z.string().trim().min(2, 'Nom : 2 caractères minimum.').max(60),
    email: z.string().trim().toLowerCase().email('Adresse email invalide.').max(190),
    phone: str(30),
    city: str(80),
    photoUrl: str(500).refine((v) => !v || /^(\/uploads\/|https:\/\/res\.cloudinary\.com\/)/.test(v), 'Photo invalide.'),
  }),
  title: z.string().trim().min(2, 'Indiquez votre titre professionnel.').max(120),
  summary: str(1200),
  experiences: z
    .array(
      z.object({
        title: z.string().trim().min(2, 'Intitulé du poste requis.').max(120),
        company: str(120),
        city: str(80),
        start: month,
        end: month,
        current: z.boolean().optional().default(false),
        description: str(1500),
      })
    )
    .max(10, '10 expériences maximum.')
    .default([]),
  educations: z
    .array(
      z.object({
        degree: z.string().trim().min(2, 'Intitulé du diplôme requis.').max(120),
        school: str(120),
        city: str(80),
        start: month,
        end: month,
      })
    )
    .max(8, '8 formations maximum.')
    .default([]),
  skills: z.array(z.string().trim().min(1).max(60)).max(30, '30 compétences maximum.').default([]),
  languages: z
    .array(z.object({ name: z.string().trim().min(2).max(40), level: z.enum(LANGUAGE_LEVELS) }))
    .max(8, '8 langues maximum.')
    .default([]),
});

module.exports = { cvSchema, LANGUAGE_LEVELS, TEMPLATES };
