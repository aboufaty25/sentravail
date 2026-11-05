// "Vitrine des CV" (CV slider): CVs the admin puts forward, shown in the feed (after the 3rd
// offer), at the bottom of offer pages and in the full-screen viewer (/cv/vitrine).
// Rules (checked here, server-side), announced in the Terms and the Privacy policy:
// - the admin may show any CV created or imported on the site, unless the member refused
//   (users.cvShowcaseRefused, profile settings): refusing deletes the member's items at once;
// - a suspended account is never shown;
// - contact details are for recruiters only: a CV made with the builder is published WITHOUT
//   email, phone, address or website; an imported PDF is never served to the public (only its
//   first-page images, rendered with contact details blacked out); recruiters and admins get
//   the complete CV (fullFile).
const fs = require('fs/promises');
const { Op } = require('sequelize');
const { CvShowcase, User } = require('../models');
const cvStorage = require('./cvStorage');
const { removeLocalMedia } = require('./storage');
const { buildCvPdf } = require('./cv');
const { normalizeCv } = require('./cv/normalize');

const MAX_ITEMS = 20;
const CACHE_MS = 60 * 1000;
let cache = { at: 0, items: null };

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// The public copy of a builder CV: no way to reach the person outside SenTravail.
function maskCv(input) {
  const cv = normalizeCv(input);
  return { ...cv, personal: { ...cv.personal, email: '', phone: '', address: '', website: '' } };
}

function invalidate() {
  cache = { at: 0, items: null };
}

const USER_ATTRS = ['id', 'username', 'firstName', 'lastName', 'role', 'avatarUrl', 'isBanned', 'cvShowcaseRefused', 'isVerified'];

// Items that may be shown publicly right now (member did not refuse, account not suspended).
async function visibleItems() {
  const rows = await CvShowcase.findAll({
    where: { isActive: true },
    include: [{ model: User, as: 'user', attributes: USER_ATTRS, required: false }],
    order: [['sortOrder', 'ASC'], ['id', 'DESC']],
    limit: MAX_ITEMS * 2,
  });
  return rows.filter((r) => !r.userId || (r.user && !r.user.cvShowcaseRefused && !r.user.isBanned)).slice(0, MAX_ITEMS);
}

// Cached list for the slider (one query per minute per process).
async function slider() {
  if (!cache.items || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), items: await visibleItems() };
  }
  return cache.items;
}

async function findVisible(id) {
  const item = await CvShowcase.findByPk(id, { include: [{ model: User, as: 'user', attributes: USER_ATTRS, required: false }] });
  if (!item || !item.isActive) return null;
  if (item.userId && (!item.user || item.user.cvShowcaseRefused || item.user.isBanned)) return null;
  return item;
}

async function topOrder() {
  const min = await CvShowcase.min('sortOrder');
  return Number.isFinite(min) ? min - 1 : 0;
}

function displayName(user) {
  return `${user.firstName} ${user.lastName}`.trim();
}

// Adds a member's CV (builder CV in priority, else their imported PDF).
async function addMemberCv(userId, admin) {
  const user = await User.findByPk(userId);
  if (!user || user.isBanned) throw fail(404, 'Compte introuvable ou suspendu.');
  if (user.cvShowcaseRefused) throw fail(422, 'Ce membre a refusé que son CV soit affiché dans la vitrine.');
  if (await CvShowcase.findOne({ where: { userId: user.id } })) throw fail(422, 'Ce CV est déjà dans la vitrine.');
  let source;
  let stored;
  let title = user.headline || null;
  let color = null;
  if (user.cvBuilt) {
    const cv = maskCv(user.cvBuilt);
    stored = await cvStorage.saveCv(await buildCvPdf(cv), `CV ${displayName(user)}.pdf`);
    source = 'built';
    title = cv.title || title;
    color = cv.color;
  } else if (user.cvUrl && user.cvUrl.endsWith('.pdf')) {
    const file = cvStorage.filePath(user.cvUrl);
    if (!file) throw fail(422, 'CV introuvable.');
    stored = await cvStorage.saveCv(await fs.readFile(file), user.cvName || 'CV.pdf');
    source = 'file';
  } else {
    throw fail(422, user.cvUrl ? 'Seuls les CV au format PDF peuvent être affichés dans la vitrine.' : "Ce membre n'a pas de CV.");
  }
  const item = await CvShowcase.create({
    userId: user.id, source, name: displayName(user).slice(0, 120), title: title ? title.slice(0, 120) : null,
    city: user.city || null, cvKey: stored.key, color, sortOrder: await topOrder(), createdById: admin.id,
  });
  invalidate();
  return item;
}

// A PDF CV uploaded by the admin (e.g. received by the team).
async function addUpload(buffer, { name, title, city }, admin) {
  if (cvStorage.detectCvType(buffer) !== 'pdf') throw fail(422, 'Le CV doit être un fichier PDF.');
  const stored = await cvStorage.saveCv(buffer, `CV ${name}.pdf`);
  const item = await CvShowcase.create({
    userId: null, source: 'file', name, title: title || null, city: city || null, cvKey: stored.key,
    sortOrder: await topOrder(), createdById: admin.id,
  });
  invalidate();
  return item;
}

async function removeFiles(item) {
  const file = cvStorage.filePath(item.cvKey);
  if (file) await fs.unlink(file).catch(() => {});
  await removeLocalMedia([item.thumbnail, item.image]);
}

async function remove(item) {
  await item.destroy();
  await removeFiles(item);
  invalidate();
}

// The member refused (or the account was deleted): their CV leaves the showcase at once.
async function removeForUser(userId) {
  const items = await CvShowcase.findAll({ where: { userId } });
  for (const item of items) await remove(item);
  return items.length;
}

// Builder CV changed since it was added: publish the current version (images regenerated).
async function refresh(item) {
  if (item.source !== 'built' || !item.userId) throw fail(422, 'Seul un CV créé sur SenTravail peut être mis à jour.');
  const user = await User.findByPk(item.userId);
  if (!user?.cvBuilt || user.cvShowcaseRefused) throw fail(422, "Ce CV n'est plus disponible.");
  const cv = maskCv(user.cvBuilt);
  const stored = await cvStorage.saveCv(await buildCvPdf(cv), `CV ${displayName(user)}.pdf`);
  const old = { cvKey: item.cvKey, thumbnail: item.thumbnail, image: item.image };
  await item.update({ cvKey: stored.key, thumbnail: null, image: null, masked: false, title: (cv.title || item.title || '').slice(0, 120) || null, color: cv.color, name: displayName(user).slice(0, 120) });
  await removeFiles(old);
  invalidate();
}

// Images may be shown publicly when they cannot contain contact details.
function publicImages(item) {
  const safe = item.source === 'built' || item.masked;
  return { thumbnail: safe ? item.thumbnail : null, image: safe ? item.image : null };
}

// The complete CV (with contact details), for recruiters and admins: the member's current CV
// for a builder CV, the original PDF otherwise.
async function fullFile(item) {
  if (item.source === 'built' && item.userId) {
    const user = await User.findByPk(item.userId, { attributes: ['cvUrl', 'cvName'] });
    if (user?.cvUrl && cvStorage.filePath(user.cvUrl)) return { key: user.cvUrl, name: user.cvName || 'CV.pdf' };
  }
  return { key: item.cvKey, name: `CV-${item.id}.pdf` };
}

async function setImages(item, { thumbnail, image, masked = false }) {
  const old = [item.thumbnail, item.image];
  await item.update({ thumbnail, image, masked: !!masked });
  await removeLocalMedia(old.filter((u) => u && u !== thumbnail && u !== image));
  invalidate();
}

// Moves an item one place up or down in the slider.
async function move(item, direction) {
  const all = await CvShowcase.findAll({ order: [['sortOrder', 'ASC'], ['id', 'DESC']] });
  const i = all.findIndex((x) => x.id === item.id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  for (let k = 0; k < all.length; k += 1) if (all[k].sortOrder !== k) await all[k].update({ sortOrder: k });
  invalidate();
}

async function toggle(item) {
  await item.update({ isActive: !item.isActive });
  invalidate();
}

async function countView(id) {
  await CvShowcase.increment('viewsCount', { where: { id } });
}

// Admin lists: CVs made with the builder, and imported CV files (profiles and applications).
async function builtCvs({ q = '', limit = 100 } = {}) {
  const where = { cvBuilt: { [Op.ne]: null } };
  if (q) where[Op.or] = [{ firstName: { [Op.like]: `%${q}%` } }, { lastName: { [Op.like]: `%${q}%` } }, { email: { [Op.like]: `%${q}%` } }, { headline: { [Op.like]: `%${q}%` } }];
  return User.findAll({
    where,
    attributes: ['id', 'username', 'firstName', 'lastName', 'email', 'role', 'headline', 'city', 'cvUrl', 'cvName', 'cvBuilt', 'cvShowcaseRefused', 'isBanned', 'updatedAt'],
    order: [['updatedAt', 'DESC']],
    limit,
  });
}

async function importedCvs({ q = '', limit = 100 } = {}) {
  const where = { cvUrl: { [Op.ne]: null }, cvBuilt: null };
  if (q) where[Op.or] = [{ firstName: { [Op.like]: `%${q}%` } }, { lastName: { [Op.like]: `%${q}%` } }, { email: { [Op.like]: `%${q}%` } }];
  return User.findAll({
    where,
    attributes: ['id', 'username', 'firstName', 'lastName', 'email', 'role', 'headline', 'city', 'cvUrl', 'cvName', 'cvShowcaseRefused', 'isBanned', 'updatedAt'],
    order: [['updatedAt', 'DESC']],
    limit,
  });
}

module.exports = {
  MAX_ITEMS, maskCv, slider, visibleItems, findVisible, addMemberCv, addUpload, remove, removeForUser, refresh,
  setImages, publicImages, fullFile, move, toggle, countView, builtCvs, importedCvs, invalidate,
};
