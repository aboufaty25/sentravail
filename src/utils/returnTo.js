// Only same-site relative paths are accepted as "come back here after login" targets
// (no open redirect: "//evil.com", "https://…", "/\evil" are refused).
function safeReturn(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  if (!/^\/(?![/\\])[\w\-/.?=&%:+~#À-ÿ]*$/.test(value)) return null;
  if (/^\/(connexion|inscription|deconnexion)\b/.test(value)) return null;
  return value;
}

module.exports = { safeReturn };
