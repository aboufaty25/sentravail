/* AdSense loader, viewability-first.
 * - The Google script loads right away (no consent banner; Google's own consent message
 *   handles visitors from Europe/UK, see AdSense > Privacy & messaging).
 * - Each unit is requested about two screens before it scrolls into view, so it is ready
 *   even when the visitor scrolls fast (a unit just passed is still requested, in case they
 *   scroll back), and never in a hidden column (desktop sidebars on a phone).
 * - A unit stays folded until Google has actually filled it: no empty box while loading,
 *   and an unfilled unit never shows at all. */
(function () {
  const me = document.currentScript;
  const client = me && me.dataset.client;
  if (!client) return;

  let observer = null;

  // Unfold a unit once Google reports it filled; drop it if unfilled. Applied to every unit
  // on the page (whichever ins Google fills), so a filled ad is never left folded.
  function applyStatus(ins) {
    const wrapper = ins.closest('[data-ad-slot-wrapper]');
    const status = ins.getAttribute('data-ad-status');
    if (!wrapper || !status) return;
    if (status === 'filled') wrapper.classList.add('ad-filled');
    else if (status === 'unfilled') wrapper.remove();
  }
  new MutationObserver((records) => records.forEach((r) => r.target.matches && r.target.matches('ins.adsbygoogle') && applyStatus(r.target)))
    .observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-ad-status'] });

  // adsbygoogle.push() fills the first empty <ins> of the page: the <ins> is created only when
  // the unit is requested, so the empty tags on the page are always the requested ones.
  function request(wrapper) {
    if (wrapper.dataset.adRequested) return;
    wrapper.dataset.adRequested = '1';
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', wrapper.dataset.adClient || client);
    ins.setAttribute('data-ad-slot', wrapper.dataset.adSlot);
    ins.setAttribute('data-ad-format', wrapper.dataset.adFormat || 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    wrapper.appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) { wrapper.remove(); /* ad blocked */ }
  }

  function watch(root) {
    (root || document).querySelectorAll('[data-ad-slot-wrapper]:not([data-ad-watched])').forEach((w) => {
      w.dataset.adWatched = '1';
      if (observer) observer.observe(w);
      else request(w); // very old browsers
    });
  }

  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  s.onerror = () => document.querySelectorAll('[data-ad-slot-wrapper]').forEach((w) => w.remove()); // blocked: no empty boxes
  document.head.appendChild(s);

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting || !e.target.offsetParent) return; // hidden column: never requested
        observer.unobserve(e.target);
        request(e.target);
      });
    }, { rootMargin: '50% 0px 200% 0px', threshold: 0 }); // two screens ahead (fast scrolling), half a screen behind
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => watch(document));
  else watch(document);
  // Feed pages loaded by infinite scroll bring new ad slots.
  document.addEventListener('htmx:afterSettle', (e) => watch(e.target));
})();
