const { z } = require('zod');
const { normalizePhone } = require('../utils/text');

const applicationSchema = z.object({
  firstName: z.string().trim().min(2, 'Prénom : 2 caractères minimum.').max(60),
  lastName: z.string().trim().min(2, 'Nom : 2 caractères minimum.').max(60),
  email: z.string().trim().toLowerCase().email('Adresse email invalide.').max(190),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const phone = normalizePhone(v);
      if (!phone) {
        ctx.addIssue({ code: 'custom', message: 'Numéro de téléphone invalide (ex. 77 123 45 67).' });
        return z.NEVER;
      }
      return phone;
    }),
  // Kept short: the whole email must fit in a mailto: link (~2000 characters).
  message: z.string().trim().max(1000, 'Message trop long (1000 caractères maximum).').optional().default(''),
  cvSource: z.enum(['upload', 'profile']).optional().default('upload'),
  website: z.string().optional().default(''), // honeypot: must stay empty
  saveToProfile: z.string().optional(),
});

const statusSchema = z.object({ status: z.enum(['viewed', 'shortlisted', 'rejected']) });

module.exports = { applicationSchema, statusSchema };
