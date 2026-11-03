const { z } = require('zod');
const { normalizePhone } = require('../utils/text');

const name = (label) =>
  z.string().trim().min(2, `${label} : 2 caractères minimum.`).max(60, `${label} : 60 caractères maximum.`);

const password = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
  .max(100, 'Le mot de passe est trop long.');

const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const phone = normalizePhone(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Numéro de téléphone invalide (ex. 77 123 45 67).' });
      return z.NEVER;
    }
    return phone;
  });

const registerSchema = z
  .object({
    firstName: name('Prénom'),
    lastName: name('Nom'),
    email: z.string().trim().toLowerCase().email('Adresse email invalide.').max(190),
    phone: optionalPhone,
    password,
    passwordConfirm: z.string(),
    // Admin accounts can never be created from the public form.
    role: z.enum(['candidate', 'recruiter'], { message: 'Choisissez votre profil : candidat ou recruteur.' }),
    companyName: z.string().trim().max(120).optional().default(''),
    acceptTerms: z.literal('on', { message: "Vous devez accepter les conditions d'utilisation." }),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'Les mots de passe ne correspondent pas.',
  })
  .refine((d) => d.role !== 'recruiter' || d.companyName.length >= 2, {
    path: ['companyName'],
    message: "Indiquez le nom de votre entreprise.",
  });

// Account created with Google/Apple: the email comes from the provider; the person still
// chooses their profile (never admin) and, for recruiters, gives the company name.
const oauthSignupSchema = z
  .object({
    firstName: name('Prénom'),
    lastName: name('Nom'),
    phone: optionalPhone,
    role: z.enum(['candidate', 'recruiter'], { message: 'Choisissez votre profil : candidat ou recruteur.' }),
    companyName: z.string().trim().max(120).optional().default(''),
    acceptTerms: z.literal('on', { message: "Vous devez accepter les conditions d'utilisation." }),
  })
  .refine((d) => d.role !== 'recruiter' || d.companyName.length >= 2, { path: ['companyName'], message: "Indiquez le nom de votre entreprise." });

const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Saisissez votre email ou votre numéro de téléphone.'),
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
});

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse email invalide.'),
});

const resetSchema = z
  .object({ password, passwordConfirm: z.string() })
  .refine((d) => d.password === d.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'Les mots de passe ne correspondent pas.',
  });

// Turns a ZodError into { field: firstMessage }.
function fieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path[0] || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

module.exports = { oauthSignupSchema, registerSchema, loginSchema, forgotSchema, resetSchema, fieldErrors };
