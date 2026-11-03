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

// Candidates give their first and last name; a recruiter account is named after the company.
const optionalName = z.string().trim().max(60, '60 caractères maximum.').optional().default('');
const namesForCandidates = (d, ctx) => {
  if (d.role === 'recruiter') return;
  if (d.firstName.length < 2) ctx.addIssue({ code: 'custom', path: ['firstName'], message: 'Prénom : 2 caractères minimum.' });
  if (d.lastName.length < 2) ctx.addIssue({ code: 'custom', path: ['lastName'], message: 'Nom : 2 caractères minimum.' });
};

const registerSchema = z
  .object({
    firstName: optionalName,
    lastName: optionalName,
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
  })
  .superRefine(namesForCandidates);

// Account created with Google/Apple: the email comes from the provider; the person still
// chooses their profile (never admin) and, for recruiters, gives the company name.
const oauthSignupSchema = z
  .object({
    firstName: optionalName,
    lastName: optionalName,
    phone: optionalPhone,
    role: z.enum(['candidate', 'recruiter'], { message: 'Choisissez votre profil : candidat ou recruteur.' }),
    companyName: z.string().trim().max(120).optional().default(''),
    acceptTerms: z.literal('on', { message: "Vous devez accepter les conditions d'utilisation." }),
  })
  .refine((d) => d.role !== 'recruiter' || d.companyName.length >= 2, { path: ['companyName'], message: "Indiquez le nom de votre entreprise." })
  .superRefine(namesForCandidates);

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

// Names stored for a new account: a recruiter account carries the company name.
function accountNames(d) {
  if (d.role === 'recruiter') return { firstName: d.companyName.slice(0, 60), lastName: '' };
  return { firstName: d.firstName, lastName: d.lastName };
}

// Turns a ZodError into { field: firstMessage }.
function fieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path[0] || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

module.exports = { accountNames, oauthSignupSchema, registerSchema, loginSchema, forgotSchema, resetSchema, fieldErrors };
