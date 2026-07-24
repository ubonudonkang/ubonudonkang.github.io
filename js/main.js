/* ================================================================
   UBON UDONKANG · v5  |  main.js
================================================================ */

/* ── CLOCK (WAT = UTC+1) ─────────────────────────────────────── */
function tick() {
  const d   = new Date();
  const wat = new Date(d.getTime() + 3600000); // UTC+1
  const p   = n => String(n).padStart(2,'0');
  const s   = `${p(wat.getUTCHours())}:${p(wat.getUTCMinutes())}:${p(wat.getUTCSeconds())} WAT`;
  document.querySelectorAll('[data-clock]').forEach(el => el.textContent = s);
}
tick(); setInterval(tick, 1000);

/* ── TOAST ──────────────────────────────────────────────────── */
function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

/* ── EMAIL COPY ─────────────────────────────────────────────── */
const EMAIL = 'ubonudonkang@gmail.com';
document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    navigator.clipboard.writeText(EMAIL)
      .then(() => toast('Copied: ' + EMAIL))
      .catch(()  => toast(EMAIL));
  }
});
document.querySelectorAll('[data-copy]').forEach(el => {
  el.addEventListener('click', () => {
    navigator.clipboard.writeText(EMAIL)
      .then(() => toast('Copied: ' + EMAIL))
      .catch(()  => toast(EMAIL));
  });
});

/* ── DOCK: SPRING PHYSICS ────────────────────────────────────── */
(function initDock() {
  const dock  = document.querySelector('.dock');
  if (!dock) return;
  const items = [...dock.querySelectorAll('.dock-item')];
  if (!items.length) return;

  const MAX   = 1.5;   // max scale
  const SPREAD = 88;   // px influence radius
  const K     = 0.20;  // spring stiffness (lower = slower per item)
  const DAMP  = 0.70;  // damping

  // Each item has independent spring state
  const state = items.map(() => ({ cur: 1, target: 1, vel: 0 }));
  let raf;

  function frame() {
    let live = false;
    items.forEach((item, i) => {
      const s   = state[i];
      const err = s.target - s.cur;
      s.vel     = (s.vel + err * K) * DAMP;
      s.cur    += s.vel;
      if (Math.abs(err) > 0.0008 || Math.abs(s.vel) > 0.0008) live = true;
      const lift = (s.cur - 1) * -13;
      item.style.transform = `scale(${s.cur.toFixed(4)}) translateY(${lift.toFixed(2)}px)`;
    });
    if (live) raf = requestAnimationFrame(frame);
  }

  function setTargets(mouseX) {
    items.forEach((item, i) => {
      const r  = item.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const d  = Math.abs(mouseX - cx);
      const t  = Math.max(0, 1 - d / SPREAD);
      // smooth-step
      state[i].target = 1 + (MAX - 1) * t * t * (3 - 2 * t);
    });
  }

  dock.addEventListener('mousemove', e => {
    setTargets(e.clientX);
    cancelAnimationFrame(raf);
    frame();
  });
  dock.addEventListener('mouseleave', () => {
    items.forEach((_, i) => { state[i].target = 1; });
    frame();
  });

  /* active state */
  const path = location.pathname;
  items.forEach(item => {
    const href = item.getAttribute('href') || '';
    if (href === path) item.classList.add('is-active');
  });
})();

/* ── SCROLL REVEAL ──────────────────────────────────────────── */
const rvObs = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in');
      rvObs.unobserve(entry.target);
    }
  });
}, { threshold: 0.07, rootMargin: '0px 0px -24px 0px' });

document.querySelectorAll('.rv').forEach((el, i) => {
  el.style.transitionDelay = (el.dataset.d || 0) + 'ms';
  rvObs.observe(el);
});

// Stagger children inside .rvg
document.querySelectorAll('.rvg').forEach(g => {
  g.querySelectorAll('.rv').forEach((c, i) => { c.dataset.d = i * 65; });
});

/* ── STAT COUNTERS ──────────────────────────────────────────── */
const cntObs = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el  = entry.target;
    const end = parseFloat(el.dataset.to);
    const pre = el.dataset.pre || '';
    const suf = el.dataset.suf || '';
    const dur = 1400;
    const t0  = performance.now();
    (function frame(now) {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = pre + (Number.isInteger(end) ? Math.round(end * e) : (end * e).toFixed(1)) + suf;
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
    cntObs.unobserve(el);
  });
}, { threshold: 0.6 });
document.querySelectorAll('[data-to]').forEach(el => cntObs.observe(el));

/* ── PDF VIEWER ─────────────────────────────────────────────── */
(function initPdfViewer() {
  const modal   = document.getElementById('pdfModal');
  const frame   = document.getElementById('pdfFrame');
  const titleEl = document.getElementById('pdfModalTitle');
  const closeBtn = document.getElementById('pdfClose');
  if (!modal) return;

  function open(pdfPath, title) {
    titleEl.textContent = title;
    frame.src = pdfPath + '#toolbar=0&navpanes=0&scrollbar=1&view=FitH';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { frame.src = ''; }, 240);
  }

  closeBtn.addEventListener('click', close);

  document.addEventListener('keydown', e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); return; }
    if ((e.ctrlKey || e.metaKey) && ['s','p','S','P'].includes(e.key)) {
      e.preventDefault();
    }
  });

  document.querySelectorAll('[data-pdf] .artifact-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-pdf]');
      open(row.dataset.pdf, row.dataset.title);
    });
  });
})();

