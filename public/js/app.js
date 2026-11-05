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

  // Admin branding images (input[data-brand]): processed in the browser before upload.
  //  - logo: max 800 px, PNG kept (transparency); - photo: max 1600 px JPEG;
  //  - icon: centre-cropped square PNG 512 px, plus a 192 px copy in the sibling input[name=icon192].
  async function drawSquare(bitmap, size) {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return new Promise((r) => canvas.toBlob(r, 'image/png'));
  }
  async function scalePng(bitmap, max) {
    const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((r) => canvas.toBlob(r, 'image/png'));
  }
  document.addEventListener('change', async (e) => {
    const input = e.target;
    if (!input.matches || !input.matches('input[type=file][data-brand]') || !input.files[0] || !window.DataTransfer) return;
    const kind = input.dataset.brand;
    const original = input.files[0];
    let file = original;
    try {
      if (kind === 'photo') file = await resizeImage(original, 1600, 0.85);
      else {
        const bitmap = await createImageBitmap(original, { imageOrientation: 'from-image' });
        const base = original.name.replace(/\.\w+$/, '');
        if (kind === 'icon') {
          if (bitmap.width < 192 || bitmap.height < 192) toast("Image trop petite : 512 × 512 px minimum conseillé.", 'error');
          file = new File([await drawSquare(bitmap, 512)], `${base}-512.png`, { type: 'image/png' });
          const small = input.form && input.form.querySelector('input[name=icon192]');
          if (small) { const dt2 = new DataTransfer(); dt2.items.add(new File([await drawSquare(bitmap, 192)], `${base}-192.png`, { type: 'image/png' })); small.files = dt2.files; }
        } else {
          file = new File([await scalePng(bitmap, 800)], `${base}.png`, { type: 'image/png' });
        }
      }
    } catch (_) { file = original; }
    if (file.size > 2 * 1024 * 1024) { toast("L'image doit faire moins de 2 Mo.", 'error'); input.value = ''; return; }
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new CustomEvent('brand-ready', { detail: { url: URL.createObjectURL(file) } }));
  });

  // Profile photo / cover (input[data-crop="avatar|cover"]): centre-cropped and compressed in
  // the browser (square 480 px / 3:1 1500×500 px JPEG), then the form is sent right away.
  document.addEventListener('change', async (e) => {
    const input = e.target;
    if (!input.matches || !input.matches('input[type=file][data-crop]') || !input.files[0]) return;
    const kind = input.dataset.crop;
    const original = input.files[0];
    let file = original;
    try {
      const bitmap = await createImageBitmap(original, { imageOrientation: 'from-image' });
      const [ratio, outW] = kind === 'cover' ? [3, 1500] : [1, 480];
      let sw = bitmap.width;
      let sh = sw / ratio;
      if (sh > bitmap.height) { sh = bitmap.height; sw = sh * ratio; }
      const w = Math.min(outW, Math.round(sw));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = Math.round(w / ratio);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
      if (blob && window.DataTransfer) {
        file = new File([blob], `${kind}.jpg`, { type: 'image/jpeg' });
        const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
      }
    } catch (_) { /* old browsers: send the original */ }
    if (file.size > 2 * 1024 * 1024) { toast("L'image doit faire moins de 2 Mo.", 'error'); input.value = ''; return; }
    const form = input.form;
    if (form) { form.classList.add('opacity-60', 'pointer-events-none'); form.submit(); }
  });

  // ---------- PWA ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    window.dispatchEvent(new CustomEvent('st-installable'));
  });

  // ---------- Real-time notifications (Socket.io; long-polling fallback if WebSockets are blocked) ----------
  function setBadges(n) {
    document.querySelectorAll('[data-notif-badge]').forEach((b) => {
      b.textContent = n > 99 ? '99+' : String(n);
      b.classList.toggle('hidden', !n);
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.io || !document.querySelector('[data-notif-badge]')) return;
    const socket = window.io({ withCredentials: true });
    socket.on('notification', (d) => {
      if (location.pathname === '/notifications') { location.reload(); return; }
      setBadges(d.unseen);
      toast(d.text);
    });
    socket.on('notification:count', (d) => setBadges(d.unseen));
  });

  // Image inputs marked data-compress: resized/compressed in the browser before upload (≤ 2 MB).
  document.addEventListener('change', async (e) => {
    const input = e.target;
    if (!input.matches || !input.matches('input[type=file][data-compress]') || !input.files[0] || !window.DataTransfer) return;
    const file = await resizeImage(input.files[0], 1600, 0.82);
    if (file.size > 2 * 1024 * 1024) { toast("L'image doit faire moins de 2 Mo.", 'error'); input.value = ''; return; }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  });

  // Actions reserved to members: any [data-login] element opens "Connectez-vous pour continuer".
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-login]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('require-login', { detail: { message: el.dataset.login, retour: el.dataset.loginRetour } }));
  }, true);


  // ---------- CV showcase ("Vitrine des CV") ----------
  // Slider (feed, offer page): round arrows on a computer scroll the tray by a screenful.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-reels-prev],[data-reels-next]');
    if (!btn) return;
    const track = btn.closest('[data-reels]')?.querySelector('[data-reels-track]');
    if (!track) return;
    const dir = btn.hasAttribute('data-reels-next') ? 1 : -1;
    track.scrollBy({ left: dir * Math.max(200, track.clientWidth * 0.8), behavior: 'smooth' });
  });
  function updateReelArrows(track) {
    const root = track.closest('[data-reels]');
    if (!root) return;
    const prev = root.querySelector('[data-reels-prev]');
    const next = root.querySelector('[data-reels-next]');
    if (prev) prev.classList.toggle('invisible', track.scrollLeft < 8);
    if (next) next.classList.toggle('invisible', track.scrollLeft + track.clientWidth >= track.scrollWidth - 8);
  }
  function watchReels(root) {
    (root || document).querySelectorAll('[data-reels-track]:not([data-reels-ready])').forEach((track) => {
      track.dataset.reelsReady = '1';
      track.addEventListener('scroll', () => updateReelArrows(track), { passive: true });
      updateReelArrows(track);
    });
  }
  document.addEventListener('DOMContentLoaded', () => watchReels(document));
  document.addEventListener('htmx:afterSettle', (e) => watchReels(e.target));

  // Full-screen viewer: start on the chosen CV, arrows and keyboard on a computer.
  document.addEventListener('DOMContentLoaded', () => {
    const viewer = document.querySelector('[data-reels-viewer]');
    const scroller = viewer && viewer.querySelector('[data-reels-scroller]');
    if (!scroller) return;
    const start = viewer.dataset.start && document.getElementById(`cv-${viewer.dataset.start}`);
    if (start) scroller.scrollTop = start.offsetTop;
    const step = (dir) => scroller.scrollBy({ top: dir * scroller.clientHeight, behavior: 'smooth' });
    viewer.querySelector('[data-reels-up]')?.addEventListener('click', () => step(-1));
    viewer.querySelector('[data-reels-down]')?.addEventListener('click', () => step(1));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
      if (e.key === 'Escape') viewer.querySelector('[data-reels-close]')?.click();
    });
    // Close: back to the page the visitor came from on this site.
    viewer.querySelector('[data-reels-close]')?.addEventListener('click', (e) => {
      if (document.referrer.startsWith(location.origin) && history.length > 1) { e.preventDefault(); history.back(); }
    });
  });

  // Native share sheet on phones, WhatsApp otherwise.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('[data-share-native]');
    if (!btn) return;
    const url = btn.dataset.shareNative;
    if (navigator.share) {
      try { await navigator.share({ url, title: btn.dataset.shareTitle || document.title }); } catch (_) { /* cancelled */ }
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(url)}`, '_blank', 'noopener');
  });

  // Admin: first-page images of showcase CVs, rendered here with pdf.js (the server cannot
  // rasterise PDFs on shared hosting): a small one for the cards, a large one for the viewer.
  document.addEventListener('DOMContentLoaded', async () => {
    const pending = [...document.querySelectorAll('[data-cv-thumb]')];
    if (!pending.length) return;
    let lib;
    try {
      lib = await import('/vendor/pdfjs/pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    } catch (_) { return; }
    const render = async (page, width) => {
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    };
    for (const el of pending) {
      try {
        el.dataset.state = 'working';
        const data = await (await fetch(el.dataset.cvThumb, { credentials: 'same-origin' })).arrayBuffer();
        const doc = await lib.getDocument({ data }).promise;
        const page = await doc.getPage(1);
        const [small, large] = await Promise.all([render(page, 320), render(page, 960)]);
        const body = new FormData();
        body.append('small', small, 'small.jpg');
        body.append('large', large, 'large.jpg');
        const res = await fetch(el.dataset.upload, { method: 'POST', body, headers: { 'X-CSRF-Token': csrf(), Accept: 'application/json' } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'upload');
        const img = el.querySelector('img') || document.createElement('img');
        img.src = json.thumbnail;
        img.alt = '';
        img.className = 'h-full w-full object-cover object-top';
        el.replaceChildren(img);
        el.dataset.state = 'done';
      } catch (_) {
        el.dataset.state = 'failed';
        const msg = el.querySelector('[data-thumb-msg]');
        if (msg) msg.textContent = 'Miniature impossible';
      }
    }
  });

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

    // "Postuler": form -> opens the mail app (mailto:) -> "did you send it?" -> done.
    Alpine.data('applyModal', (cfg) => ({
      open: false,
      step: 'form',
      job: { slug: '', title: '', company: '' },
      loggedIn: cfg.loggedIn,
      profileCv: cfg.profileCv,
      f: { firstName: '', lastName: '', email: '', phone: '', message: '', website: '' },
      cvSource: cfg.profileCv ? 'profile' : 'upload',
      saveToProfile: false,
      file: null,
      errors: {},
      error: '',
      sending: false,
      appId: null,
      mailto: '',
      doneMessage: '',
      show(d) {
        this.job = { slug: d.slug, title: d.title, company: d.company, mode: d.mode || 'email' };
        this.errors = {};
        this.error = '';
        if (d.pendingId) {
          this.appId = d.pendingId;
          this.mailto = '';
          this.step = 'confirm';
        } else {
          this.step = 'form';
          this.f = { ...this.f, ...cfg.prefill, message: this.f.message };
          // Coming back from the CV builder: restore what was typed.
          try {
            const saved = JSON.parse(sessionStorage.getItem('st-apply-form') || 'null');
            if (saved && saved.slug === d.slug) this.f = { ...this.f, ...saved.f };
            sessionStorage.removeItem('st-apply-form');
          } catch (_) { /* storage unavailable */ }
        }
        this.open = true;
        document.body.style.overflow = 'hidden';
      },
      close() {
        this.open = false;
        document.body.style.overflow = '';
      },
      pick(e) {
        const file = e.target.files[0];
        this.errors.cv = '';
        if (!file) return;
        if (!/\.(pdf|docx?)$/i.test(file.name)) { this.errors.cv = 'Le CV doit être un fichier PDF ou Word (.doc, .docx).'; return; }
        if (file.size > 5 * 1024 * 1024) { this.errors.cv = 'Le CV doit faire moins de 5 Mo.'; return; }
        this.file = file;
        this.cvSource = 'upload';
      },
      async post(url, body) {
        const res = await fetch(url, { method: 'POST', body, headers: { 'X-CSRF-Token': csrf(), Accept: 'application/json' } });
        const json = await res.json().catch(() => ({}));
        return { ok: res.ok, json };
      },
      async submit() {
        this.errors = {};
        this.error = '';
        if (this.cvSource === 'upload' && !this.file) { this.errors.cv = 'Ajoutez votre CV (PDF ou Word, 5 Mo maximum).'; return; }
        const data = new FormData();
        Object.entries(this.f).forEach(([k, v]) => data.append(k, v || ''));
        data.append('cvSource', this.cvSource);
        if (this.saveToProfile) data.append('saveToProfile', 'on');
        if (this.cvSource === 'upload') data.append('cv', this.file, this.file.name);
        this.sending = true;
        try {
          const { ok, json } = await this.post(`/offres/${this.job.slug}/postuler`, data);
          if (!ok) {
            this.errors = json.errors || {};
            this.error = json.error || (json.errors ? 'Corrigez les champs indiqués.' : 'Envoi impossible. Réessayez.');
            return;
          }
          this.appId = json.id;
          if (json.sent) { // on-platform recruitment: received right away
            if (window.stTrack) window.stTrack('generate_lead', { method: 'platform', job: this.job.slug });
            this.doneMessage = json.message;
            this.step = 'done';
            return;
          }
          this.mailto = json.mailto;
          this.step = 'confirm';
          window.location.href = this.mailto; // opens the device's mail app
        } catch (_) {
          this.error = 'Pas de connexion internet. Réessayez.';
        } finally {
          this.sending = false;
        }
      },
      async reopen() {
        if (!this.mailto) {
          const { ok, json } = await this.post(`/candidatures/${this.appId}/mailto`);
          if (!ok) { this.error = json.error || 'Impossible de rouvrir la messagerie.'; return; }
          this.mailto = json.mailto;
        }
        window.location.href = this.mailto;
      },
      async finish(url) {
        this.error = '';
        this.sending = true;
        try {
          const { ok, json } = await this.post(url);
          if (!ok) { this.error = json.error || 'Une erreur est survenue. Réessayez.'; return; }
          this.doneMessage = json.message;
          this.step = 'done';
          if (window.stTrack) window.stTrack('generate_lead', { method: url.endsWith('/envoyer') ? 'server' : 'mailto', job: this.job.slug });
        } catch (_) {
          this.error = 'Pas de connexion internet. Réessayez.';
        } finally {
          this.sending = false;
        }
      },
      createCv() {
        try { sessionStorage.setItem('st-apply-form', JSON.stringify({ slug: this.job.slug, f: this.f })); } catch (_) { /* ignore */ }
        const back = `/offres/${this.job.slug}?postuler=1`;
        if (!this.loggedIn) {
          // The CV builder needs an account: log in, then come back to this application.
          this.close();
          window.dispatchEvent(new CustomEvent('require-login', { detail: { message: 'Créez un compte gratuit pour fabriquer votre CV. Vous pouvez aussi postuler tout de suite en important un CV existant.', retour: back } }));
          return;
        }
        window.location.href = `/cv/creer?retour=${encodeURIComponent(back)}`;
      },
      confirmSent() { return this.finish(`/candidatures/${this.appId}/confirmer`); },
      sendViaServer() { return this.finish(`/candidatures/${this.appId}/envoyer`); },
    }));

    // CV builder: 8 steps, live preview (the real PDF, rendered with pdf.js), draft saved
    // locally, one-click download. The pdf.js document lives outside Alpine's reactive state.
    Alpine.data('cvBuilder', (cfg) => {
      const draftKey = `st-cv-draft-${cfg.userKey}`;
      let uid = 0;
      const withIds = (list) => (list || []).map((x) => ({ ...x, _id: ++uid }));
      const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
      const STEP_OF = { template: 0, color: 0, font: 0, personal: 1, title: 2, summary: 2, experiences: 3, educations: 4, skills: 5, languages: 5, qualities: 6, interests: 6, certificates: 6, custom: 6 };
      const LABELS = { modele: 'Modèle', infos: 'Coordonnées', profil: 'Profil', experiences: 'Expériences', formations: 'Formation', competences: 'Compétences', plus: 'Plus', terminer: 'Terminer' };
      let pdfDoc = null;
      let pdfjsLib = null;
      let previewTimer = null;
      let controller = null;
      let paintToken = 0;

      const fromData = (d) => ({
        template: d.template,
        color: d.color,
        font: d.font,
        showPhoto: d.showPhoto !== false,
        showLevels: d.showLevels !== false,
        sectionOrder: [...(d.sectionOrder || cfg.options.SECTIONS)],
        personal: { firstName: '', lastName: '', email: '', phone: '', address: '', nationality: '', website: '', license: '', photoUrl: '', ...d.personal },
        title: d.title || '',
        summary: d.summary || '',
        experiences: withIds(d.experiences),
        educations: withIds(d.educations),
        skills: withIds((d.skills || []).map((s) => (typeof s === 'string' ? { name: s, level: 0 } : s))),
        languages: withIds(d.languages),
        qualities: [...(d.qualities || [])],
        interests: [...(d.interests || [])],
        certificates: withIds(d.certificates),
        custom: { title: '', text: '', ...(d.custom || {}) },
      });
      let start = cfg.initial;
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
        if (draft && draft.personal && draft.version === 2) start = draft.cv;
      } catch (_) { /* storage unavailable */ }

      async function loadPdfJs() {
        if (!pdfjsLib) {
          pdfjsLib = await import('/vendor/pdfjs/pdf.min.mjs');
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
        }
        return pdfjsLib;
      }

      // Renders the pages into a container (replaced at once, no flicker).
      async function paintInto(container, { maxPages = Infinity, token }) {
        if (!container || !pdfDoc) return;
        const width = container.clientWidth - (container.dataset.preview === 'thumb' ? 0 : 24);
        if (width <= 0) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const frag = document.createDocumentFragment();
        for (let i = 1; i <= Math.min(pdfDoc.numPages, maxPages); i += 1) {
          const page = await pdfDoc.getPage(i);
          if (token !== paintToken) return; // a newer preview is on its way
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${width}px`;
          canvas.style.height = `${(width * base.height) / base.width}px`;
          canvas.className = container.dataset.preview === 'thumb' ? 'block' : 'mx-auto block bg-white shadow-md';
          canvas.setAttribute('aria-label', `Page ${i}`);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          frag.appendChild(canvas);
        }
        if (token !== paintToken) return;
        container.replaceChildren(frag);
      }

      return {
        options: cfg.options,
        steps: cfg.steps,
        step: 0,
        cv: fromData(start),
        newSkill: '',
        newQuality: '',
        newInterest: '',
        uploading: false,
        saving: false,
        saved: null,
        savedDraft: false,
        error: '',
        errors: {},
        previewLoading: false,
        previewError: '',
        pageCount: 0,
        mobilePreview: false,
        init() {
          let t;
          this.$watch('cv', () => {
            clearTimeout(t);
            t = setTimeout(() => {
              try { localStorage.setItem(draftKey, JSON.stringify({ version: 2, cv: this.payload() })); this.savedDraft = true; setTimeout(() => { this.savedDraft = false; }, 1500); } catch (_) { /* ignore */ }
            }, 600);
            this.schedulePreview();
          });
          this.refreshPreview();
          let resize;
          window.addEventListener('resize', () => { clearTimeout(resize); resize = setTimeout(() => this.paint(), 250); });
        },
        // Data sent to the server (without the list ids used by the form).
        payload() {
          const strip = (list) => list.map(({ _id, ...rest }) => rest);
          const c = this.cv;
          return { ...c, experiences: strip(c.experiences), educations: strip(c.educations), skills: strip(c.skills), languages: strip(c.languages), certificates: strip(c.certificates) };
        },
        stepLabel(i = this.step) { return LABELS[this.steps[i]] || ''; },
        go(i) {
          this.step = Math.max(0, Math.min(this.steps.length - 1, i));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        month(v) { if (!v) return ''; const [y, m] = v.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; },
        periodLabel(e) {
          const s = this.month(e.start);
          const end = e.current ? "aujourd'hui" : this.month(e.end);
          return s && end ? `${s} – ${end}` : s || end || '';
        },
        move(list, i, delta) { const j = i + delta; if (j < 0 || j >= list.length) return; const [item] = list.splice(i, 1); list.splice(j, 0, item); },
        chooseTemplate(key) {
          const previousDefault = this.options.TEMPLATES[this.cv.template]?.color;
          this.cv.template = key;
          // Follow the template's own color unless the person picked another one.
          if (!this.cv.color || this.cv.color === previousDefault) this.cv.color = this.options.TEMPLATES[key].color;
          this.cv.font = this.options.TEMPLATES[key].font;
        },
        add(list) {
          const blank = {
            experiences: { title: '', company: '', city: '', start: '', end: '', current: false, description: '' },
            educations: { degree: '', school: '', city: '', start: '', end: '', current: false, description: '' },
            certificates: { name: '', year: '' },
          }[list];
          this.cv[list].push({ _id: ++uid, ...blank });
        },
        addSkill() {
          const s = this.newSkill.trim();
          if (s && !this.cv.skills.some((k) => k.name.toLowerCase() === s.toLowerCase()) && this.cv.skills.length < 30) this.cv.skills.push({ _id: ++uid, name: s, level: 0 });
          this.newSkill = '';
        },
        addLanguage(name) { if (this.cv.languages.length < 10) this.cv.languages.push({ _id: ++uid, name, level: ['Wolof', 'Pulaar', 'Sérère', 'Diola'].includes(name) ? 'Langue maternelle' : 'Courant' }); },
        addChip(list, value) {
          const v = String(value || '').trim();
          if (v && !this.cv[list].includes(v) && this.cv[list].length < 12) this.cv[list].push(v);
        },
        sectionLabel(key) { return key === 'custom' && this.cv.custom.title ? this.cv.custom.title : this.options.SECTION_LABELS[key]; },
        filled(key) {
          if (key === 'summary') return !!this.cv.summary.trim();
          if (key === 'custom') return !!this.cv.custom.text.trim();
          return this.cv[key].length > 0;
        },
        checklist() {
          const c = this.cv;
          const out = [];
          if (!c.personal.firstName || !c.personal.lastName || !c.personal.email) out.push({ text: 'Renseignez vos nom, prénom et email', step: 1 });
          if (!c.title) out.push({ text: 'Ajoutez votre titre professionnel', step: 2 });
          if (!c.summary) out.push({ text: 'Rédigez quelques lignes de profil', step: 2 });
          if (!c.experiences.length) out.push({ text: 'Ajoutez au moins une expérience', step: 3 });
          if (!c.educations.length) out.push({ text: 'Ajoutez votre formation', step: 4 });
          if (!c.skills.length) out.push({ text: 'Listez vos compétences', step: 5 });
          return out;
        },
        restart() {
          if (!window.confirm('Recommencer à partir de votre profil ? Le brouillon actuel sera effacé.')) return;
          try { localStorage.removeItem(draftKey); } catch (_) { /* ignore */ }
          this.cv = fromData(cfg.initial);
          this.go(0);
        },
        async uploadPhoto(e) {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file) return;
          this.uploading = true;
          try {
            const data = new FormData();
            data.append('photo', await resizeImage(file, 700, 0.88), 'photo.jpg');
            const res = await fetch('/cv/photo', { method: 'POST', body: data, headers: { 'X-CSRF-Token': csrf(), Accept: 'application/json' } });
            const json = await res.json().catch(() => ({}));
            if (res.ok) { this.cv.personal.photoUrl = json.url; this.cv.showPhoto = true; } else toast(json.error || 'Envoi de la photo impossible.', 'error');
          } catch (_) { toast('Pas de connexion internet.', 'error'); }
          this.uploading = false;
        },

        // ---------- Live preview ----------
        schedulePreview() {
          clearTimeout(previewTimer);
          previewTimer = setTimeout(() => this.refreshPreview(), 650);
        },
        async refreshPreview() {
          if (controller) controller.abort();
          controller = new AbortController();
          this.previewLoading = true;
          try {
            const [lib, res] = await Promise.all([
              loadPdfJs(),
              fetch('/cv/apercu', { method: 'POST', signal: controller.signal, headers: { 'X-CSRF-Token': csrf(), 'Content-Type': 'application/json', Accept: 'application/pdf' }, body: JSON.stringify(this.payload()) }),
            ]);
            if (!res.ok) throw new Error(res.status === 429 ? "Trop d'aperçus, patientez quelques secondes." : 'Aperçu indisponible.');
            const data = new Uint8Array(await res.arrayBuffer());
            const next = await lib.getDocument({ data, isEvalSupported: false }).promise;
            if (pdfDoc) pdfDoc.destroy();
            pdfDoc = next;
            this.pageCount = pdfDoc.numPages;
            this.previewError = '';
            await this.paint();
          } catch (err) {
            if (err.name !== 'AbortError') this.previewError = err.message && err.message.length < 80 ? err.message : 'Aperçu indisponible.';
          } finally {
            this.previewLoading = false;
          }
        },
        async paint() {
          paintToken += 1;
          const token = paintToken;
          const desk = this.$refs.desk;
          if (desk && desk.offsetParent) await paintInto(desk, { token });
          await paintInto(this.$refs.thumb, { maxPages: 1, token });
          if (this.mobilePreview) await paintInto(this.$refs.full, { token });
        },
        openPreview() {
          this.mobilePreview = true;
          this.$nextTick(() => this.paint());
        },

        // ---------- One-click download ----------
        validate() {
          const p = this.cv.personal;
          const errors = {};
          if (p.firstName.trim().length < 2) errors['personal.firstName'] = 'Prénom requis.';
          if (p.lastName.trim().length < 2) errors['personal.lastName'] = 'Nom requis.';
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) errors['personal.email'] = 'Adresse email invalide.';
          if (this.cv.title.trim().length < 2) errors.title = 'Indiquez votre titre professionnel.';
          this.errors = errors;
          const first = Object.keys(errors)[0];
          if (first) { this.mobilePreview = false; this.go(STEP_OF[first.split('.')[0]]); toast(errors[first], 'error'); return false; }
          return true;
        },
        async download() {
          this.error = '';
          if (!this.validate()) return;
          this.saving = true;
          try {
            const res = await fetch('/cv/creer', {
              method: 'POST',
              headers: { 'X-CSRF-Token': csrf(), 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ ...this.payload(), returnTo: cfg.returnTo }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              this.error = json.error || 'Enregistrement impossible. Vérifiez les informations.';
              const first = (json.path || '').split('.')[0];
              if (first in STEP_OF) { this.mobilePreview = false; this.go(STEP_OF[first]); }
              toast(this.error, 'error');
              return;
            }
            // Download right away (signed link to the stored PDF).
            const a = document.createElement('a');
            a.href = json.downloadPath;
            a.download = json.fileName || 'CV.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            this.saved = json;
            try { localStorage.removeItem(draftKey); } catch (_) { /* ignore */ }
            toast('CV téléchargé et enregistré dans votre profil.');
            if (json.returnTo) setTimeout(() => { window.location.href = json.returnTo; }, 1200);
            else { this.mobilePreview = false; this.go(this.steps.length - 1); }
          } catch (_) {
            this.error = 'Pas de connexion internet. Réessayez.';
          } finally {
            this.saving = false;
          }
        },
      };
    });

    Alpine.data('reportSheet', () => ({
      open: false, target: null, reason: '', details: '', error: '', sending: false,
      show(d) { Object.assign(this, { target: d, reason: '', details: '', error: '', open: true }); },
      close() { this.open = false; },
      async send() {
        this.sending = true; this.error = '';
        try {
          const res = await fetch('/signalements', {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrf(), 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ targetType: this.target.type, targetId: this.target.id, reason: this.reason, details: this.details }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) { this.error = json.error || 'Signalement impossible.'; return; }
          toast(json.message);
          this.close();
        } catch (_) { this.error = 'Pas de connexion internet.'; } finally { this.sending = false; }
      },
    }));

    // "Installer l'application" banner (Android/desktop prompt, iOS instructions). Hidden 30 days after dismissal.
    Alpine.data('installPrompt', () => ({
      show: false,
      ios: false,
      init() {
        const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
        let dismissed = 0;
        try { dismissed = Number(localStorage.getItem('st-install-dismissed') || 0); } catch (_) { /* ignore */ }
        if (standalone || Date.now() - dismissed < 30 * 864e5) return;
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
        if (isIos) { this.ios = true; setTimeout(() => this.reveal(), 4000); return; }
        if (deferredInstall) this.reveal();
        window.addEventListener('st-installable', () => this.reveal());
      },
      reveal() {
        this.show = true;
      },
      async install() {
        if (!deferredInstall) return;
        deferredInstall.prompt();
        await deferredInstall.userChoice.catch(() => null);
        deferredInstall = null;
        this.show = false;
      },
      dismiss() {
        this.show = false;
        try { localStorage.setItem('st-install-dismissed', String(Date.now())); } catch (_) { /* ignore */ }
      },
    }));

    Alpine.data('loginPrompt', () => ({
      open: false,
      message: '',
      retour: '/',
      show(d = {}) {
        this.message = d.message || 'Créez un compte gratuit ou connectez-vous pour utiliser cette fonctionnalité.';
        this.retour = d.retour || location.pathname + location.search + location.hash;
        this.open = true;
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
