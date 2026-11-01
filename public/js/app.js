/* SenTravail client script — loaded before Alpine so components register on alpine:init. */
(function () {
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
  const toast = (message, type) => window.dispatchEvent(new CustomEvent('toast', { detail: { message, type } }));

  // ---------- Collapsing header (Facebook Android behaviour) ----------
  document.addEventListener('DOMContentLoaded', () => {
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
  });

  // htmx: show server errors as toasts instead of failing silently.
  document.addEventListener('htmx:responseError', (e) => {
    const xhr = e.detail.xhr;
    if (xhr.getResponseHeader('HX-Trigger')) return; // server already sent a toast
    let message = 'Une erreur est survenue. Réessayez.';
    try { message = JSON.parse(xhr.responseText).error || message; } catch (_) { /* not JSON */ }
    toast(message, 'error');
  });
  document.addEventListener('htmx:sendError', () => toast('Pas de connexion internet. Réessayez.', 'error'));

  // ---------- Image resizing before upload ----------
  async function resizeImage(file, max = 1600, quality = 0.82) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      if (ratio === 1 && file.size < 900 * 1024) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
      return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch (_) {
      return file; // old browsers: upload the original
    }
  }

  document.addEventListener('alpine:init', () => {
    const Alpine = window.Alpine;

    // Like button: tap = like/unlike, long press (or hover on desktop) = reaction picker.
    Alpine.data('reactionButton', (postId, current) => ({
      open: false,
      timer: null,
      hoverTimer: null,
      longPressed: false,
      pressStart(e) {
        if (e.pointerType === 'mouse') return;
        this.longPressed = false;
        this.timer = setTimeout(() => {
          this.longPressed = true;
          this.open = true;
          if (navigator.vibrate) navigator.vibrate(15);
        }, 450);
      },
      pressEnd() { clearTimeout(this.timer); },
      pressCancel() { clearTimeout(this.timer); },
      hoverOpen() {
        if (!window.matchMedia('(hover: hover)').matches) return;
        clearTimeout(this.hoverTimer);
        this.hoverTimer = setTimeout(() => { this.open = true; }, 600);
      },
      hoverClose() { clearTimeout(this.hoverTimer); },
      tap() {
        if (this.longPressed) { this.longPressed = false; return; }
        clearTimeout(this.hoverTimer);
        this.send(current || 'like');
      },
      send(type) {
        this.open = false;
        window.htmx.ajax('POST', `/publications/${postId}/reaction`, {
          target: `#social-${postId}`,
          swap: 'outerHTML',
          values: { type },
          headers: { 'X-CSRF-Token': csrf() },
        });
      },
    }));

    Alpine.data('commentBox', () => ({
      parentId: '',
      replyTo: '',
      reply(id, name) {
        this.parentId = id;
        this.replyTo = name;
        this.$nextTick(() => this.$refs.input?.focus());
      },
      clear() { this.parentId = ''; this.replyTo = ''; },
    }));

    Alpine.data('composer', () => ({
      text: document.getElementById('post-text')?.value || '',
      files: [],
      previews: [],
      sending: false,
      error: '',
      async add(e) {
        this.error = '';
        const picked = [...e.target.files];
        e.target.value = '';
        for (const f of picked) {
          if (this.files.length >= 4) { this.error = '4 photos maximum par publication.'; break; }
          if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { this.error = 'Formats acceptés : JPEG, PNG, WebP.'; continue; }
          const resized = await resizeImage(f);
          if (resized.size > 5 * 1024 * 1024) { this.error = 'Chaque photo doit faire moins de 5 Mo.'; continue; }
          this.files.push(resized);
          this.previews.push(URL.createObjectURL(resized));
        }
      },
      remove(i) {
        URL.revokeObjectURL(this.previews[i]);
        this.files.splice(i, 1);
        this.previews.splice(i, 1);
      },
      async submit(form) {
        if (this.sending) return;
        this.error = '';
        this.sending = true;
        const data = new FormData();
        data.append('text', this.text);
        data.append('visibility', form.visibility.value);
        this.files.forEach((f) => data.append('photos', f, f.name));
        try {
          const res = await fetch('/publier', { method: 'POST', body: data, headers: { 'X-CSRF-Token': csrf(), Accept: 'application/json' } });
          const json = await res.json().catch(() => ({}));
          if (res.ok) { window.location.href = json.redirect || '/'; return; }
          this.error = json.error || (json.errors && Object.values(json.errors)[0]) || 'Publication impossible. Réessayez.';
        } catch (_) {
          this.error = 'Pas de connexion internet. Réessayez.';
        }
        this.sending = false;
      },
    }));

    Alpine.data('shareSheet', () => ({
      open: false, id: null, url: '', loggedIn: false, text: '', sending: false,
      show(d) { Object.assign(this, { id: d.id, url: d.url, loggedIn: !!d.loggedIn, text: '', open: true }); },
      close() { this.open = false; },
      async copy() {
        try { await navigator.clipboard.writeText(this.url); toast('Lien copié.'); } catch (_) { window.prompt('Copiez ce lien :', this.url); }
        this.close();
      },
      async shareNow() {
        this.sending = true;
        try {
          const res = await fetch(`/publications/${this.id}/partager`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrf(), 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ text: this.text, visibility: 'public' }),
          });
          const json = await res.json().catch(() => ({}));
          toast(res.ok ? json.message : json.error || 'Partage impossible.', res.ok ? undefined : 'error');
          if (res.ok) this.close();
        } catch (_) {
          toast('Pas de connexion internet. Réessayez.', 'error');
        }
        this.sending = false;
      },
    }));

    Alpine.data('toasts', () => ({
      items: [],
      push(d) {
        if (!d || !d.message) return;
        const id = Date.now() + Math.random();
        this.items.push({ id, message: d.message, type: d.type });
        setTimeout(() => { this.items = this.items.filter((t) => t.id !== id); }, 3500);
      },
    }));
  });
})();
