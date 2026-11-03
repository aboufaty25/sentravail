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

    // CV builder: 7 steps, live preview, draft saved locally, PDF generated server-side.
    Alpine.data('cvBuilder', (cfg) => {
      const draftKey = `st-cv-draft-${cfg.userKey}`;
      let uid = 0;
      const withIds = (list) => (list || []).map((x) => ({ ...x, _id: ++uid }));
      let start = cfg.initial;
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
        if (draft && draft.personal) start = draft;
      } catch (_) { /* storage unavailable */ }
      const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
      const STEP_OF = { personal: 0, title: 1, summary: 1, experiences: 2, educations: 3, skills: 4, languages: 5, template: 6 };
      return {
        step: 0,
        tab: 'edit',
        cv: {
          template: start.template || 'classic',
          personal: { firstName: '', lastName: '', email: '', phone: '', city: '', photoUrl: '', ...start.personal },
          title: start.title || '',
          summary: start.summary || '',
          experiences: withIds(start.experiences),
          educations: withIds(start.educations),
          skills: [...(start.skills || [])],
          languages: withIds(start.languages),
        },
        levels: cfg.levels,
        newSkill: '',
        uploading: false,
        saving: false,
        savedDraft: false,
        error: '',
        init() {
          let t;
          this.$watch('cv', () => {
            clearTimeout(t);
            t = setTimeout(() => {
              try { localStorage.setItem(draftKey, JSON.stringify(this.cv)); this.savedDraft = true; setTimeout(() => { this.savedDraft = false; }, 1500); } catch (_) { /* ignore */ }
            }, 600);
          });
        },
        fullName() { return `${this.cv.personal.firstName} ${this.cv.personal.lastName}`.trim(); },
        month(v) { if (!v) return ''; const [y, m] = v.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; },
        period(e) {
          const s = this.month(e.start);
          const end = e.current ? "aujourd'hui" : this.month(e.end);
          return s && end ? `${s} — ${end}` : s || end || '';
        },
        go(i) {
          this.step = Math.max(0, Math.min(6, i));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        move(list, i, delta) { const j = i + delta; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; },
        addExperience() { this.cv.experiences.push({ _id: ++uid, title: '', company: '', city: '', start: '', end: '', current: false, description: '' }); },
        addEducation() { this.cv.educations.push({ _id: ++uid, degree: '', school: '', city: '', start: '', end: '' }); },
        addSkill() {
          const s = this.newSkill.trim();
          if (s && !this.cv.skills.includes(s) && this.cv.skills.length < 30) this.cv.skills.push(s);
          this.newSkill = '';
        },
        addLanguage(name) { if (this.cv.languages.length < 8) this.cv.languages.push({ _id: ++uid, name, level: name === 'Wolof' ? 'Langue maternelle' : 'Courant' }); },
        async uploadPhoto(e) {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file) return;
          this.uploading = true;
          try {
            const data = new FormData();
            data.append('photo', await resizeImage(file, 600, 0.85), 'photo.jpg');
            const res = await fetch('/cv/photo', { method: 'POST', body: data, headers: { 'X-CSRF-Token': csrf(), Accept: 'application/json' } });
            const json = await res.json().catch(() => ({}));
            if (res.ok) this.cv.personal.photoUrl = json.url; else toast(json.error || 'Envoi de la photo impossible.', 'error');
          } catch (_) { toast('Pas de connexion internet.', 'error'); }
          this.uploading = false;
        },
        async save() {
          this.error = '';
          this.saving = true;
          try {
            const res = await fetch('/cv/creer', {
              method: 'POST',
              headers: { 'X-CSRF-Token': csrf(), 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ ...this.cv, returnTo: cfg.returnTo }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              this.error = json.error || 'Enregistrement impossible. Vérifiez les informations.';
              const first = (json.path || '').split('.')[0];
              if (first in STEP_OF && STEP_OF[first] !== 6) { this.go(STEP_OF[first]); this.tab = 'edit'; toast(this.error, 'error'); }
              return;
            }
            try { localStorage.removeItem(draftKey); } catch (_) { /* ignore */ }
            if (json.returnTo) { window.location.href = json.returnTo; return; }
            toast(json.message);
            window.location.href = json.downloadPath; // downloads the PDF
            setTimeout(() => { window.location.href = cfg.loggedIn ? '/cv' : '/'; }, 1500);
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
