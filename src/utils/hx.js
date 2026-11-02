// HX-Trigger header for htmx. HTTP headers only accept Latin-1, so every non-ASCII
// character (’, é, emojis…) is escaped as \uXXXX inside the JSON (htmx decodes it).
function hxTrigger(res, payload) {
  const json = JSON.stringify(payload).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  res.set('HX-Trigger', json);
}

module.exports = { hxTrigger };
