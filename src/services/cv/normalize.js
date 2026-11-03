// Brings any saved or posted CV (including the first builder format) to the current shape,
// with safe defaults. Used for the live preview (lenient) and before strict validation.
const { TEMPLATES, SECTIONS, LANGUAGE_LEVELS } = require('../../config/cvTemplates');

const LEGACY_TEMPLATES = { classic: 'classique', modern: 'emeraude' };
const s = (v, max) => String(v ?? '').trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const month = (v) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || '')) ? String(v) : '');

function normalizeCv(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const template = TEMPLATES[raw.template] ? raw.template : LEGACY_TEMPLATES[raw.template] || 'rubis';
  const def = TEMPLATES[template];
  const p = raw.personal || {};
  const order = arr(raw.sectionOrder).filter((k) => SECTIONS.includes(k));
  return {
    template,
    color: /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : def.color,
    font: ['sans', 'serif', 'mixed'].includes(raw.font) ? raw.font : def.font,
    showPhoto: raw.showPhoto !== false,
    showLevels: raw.showLevels !== false,
    sectionOrder: [...new Set([...order, ...SECTIONS])],
    personal: {
      firstName: s(p.firstName, 60), lastName: s(p.lastName, 60), email: s(p.email, 190), phone: s(p.phone, 30),
      address: s(p.address ?? p.city, 120), nationality: s(p.nationality, 60), website: s(p.website, 120), license: s(p.license, 60),
      photoUrl: /^(\/uploads\/|https:\/\/res\.cloudinary\.com\/)/.test(p.photoUrl || '') ? s(p.photoUrl, 500) : '',
    },
    title: s(raw.title, 120),
    summary: s(raw.summary, 1500),
    experiences: arr(raw.experiences).slice(0, 15).map((e) => ({
      title: s(e.title, 120), company: s(e.company, 120), city: s(e.city, 80), start: month(e.start), end: month(e.end), current: !!e.current, description: s(e.description, 2000),
    })),
    educations: arr(raw.educations).slice(0, 10).map((e) => ({
      degree: s(e.degree, 120), school: s(e.school, 120), city: s(e.city, 80), start: month(e.start), end: month(e.end), current: !!e.current, description: s(e.description, 1000),
    })),
    skills: arr(raw.skills).slice(0, 30).map((k) => (typeof k === 'string' ? { name: s(k, 60), level: 0 } : { name: s(k.name, 60), level: Math.max(0, Math.min(5, Number(k.level) || 0)) })).filter((k) => k.name),
    languages: arr(raw.languages).slice(0, 10).map((l) => ({ name: s(l.name, 40), level: LANGUAGE_LEVELS.includes(l.level) ? l.level : 'Courant' })).filter((l) => l.name),
    qualities: arr(raw.qualities).slice(0, 12).map((q) => s(q, 60)).filter(Boolean),
    interests: arr(raw.interests).slice(0, 12).map((q) => s(q, 60)).filter(Boolean),
    certificates: arr(raw.certificates).slice(0, 12).map((c) => ({ name: s(c.name, 140), year: s(c.year, 20) })).filter((c) => c.name),
    custom: { title: s(raw.custom?.title, 60), text: s(raw.custom?.text, 1500) },
  };
}

function hasContent(cv, key) {
  switch (key) {
    case 'summary': return !!cv.summary;
    case 'custom': return !!cv.custom.text;
    default: return Array.isArray(cv[key]) && cv[key].length > 0;
  }
}

module.exports = { normalizeCv, hasContent, LEGACY_TEMPLATES };
