/* AdSense loader with cookie consent. Nothing from Google is loaded before the visitor
 * accepts; if they refuse, no ads are loaded at all. The choice is stored for 12 months
 * in the "st_consent" cookie and can be changed with any [data-consent-reset] link. */
(function () {
  const me = document.currentScript;
  const client = me && me.dataset.client;
  if (!client) return;

  const getConsent = () => (document.cookie.match(/(?:^|;\s*)st_consent=(granted|denied)/) || [])[1] || null;
  const setConsent = (v) => {
    document.cookie = `st_consent=${v}; Max-Age=${365 * 24 * 3600}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  let loaded = false;

  function fillSlots(root) {
    if (!loaded) return;
    (root || document).querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach((ins) => {
      ins.closest('[data-ad-slot-wrapper]')?.classList.remove('hidden');
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) { /* ad blocked */ }
    });
  }

  function loadAds() {
    if (loaded) return;
    loaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    document.head.appendChild(s);
    fillSlots(document);
  }

  function banner(show) {
    const el = document.getElementById('consent-banner');
    if (el) el.classList.toggle('hidden', !show);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const consent = getConsent();
    if (consent === 'granted') loadAds();
    else if (!consent) banner(true);

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-consent]');
      if (btn) {
        setConsent(btn.dataset.consent);
        banner(false);
        if (btn.dataset.consent === 'granted') loadAds();
        return;
      }
      if (e.target.closest('[data-consent-reset]')) {
        e.preventDefault();
        banner(true);
      }
    });
  });
  // Feed pages loaded by infinite scroll bring new ad slots.
  document.addEventListener('htmx:afterSettle', (e) => fillSlots(e.target));
})();
