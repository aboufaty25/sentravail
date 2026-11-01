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

  // ---------- Videos ----------
  // Slow or data-saving connections: no autoplay in the feed (tap to open the reel).
  function slowConnection() {
    const c = navigator.connection;
    return !!(c && (c.saveData || /(^|-)2g$|3g/.test(c.effectiveType || '')));
  }

  // Feed reels: load the video only when visible, play muted, pause when scrolled away.
  const feedObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      entries.forEach(({ target: v, isIntersecting, intersectionRatio }) => {
        if (isIntersecting && intersectionRatio >= 0.6 && !slowConnection()) {
          if (!v.src) v.src = v.dataset.src;
          v.play().catch(() => {});
        } else if (!v.paused) {
          v.pause();
        }
      });
    }, { threshold: [0, 0.6] })
    : null;
  function watchFeedVideos(root) {
    if (!feedObserver) return;
    root.querySelectorAll('video[data-feed-video]:not([data-watched])').forEach((v) => {
      v.dataset.watched = '1';
      feedObserver.observe(v);
    });
  }
  document.addEventListener('DOMContentLoaded', () => watchFeedVideos(document));
  document.addEventListener('htmx:afterSettle', (e) => watchFeedVideos(e.target));

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

    // "Postuler": form -> opens the mail app (mailto:) -> "did you send it?" -> done.
    Alpine.data('applyModal', (cfg) => ({
      open: false,
      step: 'form',
      job: { slug: '', title: '', company: '' },
      loggedIn: cfg.loggedIn,
      profileCv: cfg.profileCv,
      f: { firstName: '', lastName: '', email: '', phone: '', message: '' },
      builtCv: cfg.builtCv,
      cvSource: cfg.profileCv ? 'profile' : cfg.builtCv ? 'built' : 'upload',
      saveToProfile: false,
      file: null,
      errors: {},
      error: '',
      sending: false,
      appId: null,
      mailto: '',
      doneMessage: '',
      show(d) {
        this.job = { slug: d.slug, title: d.title, company: d.company };
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

    // Reel composer: client-side checks (type, size, duration) + thumbnail, upload with progress.
    Alpine.data('reelComposer', (maxSeconds) => ({
      file: null, previewUrl: '', duration: 0, thumb: null, text: '', visibility: 'public',
      checking: false, sending: false, progress: 0, error: '',
      reset() {
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        Object.assign(this, { file: null, previewUrl: '', duration: 0, thumb: null, error: '' });
      },
      async pick(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        this.reset();
        if (!/^video\//.test(file.type)) { this.error = 'Choisissez une vidéo (MP4 ou MOV).'; return; }
        if (file.size > 40 * 1024 * 1024) { this.error = 'La vidéo doit faire moins de 40 Mo. Filmez en 720p ou raccourcissez-la.'; return; }
        this.checking = true;
        const url = URL.createObjectURL(file);
        try {
          const { duration, thumb } = await this.inspect(url);
          if (duration > maxSeconds + 0.9) {
            this.error = `Votre vidéo dure ${Math.round(duration)} secondes. Les réels sont limités à ${maxSeconds} secondes : coupez-la dans la galerie de votre téléphone.`;
            URL.revokeObjectURL(url);
            return;
          }
          Object.assign(this, { file, previewUrl: url, duration, thumb });
        } catch (_) {
          this.error = 'Impossible de lire cette vidéo. Essayez une vidéo MP4 filmée avec votre téléphone.';
          URL.revokeObjectURL(url);
        } finally {
          this.checking = false;
        }
      },
      // Reads the duration and captures a frame as JPEG thumbnail.
      inspect(url) {
        return new Promise((resolve, reject) => {
          const v = document.createElement('video');
          v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
          const timer = setTimeout(() => reject(new Error('timeout')), 15000);
          v.onerror = () => { clearTimeout(timer); reject(new Error('unreadable')); };
          v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 1) / 2); };
          v.onseeked = () => {
            clearTimeout(timer);
            let thumb = null;
            try {
              const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
              const c = document.createElement('canvas');
              c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
              c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
              thumb = c;
            } catch (_) { thumb = null; }
            const done = (blob) => resolve({ duration: v.duration, thumb: blob });
            if (thumb && thumb.toBlob) thumb.toBlob((b) => done(b), 'image/jpeg', 0.8); else done(null);
          };
        });
      },
      submit() {
        if (!this.file || this.sending) return;
        this.error = ''; this.sending = true; this.progress = 0;
        const data = new FormData();
        data.append('text', this.text);
        data.append('visibility', this.visibility);
        data.append('video', this.file, this.file.name);
        if (this.thumb) data.append('thumbnail', this.thumb, 'thumb.jpg');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/reels');
        xhr.setRequestHeader('X-CSRF-Token', csrf());
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) this.progress = Math.round((e.loaded / e.total) * 100); };
        xhr.onload = () => {
          let json = {};
          try { json = JSON.parse(xhr.responseText); } catch (_) { /* not JSON */ }
          if (xhr.status >= 200 && xhr.status < 300) { window.location.href = json.redirect || '/reels'; return; }
          this.error = json.error || 'Publication impossible. Réessayez.';
          this.sending = false;
        };
        xhr.onerror = () => { this.error = 'Connexion interrompue. Réessayez.'; this.sending = false; };
        xhr.send(data);
      },
    }));

    // Full-screen reels: play the visible one, preload the next, pause the others.
    Alpine.data('reelsViewer', () => ({
      muted: true,
      commentsFor: null,
      observer: null,
      init() {
        this.observer = new IntersectionObserver((entries) => {
          entries.forEach(({ target, isIntersecting }) => {
            const v = target.querySelector('video');
            if (isIntersecting) {
              clearTimeout(target._viewTimer);
              target._viewTimer = setTimeout(() => {
                fetch(`/reels/${target.dataset.reel}/vue`, { method: 'POST', headers: { 'X-CSRF-Token': csrf() } }).catch(() => {});
              }, 2000);
              if (!v.src) v.src = v.dataset.src;
              v.muted = this.muted;
              v.play().then(() => this.setPaused(target, false)).catch(() => this.setPaused(target, true));
              const next = target.nextElementSibling?.querySelector?.('video');
              if (next && !next.src && !slowConnection()) { next.preload = 'metadata'; next.src = next.dataset.src; }
            } else {
              clearTimeout(target._viewTimer);
              v.pause();
            }
          });
        }, { root: this.$refs.scroller, threshold: 0.7 });
        this.observeAll();
        document.addEventListener('htmx:afterSettle', () => this.observeAll());
      },
      observeAll() {
        this.$root.querySelectorAll('section.reel:not([data-watched])').forEach((s) => { s.dataset.watched = '1'; this.observer.observe(s); });
      },
      setPaused(section, paused) { const o = section.querySelector('[data-paused]'); if (o) o.classList.toggle('hidden', !paused); },
      togglePlay(v) {
        if (v.paused) { v.play().catch(() => {}); this.setPaused(v.closest('section'), false); }
        else { v.pause(); this.setPaused(v.closest('section'), true); }
      },
      toggleMute() {
        this.muted = !this.muted;
        this.$root.querySelectorAll('video').forEach((v) => { v.muted = this.muted; });
      },
      openComments(id) {
        this.commentsFor = id;
        const body = document.getElementById('reel-comments-body');
        body.innerHTML = '<p class="p-4 text-sm text-gray-500">Chargement…</p>';
        window.htmx.ajax('GET', `/publications/${id}/commentaires?ctx=reel`, { target: '#reel-comments-body', swap: 'innerHTML' });
      },
      closeComments() { this.commentsFor = null; },
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
