/* AdSense loader with cookie consent and viewability-first lazy loading.
 * - Nothing from Google is loaded before the visitor accepts; if they refuse, no ads at all.
 *   The choice is stored for 12 months in the "st_consent" cookie and can be changed with
 *   any [data-consent-reset] link.
 * - Each ad unit is requested only when it is about to enter the screen (and never when its
 *   column is hidden, e.g. desktop sidebars on a phone), so the impressions counted are ads
 *   people actually see: better viewability, better revenue per impression. */
(function () {
  const me = document.currentScript;
  const client = me && me.dataset.client;
  if (!client) return;

  const getConsent = () => (document.cookie.match(/(?:^|;\s*)st_consent=(granted|denied)/) || [])[1] || null;
  const setConsent = (v) => {
    document.cookie = `st_consent=${v}; Max-Age=${365 * 24 * 3600}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  let loaded = false;
  let observer = null;

  function request(wrapper) {
    const ins = wrapper.querySelector('ins.adsbygoogle:not([data-adsbygoogle-status])');
    if (!ins || wrapper.dataset.adRequested) return;
    wrapper.dataset.adRequested = '1';
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) { /* ad blocked */ }
  }

  function watch(root) {
    if (!loaded) return;
    const wrappers = (root || document).querySelectorAll('[data-ad-slot-wrapper]:not([data-ad-watched])');
    wrappers.forEach((w) => {
      w.dataset.adWatched = '1';
      w.classList.remove('hidden');
      if (observer) observer.observe(w);
      else request(w); // very old browsers
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
    if ('IntersectionObserver' in window) {
      // Request slightly before the unit scrolls in (ads take a moment to render),
      // only for units that are really displayed (a hidden column never intersects).
      observer = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting || !e.target.offsetParent) return;
          observer.unobserve(e.target);
          request(e.target);
        });
      }, { rootMargin: '0px 0px 200px 0px', threshold: 0 });
    }
    watch(document);
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
  document.addEventListener('htmx:afterSettle', (e) => watch(e.target));
})();
