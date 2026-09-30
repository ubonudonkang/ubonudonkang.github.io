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

/* ── Top bar edge fade ───────────────────────────────────────── */
(function topbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const update = () => bar.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', update, { passive: true });
  update();
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
document.querySelectorAll('[data-copy]').forEach(el => el.addEventListener('click', copyEmail));

/* ── Dock: magnification + active state ─────────────────────── */
(function dock() {
  const dockEl = document.querySelector('.dock');
  if (!dockEl) return;
  const items = [...dockEl.querySelectorAll('.dock-item')];

  // active state: match the first path segment
  const seg = p => '/' + (p.replace(/^\/+|\/+$/g, '').split('/')[0] || '');
  const here = seg(location.pathname.replace(/index\.html$/, ''));
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

  // magnification only for a real mouse, and never with reduced motion
  const MAX = 1.4, SPREAD = 110, LIFT = 10;
  const springs = items.map(() => makeSpring(1, { damping: 1, response: 0.22 }));
  let raf = 0, last = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    let live = false;
    items.forEach((item, i) => {
      if (stepSpring(springs[i], dt)) live = true;
      const s = springs[i].value;
      item.style.transform = s === 1 ? '' : `translateY(${((1 - s) * LIFT / (MAX - 1)).toFixed(2)}px) scale(${s.toFixed(4)})`;
    });
    raf = live ? requestAnimationFrame(frame) : 0;
  }
  function kick() {
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  dockEl.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !finePointer.matches || reduceMotion.matches) return;
    items.forEach((item, i) => {
      const r = item.getBoundingClientRect();
      // use the unscaled centre so items don't chase themselves
      const cx = r.left + r.width / 2;
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

    el.addEventListener('pointerdown', e => {
      if (!wide.matches || drag || (e.pointerType === 'mouse' && e.button !== 0)) return; // ignore extra fingers
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
})();
