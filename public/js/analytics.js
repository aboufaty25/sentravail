/* Google Analytics 4 (gtag.js), loaded without inline script (strict CSP).
 * data-id: measurement id; data-events: JSON list of events queued by the server
 * (sign_up, login…); other pages can call window.stTrack(name, params). */
(function () {
  const me = document.currentScript;
  const id = me && me.dataset.id;
  if (!id) return;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); } // eslint-disable-line prefer-rest-params
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id, me.dataset.user ? { user_properties: { role: me.dataset.user } } : {});
  try { JSON.parse(me.dataset.events || '[]').forEach((e) => gtag('event', e.name, e.params || {})); } catch (_) { /* ignore */ }
  window.stTrack = (name, params) => gtag('event', name, params || {});
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
})();
