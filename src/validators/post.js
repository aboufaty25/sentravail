const { z } = require('zod');

const postSchema = z.object({
  text: z.string().trim().max(5000, 'Votre publication est trop longue (5000 caractères maximum).').optional().default(''),
  visibility: z.enum(['public', 'network']).optional().default('public'),
});

const commentSchema = z.object({
  text: z.string().trim().min(1, 'Écrivez un commentaire.').max(2000, 'Commentaire trop long (2000 caractères maximum).'),
  parentCommentId: z
    .string()
    .optional()
    .transform((v) => (v && /^\d+$/.test(v) ? Number(v) : null)),
});

const shareSchema = z.object({
  text: z.string().trim().max(2000, 'Texte trop long.').optional().default(''),
  visibility: z.enum(['public', 'network']).optional().default('public'),
});

module.exports = { postSchema, commentSchema, shareSchema };
