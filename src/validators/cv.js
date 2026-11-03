// Strict rules applied when the CV is saved (the live preview is lenient: services/cv/normalize).
const { z } = require('zod');
const { TEMPLATES, SECTIONS, LANGUAGE_LEVELS } = require('../config/cvTemplates');
const { LEGACY_TEMPLATES } = require('../services/cv/normalize');

const str = (max) => z.string().trim().max(max, `${max} caractères maximum.`).optional().default('');
const month = z.string().trim().optional().default('').refine((v) => !v || /^\d{4}-(0[1-9]|1[0-2])$/.test(v), 'Date invalide.');
const shortList = (max, label) => z.array(z.string().trim().min(1).max(60, '60 caractères maximum.')).max(max, `${max} ${label} maximum.`).default([]);

const cvSchema = z.object({
  template: z.preprocess((v) => LEGACY_TEMPLATES[v] || v, z.enum(Object.keys(TEMPLATES), { message: 'Modèle inconnu.' })).default('rubis'),
  color: z.string().trim().optional().refine((v) => !v || /^#[0-9a-fA-F]{6}$/.test(v), 'Couleur invalide.'),
  font: z.enum(['sans', 'serif', 'mixed']).optional(),
  showPhoto: z.boolean().optional().default(true),
  showLevels: z.boolean().optional().default(true),
  sectionOrder: z.array(z.enum(SECTIONS)).max(SECTIONS.length).optional().default([]),
  personal: z.object({
    firstName: z.string().trim().min(2, 'Prénom : 2 caractères minimum.').max(60),
    lastName: z.string().trim().min(2, 'Nom : 2 caractères minimum.').max(60),
    email: z.string().trim().toLowerCase().email('Adresse email invalide.').max(190),
    phone: str(30),
    address: str(120),
    city: str(120), // first builder format
    nationality: str(60),
    website: str(120),
    license: str(60),
    photoUrl: str(500).refine((v) => !v || /^(\/uploads\/|https:\/\/res\.cloudinary\.com\/)/.test(v), 'Photo invalide.'),
  }),
  title: z.string().trim().min(2, 'Indiquez votre titre professionnel.').max(120),
  summary: str(1500),
  experiences: z.array(z.object({
    title: z.string().trim().min(2, 'Intitulé du poste requis.').max(120),
    company: str(120), city: str(80), start: month, end: month, current: z.boolean().optional().default(false), description: str(2000),
  })).max(15, '15 expériences maximum.').default([]),
  educations: z.array(z.object({
    degree: z.string().trim().min(2, 'Intitulé du diplôme requis.').max(120),
    school: str(120), city: str(80), start: month, end: month, current: z.boolean().optional().default(false), description: str(1000),
  })).max(10, '10 formations maximum.').default([]),
  skills: z.array(z.preprocess(
    (v) => (typeof v === 'string' ? { name: v, level: 0 } : v),
    z.object({ name: z.string().trim().min(1).max(60), level: z.coerce.number().int().min(0).max(5).optional().default(0) })
  )).max(30, '30 compétences maximum.').default([]),
  languages: z.array(z.object({ name: z.string().trim().min(2, 'Nom de la langue requis.').max(40), level: z.enum(LANGUAGE_LEVELS, { message: 'Niveau de langue invalide.' }) })).max(10, '10 langues maximum.').default([]),
  qualities: shortList(12, 'qualités'),
  interests: shortList(12, "centres d'intérêt"),
  certificates: z.array(z.object({ name: z.string().trim().min(2, 'Nom du certificat requis.').max(140), year: str(20) })).max(12, '12 certificats maximum.').default([]),
  custom: z.object({ title: str(60), text: str(1500) }).optional().default({ title: '', text: '' }),
});

module.exports = { cvSchema, LANGUAGE_LEVELS };
