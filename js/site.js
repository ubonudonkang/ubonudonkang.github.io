/* ================================================================
   UBON UDONKANG · v6  |  site.js
================================================================ */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer  = matchMedia('(hover: hover) and (pointer: fine)');

/* ── Spring (Apple-style: damping ratio + response) ─────────── */
// One axis. Critically damped at damping 1; bouncy below 1.
function makeSpring(value, { damping = 1, response = 0.4 } = {}) {
  return { value, target: value, velocity: 0, damping, response };
}
function stepSpring(s, dt) {
  const k = Math.pow((2 * Math.PI) / s.response, 2);
  const c = (4 * Math.PI * s.damping) / s.response;
  // fixed substeps keep it stable and frame-rate independent
  const h = 1 / 240;
  for (let t = 0; t < dt; t += h) {
    const step = Math.min(h, dt - t);
    const a = -k * (s.value - s.target) - c * s.velocity;
    s.velocity += a * step;
    s.value += s.velocity * step;
  }
  return Math.abs(s.value - s.target) > 0.001 || Math.abs(s.velocity) > 0.01;
}

/* ── Clock (WAT = UTC+1) ─────────────────────────────────────── */
(function clock() {
  const els = document.querySelectorAll('[data-clock]');
  if (!els.length) return;
  const p = n => String(n).padStart(2, '0');
  const tick = () => {
    const wat = new Date(Date.now() + 3600000);
    const s = `${p(wat.getUTCHours())}:${p(wat.getUTCMinutes())} WAT`;
    els.forEach(el => { el.textContent = s; });
  };
  tick();
  setInterval(tick, 15000);
})();

/* ── Light / dark theme ─────────────────────────────────────────
   Light by default, whatever the system setting; a visitor's choice is remembered.
   The <head> applies a saved choice before first paint. */
(function theme() {
  const root = document.documentElement;
  const buttons = document.querySelectorAll('[data-theme-toggle]');
  const meta = document.querySelector('meta[name="theme-color"]');
  const current = () => root.dataset.theme === 'dark' ? 'dark' : 'light';
  function sync() {
    const dark = current() === 'dark';
    buttons.forEach(b => {
      b.setAttribute('aria-pressed', String(dark));
      b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    });
    if (meta) meta.setAttribute('content', dark ? '#0E0E10' : '#FFFFFF');
  }
  function set(next) {
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* private mode: still switches for this page */ }
    sync();
  }
  buttons.forEach(b => b.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    // a soft cross-fade where supported; instant for reduced motion
    if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(() => set(next));
    else set(next);
  }));
  sync();
})();

/* ── Top bar edge fade ───────────────────────────────────────── */
(function topbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const update = () => bar.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
})();

/* ── Toast + email copy ──────────────────────────────────────── */
const EMAIL = 'ubonudonkang@gmail.com';
let toastTimer;
function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function copyEmail() {
  navigator.clipboard.writeText(EMAIL)
    .then(() => toast('Email copied'))
    .catch(() => toast(EMAIL));
}
document.addEventListener('keydown', e => {
  const t = document.activeElement;
  if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
  if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) copyEmail();
});
document.querySelectorAll('[data-copy-email]').forEach(el => el.addEventListener('click', copyEmail));
document.querySelectorAll('[data-copy-text]').forEach(el => el.addEventListener('click', () => {
  const text = el.dataset.copyText;
  navigator.clipboard.writeText(text)
    .then(() => toast(el.dataset.copyLabel || 'Copied'))
    .catch(() => toast(text));
}));

/* ── Dock: magnification + active state ─────────────────────── */
(function dock() {
  const dockEl = document.querySelector('.dock');
  if (!dockEl) return;
  const items = [...dockEl.querySelectorAll('.dock-item')];

  // active state: match the first path segment
  const seg = p => '/' + (p.replace(/^\/+|\/+$/g, '').split('/')[0] || '');
  let here = seg(location.pathname.replace(/index\.html$/, ''));
  if (here.startsWith('/project-')) here = '/projects'; // case studies live under Work
  items.forEach(item => {
    const href = item.getAttribute('href') || '';
    if (href.startsWith('/') && seg(href) === here) {
      item.classList.add('is-active');
      item.setAttribute('aria-current', 'page');
    }
  });

  // tooltips: instant after the first one, until the pointer leaves for a moment
  let coolTimer;
  dockEl.addEventListener('pointerenter', () => {
    clearTimeout(coolTimer);
    setTimeout(() => dockEl.classList.add('is-warm'), 160);
  });
  dockEl.addEventListener('pointerleave', () => {
    coolTimer = setTimeout(() => dockEl.classList.remove('is-warm'), 300);
  });

  // Magnification, Mac style: tiles grow toward the pointer, neighbours slide
  // apart to make room, and the glass background widens to match. Only for a
  // real mouse, and never with reduced motion.
  const MAX = 1.4, SPREAD = 140, LIFT = 12;
  const bg = dockEl.querySelector('.dock-bg');
  const slots = [...dockEl.children].filter(el => el.matches('.dock-item, .dock-sep'));
  const springs = items.map(() => makeSpring(1, { damping: 1, response: 0.22 }));
  let raf = 0, last = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    let live = false;
    items.forEach((_, i) => { if (stepSpring(springs[i], dt)) live = true; });

    // extra width each slot gains, then spread it evenly around the dock's centre
    const extra = slots.map(el => {
      const i = items.indexOf(el);
      return i < 0 ? 0 : (springs[i].value - 1) * el.offsetWidth;
    });
    const total = extra.reduce((a, b) => a + b, 0);
    let run = -total / 2;
    slots.forEach((el, k) => {
      const shift = run + extra[k] / 2;
      run += extra[k];
      const i = items.indexOf(el);
      const s = i < 0 ? 1 : springs[i].value;
      el.style.transform = Math.abs(shift) < 0.01 && s === 1 ? '' :
        `translate(${shift.toFixed(2)}px, ${((1 - s) * LIFT / (MAX - 1)).toFixed(2)}px) scale(${s.toFixed(4)})`;
    });
    if (bg) bg.style.inset = total < 0.01 ? '' : `0 ${(-total / 2).toFixed(2)}px`;

    raf = live ? requestAnimationFrame(frame) : 0;
  }
  function kick() {
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  dockEl.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !finePointer.matches || reduceMotion.matches) return;
    // measure resting positions (offsetLeft ignores transforms), so tiles never chase the pointer
    const left = dockEl.getBoundingClientRect().left + dockEl.clientLeft;
    items.forEach((item, i) => {
      const cx = left + item.offsetLeft + item.offsetWidth / 2;
      const t = Math.max(0, 1 - Math.abs(e.clientX - cx) / SPREAD);
      springs[i].target = 1 + (MAX - 1) * t * t * (3 - 2 * t);
    });
    kick();
  });
  dockEl.addEventListener('pointerleave', () => {
    springs.forEach(s => { s.target = 1; });
    kick();
  });
})();

/* ── Scroll reveal (staggered) ───────────────────────────────── */
(function reveal() {
  const els = [...document.querySelectorAll('.rv')];
  if (!('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('in')); return; }
  const io = new IntersectionObserver(entries => {
    const entering = entries.filter(e => e.isIntersecting);
    entering.forEach((entry, i) => {
      entry.target.style.transitionDelay = `${Math.min(i, 5) * 60}ms`;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => io.observe(el));
})();

/* ── Stat counters ───────────────────────────────────────────── */
(function counters() {
  const els = document.querySelectorAll('[data-to]');
  if (reduceMotion.matches || !els.length) return; // final values are already in the HTML
  const render = (el, v) => { el.textContent = (el.dataset.pre || '') + Math.round(v) + (el.dataset.suf || ''); };
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target, end = parseFloat(el.dataset.to), t0 = performance.now(), dur = 900;
      (function f(now) {
        const p = Math.min((now - t0) / dur, 1);
        render(el, end * (1 - Math.pow(1 - p, 4)));
        if (p < 1) requestAnimationFrame(f);
      })(t0);
      io.unobserve(el);
    });
  }, { threshold: 0.6 });
  els.forEach(el => { render(el, 0); io.observe(el); });
})();

/* ── Testimonials ────────────────────────────────────────────── */
(function quotes() {
  const root = document.querySelector('[data-quotes]');
  if (!root) return;
  const items = [...root.querySelectorAll('.quote__item')];
  const count = root.querySelector('[data-count]');
  let i = 0;
  const p = n => String(n).padStart(2, '0');
  function show(n) {
    items[i].classList.remove('is-on');
    i = (n + items.length) % items.length;
    items[i].classList.add('is-on');
    count.textContent = `${p(i + 1)} / ${p(items.length)}`;
  }
  root.querySelector('[data-prev]').addEventListener('click', () => show(i - 1));
  root.querySelector('[data-next]').addEventListener('click', () => show(i + 1));
})();

/* ── Case file: draggable papers ─────────────────────────────── */
// 1:1 tracking from the grab point, rubber-band at the folder edge,
// momentum projection on release, and a spring that inherits the
// flick's velocity. Grabbing a paper mid-flight picks it up where it is.
(function casefile() {
  const root = document.getElementById('casefile');
  if (!root) return;
  const wide = matchMedia('(min-width: 961px)');
  const docs = [...root.querySelectorAll('[data-drag]')];
  let z = 10;

  const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
  const project = (v, d = 0.996) => (v / 1000) * d / (1 - d);
  // first view only: the papers start a little low and settle on the same springs
  // a drag uses, staggered, as the folder fades in
  const settles = [];
  const settleOnReveal = wide.matches && !reduceMotion.matches && 'IntersectionObserver' in window;

  docs.forEach(el => {
    const rot = getComputedStyle(el).getPropertyValue('--r').trim() || '0deg';
    const sx = makeSpring(0, { damping: 0.8, response: 0.45 });
    const sy = makeSpring(0, { damping: 0.8, response: 0.45 });
    const lift = makeSpring(1, { damping: 1, response: 0.25 });
    let raf = 0, last = 0, drag = null;

    const render = () => {
      el.style.transform = `translate3d(${sx.value.toFixed(2)}px, ${sy.value.toFixed(2)}px, 0) rotate(${rot}) scale(${lift.value.toFixed(4)})`;
    };
    const bounds = () => ({
      minX: -el.offsetLeft + 8,
      maxX: root.clientWidth - el.offsetLeft - el.offsetWidth - 8,
      minY: -el.offsetTop + 48,
      maxY: root.clientHeight - el.offsetTop - el.offsetHeight - 8,
    });
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      let live = stepSpring(lift, dt);
      if (!drag) live = stepSpring(sx, dt) | stepSpring(sy, dt) | live;
      render();
      raf = live || drag ? requestAnimationFrame(frame) : 0;
    }
    const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

    let touched = false;
    if (settleOnReveal) {
      sy.value = sy.target = 18;
      render();
      settles.push(() => { if (touched || !wide.matches) return; sy.target = 0; kick(); });
    }

    el.addEventListener('pointerdown', e => {
      if (!wide.matches || drag || (e.pointerType === 'mouse' && e.button !== 0)) return; // ignore extra fingers
      touched = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-grabbed');
      el.style.zIndex = ++z;
      // start from the live, on-screen position (interruptible)
      sx.velocity = sy.velocity = 0;
      drag = { id: e.pointerId, ox: e.clientX - sx.value, oy: e.clientY - sy.value, b: bounds(), hist: [] };
      lift.target = 1.03;
      kick();
    });

    el.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const { b } = drag;
      let x = e.clientX - drag.ox, y = e.clientY - drag.oy;
      const w = root.clientWidth, h = root.clientHeight;
      if (x < b.minX) x = b.minX + rubber(x - b.minX, w); else if (x > b.maxX) x = b.maxX + rubber(x - b.maxX, w);
      if (y < b.minY) y = b.minY + rubber(y - b.minY, h); else if (y > b.maxY) y = b.maxY + rubber(y - b.maxY, h);
      sx.value = sx.target = x;
      sy.value = sy.target = y;
      drag.hist.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (drag.hist.length > 6) drag.hist.shift();
    });

    const release = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const { b, hist } = drag;
      let vx = 0, vy = 0;
      if (hist.length > 1) {
        const a = hist[0], z2 = hist[hist.length - 1], dt = (z2.t - a.t) / 1000;
        if (dt > 0 && e.timeStamp - z2.t < 80) { vx = (z2.x - a.x) / dt; vy = (z2.y - a.y) / dt; }
      }
      drag = null;
      el.classList.remove('is-grabbed');
      lift.target = 1;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      if (reduceMotion.matches) {
        sx.value = sx.target = clamp(sx.value, b.minX, b.maxX);
        sy.value = sy.target = clamp(sy.value, b.minY, b.maxY);
        sx.velocity = sy.velocity = 0;
      } else {
        sx.target = clamp(sx.value + project(vx), b.minX, b.maxX);
        sy.target = clamp(sy.value + project(vy), b.minY, b.maxY);
        sx.velocity = vx; sy.velocity = vy; // hand off the flick
      }
      kick();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    // leaving the wide layout: drop the collage offsets
    wide.addEventListener('change', () => {
      if (wide.matches) return;
      sx.value = sx.target = sy.value = sy.target = 0;
      sx.velocity = sy.velocity = 0;
      el.style.transform = '';
      el.style.zIndex = '';
    });
  });

  if (settles.length) {
    // same trigger as the folder's own reveal, so both move together
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      settles.forEach((settle, i) => setTimeout(settle, 200 + i * 70));
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    io.observe(root);
  }
})();

/* ── Case study: current section in the contents list ────────── */
(function caseToc() {
  const links = [...document.querySelectorAll('.cs-toc a')];
  if (!links.length) return;
  const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(a => a.classList.remove('is-current'));
      byId.get(e.target.id)?.classList.add('is-current');
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  byId.forEach((_, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
})();

/* ── PDF viewer (project artefacts) ──────────────────────────── */
(function pdfViewer() {
  const modal = document.getElementById('pdfModal');
  if (!modal) return;
  const frame = document.getElementById('pdfFrame');
  const title = document.getElementById('pdfModalTitle');
  const closeBtn = document.getElementById('pdfClose');
  let opener = null;

  function open(path, name, from) {
    opener = from;
    title.textContent = name;
    frame.src = path + '#toolbar=0&navpanes=0&scrollbar=1&view=FitH';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }
  function close() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { frame.src = ''; }, 220);
    opener?.focus();
  }
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); return; }
    if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
  });
  document.querySelectorAll('[data-pdf] .artifact-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-pdf]');
      open(row.dataset.pdf, row.dataset.title, btn);
    });
  });
})();

/* ── Contact form: prefill a document request (?request=…&from=…) ── */
(function prefillRequest() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  const params = new URLSearchParams(location.search);
  const doc = params.get('request');
  if (!doc) return;
  const from = params.get('from');
  const type = form.querySelector('#ty');
  const msg = form.querySelector('#msg');
  if (type) type.value = 'resource';
  if (msg && !msg.value) {
    msg.value = `Hi Ubon, I'd like to request "${doc}"${from ? ` (from the ${from})` : ''}. `;
  }
  (form.closest('.form-card') || form).scrollIntoView({ block: 'start' });
  form.querySelector('#fn')?.focus({ preventScroll: true });
})();

/* ── Squad (GTCO) checkout ────────────────────────────────────────
   The public key is meant to sit in page code: sandbox_pk_... while testing,
   pk_... in production. The secret key never goes here; it lives in the Apps
   Script that verifies cohort payments. squad.min.js loads on first use, so
   pages don't pay for it until someone checks out. */
const SQUAD_PUBLIC_KEY = 'pk_cb5d383f172d4fb319f3babcdc0128ba842ca584';
let squadLoading = null;
function loadSquad() {
  if (window.squad) return Promise.resolve();
  if (!squadLoading) {
    squadLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.squadco.com/widget/squad.min.js';
      s.async = true;
      s.onload = () => (window.squad ? resolve() : reject(new Error('Secure checkout did not load.')));
      s.onerror = () => { squadLoading = null; reject(new Error('Secure checkout did not load.')); };
      document.head.appendChild(s);
    });
  }
  return squadLoading;
}
// amount in naira; Squad wants kobo
window.squadPay = function ({ amount, email, name, ref, metadata = {}, onSuccess, onClose }) {
  if (!SQUAD_PUBLIC_KEY) return Promise.reject(new Error('Online payment is not switched on yet.'));
  return loadSquad().then(() => {
    let paid = false;
    const checkout = new window.squad({
      key: SQUAD_PUBLIC_KEY,
      email,
      amount: Math.round(amount * 100),
      currency_code: 'NGN',
      transaction_ref: ref,
      customer_name: name,
      metadata,
      pass_charge: false,
      onLoad: () => {},
      onSuccess: (res) => { paid = true; if (onSuccess) onSuccess(res); },
      onClose: () => { if (!paid && onClose) onClose(); },
    });
    checkout.setup();
    checkout.open();
  });
};

/* ── 1:1 session: pay first, then the Cal.com button unlocks ───── */
(function sessionPayment() {
  const form = document.getElementById('session-pay');
  if (!form) return;
  const status = form.querySelector('[data-pay-status]');
  const button = form.querySelector('button[type="submit"]');
  const book = document.getElementById('session-book');
  const note = document.getElementById('session-book-note');
  const CAL = 'https://cal.com/ubonudonkang/1-on-1-career-clarity-session';

  function unlock(p, focus) {
    const q = new URLSearchParams({ name: p.name, email: p.email, notes: `Squad payment ref ${p.ref}` });
    book.href = `${CAL}?${q}`;
    book.classList.remove('is-locked');
    book.removeAttribute('aria-disabled');
    book.removeAttribute('tabindex');
    note.textContent = `Payment received (ref ${p.ref}). Pick a time that suits you.`;
    status.textContent = 'Payment received. Thank you.';
    button.disabled = true;
    if (focus) book.focus();
  }
  // a refresh after paying keeps the booking step open (this browser only)
  try { const saved = JSON.parse(sessionStorage.getItem('uu-session-paid') || 'null'); if (saved) unlock(saved, false); } catch (e) { /* storage blocked */ }

  book.addEventListener('click', (e) => { if (book.classList.contains('is-locked')) e.preventDefault(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.name.value.trim(), email = form.email.value.trim();
    if (!name) { status.textContent = 'Please enter your full name.'; form.name.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = 'That email address does not look right.'; form.email.focus(); return; }
    const ref = `UU1-${Date.now().toString(36).toUpperCase()}`;
    button.disabled = true;
    status.textContent = 'Opening secure checkout...';
    window.squadPay({
      amount: 15000, email, name, ref,
      metadata: { product: '1:1 Career Clarity Session' },
      onSuccess: () => {
        const p = { name, email, ref };
        try { sessionStorage.setItem('uu-session-paid', JSON.stringify(p)); } catch (err) { /* storage blocked */ }
        unlock(p, true);
      },
      onClose: () => { button.disabled = false; status.textContent = "Payment wasn't completed. You can try again."; },
    }).then(() => { status.textContent = ''; }).catch((err) => {
      button.disabled = false;
      status.textContent = `${err.message} Please try again shortly.`;
    });
  });
})();
