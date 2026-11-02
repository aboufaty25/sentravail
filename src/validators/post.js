const { z } = require('zod');
const { CITIES } = require('../config/constants');
const { TYPES, EVENT_KINDS, AVAILABILITIES, SHARE_MAX_TEXT, COMMENT_MAX_TEXT } = require('../config/postTypes');

const required = (label, min, max) =>
  z.string({ message: `${label} : champ obligatoire.` }).trim()
    .min(1, `${label} : champ obligatoire.`)
    .min(min, `${label} : ${min} caractères minimum.`)
    .max(max, `${label} : ${max} caractères maximum.`);
const optional = (label, max) => z.string().trim().max(max, `${label} : ${max} caractères maximum.`).optional().default('');
const city = z.string({ message: 'Choisissez une ville.' }).refine((v) => CITIES.includes(v), 'Choisissez une ville.');
const visibility = z.enum(['public', 'network']).optional().default('public');

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// "Je cherche un emploi"
const jobSearchSchema = z.object({
  title: required('Métier recherché', 2, 100),
  city,
  experienceYears: z.coerce.number({ message: "Indiquez vos années d'expérience." }).int('Nombre entier.').min(0, 'Minimum 0.').max(50, 'Maximum 50 ans.'),
  availability: z.enum(AVAILABILITIES, { message: 'Choisissez votre disponibilité.' }),
  text: required('Présentation', 20, TYPES.job_search.maxText),
  visibility,
});

// "Événement emploi"
const eventSchema = z.object({
  eventKind: z.enum(Object.keys(EVENT_KINDS), { message: "Choisissez le type d'événement." }),
  title: required("Titre de l'événement", 5, 140),
  eventDay: z.string({ message: 'Indiquez la date.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Indiquez la date.')
    .refine((v) => v >= todayUtc(), "La date doit être aujourd'hui ou plus tard."),
  eventTime: z.string().optional().default('').refine((v) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'Heure invalide.'),
  city,
  place: required('Lieu', 2, 160),
  text: required('Description', 20, TYPES.event.maxText),
  visibility,
});

// "J'ai été recruté !"
const hiredSchema = z.object({
  title: required('Poste obtenu', 2, 120),
  company: optional('Entreprise', 120),
  text: optional('Message', TYPES.hired.maxText),
  visibility,
});

// "Conseil carrière"
const adviceSchema = z.object({
  title: required('Titre du conseil', 5, 140),
  text: required('Conseil', 50, TYPES.advice.maxText),
  visibility,
});

const schemasByType = { job_search: jobSearchSchema, event: eventSchema, hired: hiredSchema, advice: adviceSchema };

// Maps validated form data to Post columns (title/city/eventDate/text + details JSON).
function toPostFields(type, d) {
  switch (type) {
    case 'job_search':
      return { title: d.title, city: d.city, text: d.text, details: { experienceYears: d.experienceYears, availability: d.availability } };
    case 'event':
      return {
        title: d.title,
        city: d.city,
        text: d.text,
        eventDate: new Date(`${d.eventDay}T${d.eventTime || '00:00'}:00Z`),
        details: { eventKind: d.eventKind, place: d.place, hasTime: !!d.eventTime },
      };
    case 'hired':
      return { title: d.title, text: d.text || null, details: { company: d.company || null } };
    case 'advice':
      return { title: d.title, text: d.text, details: {} };
    default:
      throw new Error(`Unknown type ${type}`);
  }
}

const commentSchema = z.object({
  text: z.string().trim().min(1, 'Écrivez un commentaire.').max(COMMENT_MAX_TEXT, `Commentaire trop long (${COMMENT_MAX_TEXT} caractères maximum).`),
  parentCommentId: z
    .string()
    .optional()
    .transform((v) => (v && /^\d+$/.test(v) ? Number(v) : null)),
});

const shareSchema = z.object({
  text: z.string().trim().max(SHARE_MAX_TEXT, `Texte trop long (${SHARE_MAX_TEXT} caractères maximum).`).optional().default(''),
  visibility,
});

module.exports = { schemasByType, toPostFields, commentSchema, shareSchema, todayUtc };
