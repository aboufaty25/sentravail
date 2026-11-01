// Collapse the top header row on scroll down, show it again on scroll up (mobile).
(function () {
  const header = document.getElementById('app-header');
  if (!header) return;
  let lastY = window.scrollY;
  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y > lastY + 6 && y > 80) header.classList.add('is-collapsed');
        else if (y < lastY - 6 || y < 80) header.classList.remove('is-collapsed');
        lastY = y;
        ticking = false;
      });
    },
    { passive: true }
  );
})();
