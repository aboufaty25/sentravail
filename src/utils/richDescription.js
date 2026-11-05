// Job descriptions written with the rich text editor (bold, headings, lists, links…).
// Stored as sanitized HTML; older offers (and imports) keep plain text, detected and rendered
// as paragraphs. Every HTML description goes through sanitize() before being stored AND
// before being shown, so nothing outside the allowed tags can ever reach a page.
const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a'];

const OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    b: 'strong',
    i: 'em',
    div: 'p',
    h1: 'h2',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
    a: (tagName, attribs) => ({ tagName: 'a', attribs: { href: attribs.href || '', target: '_blank', rel: 'nofollow ugc noopener' } }),
  },
  exclusiveFilter: (frame) => frame.tag === 'a' && !frame.attribs.href,
  // Pasted Word/Google Docs markup: keep the text of unknown tags, drop styles and scripts.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
};

const RICH_RE = /^\s*<(p|h[1-6]|ul|ol|blockquote|div|strong|em|b|i|u|br)[\s>/]/i;

function isRich(value) {
  return RICH_RE.test(String(value || ''));
}

// options.links = false: links are reduced to their text (accounts not allowed to post links).
function sanitize(html, { links = true } = {}) {
  const opts = links ? OPTIONS : { ...OPTIONS, allowedTags: ALLOWED_TAGS.filter((t) => t !== 'a') };
  return sanitizeHtml(String(html || ''), opts)
    .replace(/<p>(\s|&nbsp;|<br \/>)*<\/p>/g, '') // empty paragraphs left by editors
    .trim();
}

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

// Plain text (excerpts, meta description, length checks, anti-scam filter).
function toText(value) {
  const v = String(value || '');
  if (!isRich(v)) return v.trim();
  const text = v
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|h2|h3|li|blockquote|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decode(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Link targets, so the anti-link rule also sees URLs hidden behind a link text.
function hrefs(value) {
  return [...String(value || '').matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1]));
}

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Plain text → paragraphs (old offers), so they display like the new ones.
function textToHtml(text) {
  return String(text || '').trim().split(/\n\s*\n/).filter(Boolean)
    .map((p) => `<p>${escape(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

// HTML to show on a page (always re-sanitized).
function toHtml(value) {
  return isRich(value) ? sanitize(value) : textToHtml(value);
}

module.exports = { ALLOWED_TAGS, isRich, sanitize, toText, toHtml, textToHtml, hrefs };
