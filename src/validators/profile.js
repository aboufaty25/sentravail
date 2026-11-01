const { z } = require('zod');
const { normalizePhone } = require('../utils/text');

const optionalText = (max) => z.string().trim().max(max, `${max} caractères maximum.`).optional().default('');

const profileSchema = z.object({
  firstName: z.string().trim().min(2, 'Prénom : 2 caractères minimum.').max(60),
  lastName: z.string().trim().min(2, 'Nom : 2 caractères minimum.').max(60),
  headline: optionalText(160),
  bio: optionalText(2000),
  city: optionalText(80),
  sector: optionalText(80),
  companyName: optionalText(120),
  skills: optionalText(500).transform((v) =>
    [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 30)
  ),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const phone = normalizePhone(v);
      if (!phone) {
        ctx.addIssue({ code: 'custom', message: 'Numéro de téléphone invalide.' });
        return z.NEVER;
      }
      return phone;
    }),
});

module.exports = { profileSchema };
