const { z } = require('zod');
const { UniqueConstraintError } = require('sequelize');
const { Report, Post, Comment, User } = require('../models');
const env = require('../config/env');
const posts = require('../services/posts');

const schema = z.object({
  targetType: z.enum(['post', 'comment', 'user']),
  targetId: z.coerce.number().int().positive(),
  reason: z.enum(Object.keys(Report.REASONS), { message: 'Choisissez un motif.' }),
  details: z.string().trim().max(500, '500 caractères maximum.').optional().default(''),
});

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Finds the reported target (only what the reporter can actually see) and its owner.
async function resolveTarget(type, id, viewer) {
  if (type === 'post') {
    const post = await posts.findVisiblePost(id, viewer);
    return post ? { ownerId: post.authorId, post } : null;
  }
  if (type === 'comment') {
    const comment = await Comment.findByPk(id);
    if (!comment || !(await posts.findVisiblePost(comment.postId, viewer))) return null;
    return { ownerId: comment.authorId };
  }
  const user = await User.findByPk(id, { attributes: ['id', 'isBanned'] });
  return user && !user.isBanned ? { ownerId: user.id } : null;
}

async function create(req, res) {
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) throw fail(422, parsed.error.issues[0].message);
  const d = parsed.data;
  const target = await resolveTarget(d.targetType, d.targetId, req.user);
  if (!target) throw fail(404, 'Contenu introuvable.');
  if (target.ownerId === req.user.id) throw fail(422, 'Vous ne pouvez pas signaler votre propre contenu.');

  try {
    await Report.create({
      reporterId: req.user.id,
      targetType: d.targetType,
      targetId: d.targetId,
      targetOwnerId: target.ownerId,
      reason: d.reason,
      details: d.details || null,
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) return res.json({ message: 'Vous avez déjà signalé ce contenu. Notre équipe va l’examiner.' });
    throw err;
  }

  // Many reports: hide the post until an admin reviews it (protects users and AdSense).
  if (d.targetType === 'post' && target.post.status === 'published') {
    const open = await Report.count({ where: { targetType: 'post', targetId: d.targetId, status: 'open' } });
    if (open >= env.REPORT_AUTOHIDE) await Post.update({ status: 'pending_approval' }, { where: { id: d.targetId } });
  }
  return res.status(201).json({ message: 'Merci. Votre signalement a été envoyé à notre équipe de modération.' });
}

module.exports = { create, REASONS: Report.REASONS };
