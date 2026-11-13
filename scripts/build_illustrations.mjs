import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The site's illustrations. Each one is drawn here, on an isometric grid, and written into a page
 * as inline SVG between a pair of markers:
 *
 *   <!--illo:requirements--> ... <!--/illo:requirements-->
 *
 * Inline, so the drawing takes its colours from the page's tokens (light and dark) and its parts
 * can be animated from css/site.css. To change a drawing, edit its function below and run:
 *
 *   node scripts/build_illustrations.mjs          redraw every marked illustration
 *   node scripts/build_illustrations.mjs --check  list pages whose drawings are out of date
 *
 * Coordinates are grid units: x runs down to the right, y down to the left, z straight up.
 * Paint order is the order of the add() calls, so draw from the back (small x + y) to the front.
 *
 * Classes (styled in css/site.css, "Illustrations"):
 *   colour   il-line (stroke), il-face, il-shade, il-tint, il-accent, il-soft, il-thin, il-dash
 *   entrance il-drop, il-pop, il-fade, il-draw, il-rise, il-out; each takes a delay in ms
 *   loop     il-pulse (a dot that travels along a line), il-spin
 */
const repo = fileURLToPath(new URL('..', import.meta.url));
const C = Math.cos(Math.PI / 6);
const S = 0.5;
const K = 1 - Math.SQRT1_2; // how far a rounded corner's widest point sits from the corner, in radii
const n = (v) => String(+v.toFixed(2));

class Scene {
  constructor(name, { u = 20, label, pad = [26, 26], spot = false }) {
    Object.assign(this, { name, u, label, pad, spot, out: [], defs: [], box: [Infinity, Infinity, -Infinity, -Infinity], ids: 0 });
  }

  /* grid → screen, remembering how far the drawing reaches */
  p(x, y, z = 0) {
    const sx = (x - y) * C * this.u;
    const sy = (x + y) * S * this.u - z * this.u;
    const b = this.box;
    b[0] = Math.min(b[0], sx); b[1] = Math.min(b[1], sy); b[2] = Math.max(b[2], sx); b[3] = Math.max(b[3], sy);
    return [sx, sy];
  }

  d(points, close = true) {
    return 'M' + points.map((pt) => this.p(...pt).map(n).join(' ')).join('L') + (close ? 'Z' : '');
  }

  add(...parts) { this.out.push(...parts.flat()); return this; }

  /* a group that carries an entrance: g('il-drop', 120, ...) */
  g(cls, delay, ...parts) {
    return `<g${cls ? ` class="${cls}"` : ''}${delay ? ` style="--d:${delay}ms"` : ''}>${parts.flat().join('')}</g>`;
  }

  face(points, cls) { return `<path class="il-line ${cls}" d="${this.d(points)}"/>`; }

  /* a square-cornered block: light on the left, shaded on the right */
  block(x, y, z, w, d, h, { top = 'il-face', left = 'il-face', right = 'il-shade' } = {}) {
    return [
      this.face([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], left),
      this.face([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], right),
      this.face([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], top),
    ].join('');
  }

  /* the matrix that lays flat artwork (grid units) on the ground plane at height z */
  flat(z = 0) {
    return `matrix(${n(C * this.u)} ${n(S * this.u)} ${n(-C * this.u)} ${n(S * this.u)} 0 ${n(-z * this.u)})`;
  }

  /* a flat rounded tile on the plane */
  tile(x, y, z, w, d, r, cls = 'il-face') {
    [[x, y], [x + w, y], [x + w, y + d], [x, y + d]].forEach(([a, b]) => this.p(a, b, z));
    return `<rect class="il-line ${cls}" transform="${this.flat(z)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(d)}" rx="${n(r)}"/>`;
  }

  /* a thick rounded slab: the reference style's chunky tile, with a solid shaded edge */
  slab(x, y, z, w, d, h, r, top = 'il-face') {
    const l = [x + r * K, y + d - r * K];
    const rt = [x + w - r * K, y + r * K];
    return [
      this.tile(x, y, z, w, d, r, 'il-shade'),
      `<path class="il-shade" d="${this.d([[...l, z + h], [...rt, z + h], [...rt, z], [...l, z]])}"/>`,
      `<path class="il-line" fill="none" d="${this.d([[...l, z + h], [...l, z]], false)}${this.d([[...rt, z + h], [...rt, z]], false)}"/>`,
      this.tile(x, y, z + h, w, d, r, top),
    ].join('');
  }

  /* a line through grid points, with rounded corners; pulse adds the travelling dot */
  route(points, { cls = 'il-thin', r = 0.5, draw = 0, pulse = null } = {}) {
    let d = '';
    points.forEach((pt, i) => {
      const here = this.p(...pt);
      if (i === 0) { d += `M${here.map(n).join(' ')}`; return; }
      const prev = points[i - 1];
      const next = points[i + 1];
      if (!next || !r) { d += `L${here.map(n).join(' ')}`; return; }
      const cut = (from) => {
        const v = from.map((c, k) => c - pt[k]);
        const len = Math.hypot(...v) || 1;
        const t = Math.min(r, len / 2) / len;
        return this.p(...pt.map((c, k) => c + v[k] * t));
      };
      d += `L${cut(prev).map(n).join(' ')}Q${here.map(n).join(' ')} ${cut(next).map(n).join(' ')}`;
    });
    // a dashed line cannot also be drawn on with its dashes, so it fades in instead
    const dashed = cls.includes('il-dash');
    const enter = draw === null ? '' : dashed ? ' il-fade' : ' il-draw';
    const line = `<path class="${cls}${enter}"${dashed ? '' : ' pathLength="1"'}${draw ? ` style="--d:${draw}ms"` : ''} d="${d}"/>`;
    if (pulse === null) return line;
    return line + `<path class="il-pulse" pathLength="1" style="--d:${pulse}ms" d="${d}"/>`;
  }

  dot(x, y, z, r = 3, cls = 'il-accent') {
    const [sx, sy] = this.p(x, y, z);
    return `<circle class="il-line ${cls}" cx="${n(sx)}" cy="${n(sy)}" r="${r}"/>`;
  }

  /*
   * Lettering. plane: 'top' lies on the ground reading up to the right, 'topx' on the ground reading down to
   * the right, 'left' stands on a face that looks left, 'right' on a face that looks right, 'screen' is upright.
   */
  text(x, y, z, str, { plane = 'top', size = 12, cls = 'il-ink', anchor = 'middle' } = {}) {
    const [sx, sy] = this.p(x, y, z);
    const m = { top: [C, -S, C, S], topx: [C, S, -C, S], left: [C, S, 0, 1], right: [C, -S, 0, 1], screen: [1, 0, 0, 1] }[plane];
    return `<text class="il-text ${cls}" transform="matrix(${m.map(n).join(' ')} ${n(sx)} ${n(sy)})" font-size="${size}" text-anchor="${anchor}" dy="0.35em">${str}</text>`;
  }

  /* a block that rises out of the ground: the block is clipped at its own footprint */
  riser(x, y, z, w, d, h, opts, delay) {
    const id = `il-${this.name}-c${++this.ids}`;
    const [lx, ly] = this.p(x, y + d, z);
    const [fx, fy] = this.p(x + w, y + d, z);
    const [rx, ry] = this.p(x + w, y, z);
    const top = this.p(x, y, z + h)[1] - 4;
    this.defs.push(`<clipPath id="${id}"><path d="M${n(lx - 2)} ${n(ly + 1)}L${n(fx)} ${n(fy + 2)}L${n(rx + 2)} ${n(ry + 1)}V${n(top)}H${n(lx - 2)}Z"/></clipPath>`);
    return `<g clip-path="url(#${id})"><g class="il-rise" style="--d:${delay}ms;--h:${n(h * this.u + 4)}px">${this.block(x, y, z, w, d, h, opts)}</g></g>`;
  }

  /* the faint isometric grid behind a drawing; svg() fades it out towards the frame's edges */
  grid(x0, x1, y0, y1, step = 1) {
    const box = [...this.box];
    let d = '';
    for (let x = x0; x <= x1 + 1e-6; x += step) d += this.d([[x, y0], [x, y1]], false);
    for (let y = y0; y <= y1 + 1e-6; y += step) d += this.d([[x0, y], [x1, y]], false);
    this.box = box; // a backdrop: it does not count towards the drawing's size
    return `<path class="il-grid" mask="url(#il-${this.name}-g)" d="${d}"/>`;
  }

  /* the frame is the drawing plus its padding, so every drawing is the same scale at its natural width (--w) */
  svg() {
    const [x0, y0, x1, y1] = this.box;
    const w = Math.ceil(x1 - x0 + this.pad[0] * 2);
    const h = Math.ceil(y1 - y0 + this.pad[1] * 2);
    const id = `il-${this.name}-g`;
    if (this.out.some((part) => part.includes(`url(#${id})`))) {
      this.defs.unshift(`<radialGradient id="${id}f" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${n((x0 + x1) / 2)} ${n((y0 + y1) / 2)}) scale(${n(w / 2)} ${n(h / 2)})"><stop offset="0.35" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
        + `<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(x0 - this.pad[0])}" y="${n(y0 - this.pad[1])}" width="${w}" height="${h}"><rect x="${n(x0 - this.pad[0])}" y="${n(y0 - this.pad[1])}" width="${w}" height="${h}" fill="url(#${id}f)"/></mask>`);
    }
    return `<svg class="illo${this.spot ? ' illo--spot' : ''}" data-illo="${this.name}" viewBox="0 0 ${w} ${h}" style="--w:${w}" role="img" aria-label="${this.label}">`
      + (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '')
      + `<g transform="translate(${n(this.pad[0] - x0)} ${n(this.pad[1] - y0)})">${this.out.join('')}</g></svg>`;
  }
}

/* ── small parts shared by several drawings ─────────────────────────────── */

/* an upright sheet or screen that faces left: lines of text, drawn along x */
function linesOnLeftFace(s, x, y, z, widths, gap = 0.5, cls = 'il-thin') {
  return widths.map((w, i) => `<path class="${cls}" d="${s.d([[x, y, z - i * gap], [x + w, y, z - i * gap]], false)}"/>`).join('');
}

function tick(s, x, y, z, size = 5, cls = 'il-tick') {
  const [sx, sy] = s.p(x, y, z);
  return `<path class="${cls}" d="M${n(sx - size)} ${n(sy)}l${n(size * 0.7)} ${n(size * 0.7)}l${n(size * 1.3)} ${n(-size * 1.5)}"/>`;
}

function gear(cx, cy, r, teeth = 8) {
  let d = '';
  for (let i = 0; i < teeth * 2; i++) {
    const rad = i % 2 ? r : r * 0.74;
    for (const off of [-0.5, 0.5]) {
      const a = ((i + off * 0.62) / (teeth * 2)) * Math.PI * 2;
      d += `${d ? 'L' : 'M'}${n(cx + Math.cos(a) * rad)} ${n(cy + Math.sin(a) * rad)}`;
    }
  }
  return `${d}Z`;
}

/* ── the service cards on the home page ─────────────────────────────────── */

/* 01 Requirements: three documents, each wired straight into the build, nothing coming back */
function requirements() {
  const s = new Scene('requirements', { label: 'A BRD, an FRS and a traceability matrix, each wired into a working screen' });
  const docs = [
    { y: 0, name: 'RTM', top: 'il-face', to: 4.4 },
    { y: 4.3, name: 'FRS', top: 'il-soft', to: 5.75 },
    { y: 8.6, name: 'BRD', top: 'il-accent', to: 7.1 },
  ];
  s.p(0, 0, 0); s.p(14.2, 8.6, 0);
  s.add(s.grid(-3, 17, -3, 15));
  // wires first, so the slabs sit on them
  docs.forEach((doc, i) => {
    const from = [3.2, doc.y + 1.6, 0];
    const turn = i === 1 ? [] : [[i === 0 ? 6 : 7.2, doc.y + 1.6, 0], [i === 0 ? 6 : 7.2, doc.to, 0]];
    s.add(s.route([from, ...turn, [9.2, doc.to, 0]], { draw: 500 + i * 140, pulse: 1500 + i * 700 }));
  });
  docs.forEach((doc, i) => {
    s.add(s.g('il-drop', i * 110,
      s.slab(0, doc.y, 0, 3.2, 3.2, 0.7, 0.55, doc.top),
      s.text(1.6, doc.y + 1.6, 0.7, doc.name, { size: 14, cls: doc.top === 'il-accent' ? 'il-on' : 'il-ink' })));
  });
  // the build: a plate with a screen standing on it
  s.add(s.g('il-drop', 380,
    s.slab(9.2, 3.4, 0, 5, 5.2, 0.35, 0.6, 'il-tint'),
    s.block(10, 5.6, 0.35, 3.6, 0.3, 3.5, { left: 'il-face', top: 'il-face' }),
    `<path class="il-thin" d="${s.d([[10, 5.9, 3.25], [13.6, 5.9, 3.25]], false)}"/>`,
    s.dot(10.35, 5.9, 3.55, 1.6, 'il-shade'), s.dot(10.75, 5.9, 3.55, 1.6, 'il-face'),
    s.g('il-fade', 1100, linesOnLeftFace(s, 10.4, 5.9, 2.7, [2.2, 1.5, 2.6, 1.1], 0.5, 'il-code')),
  ));
  // the three wires arrive, the build passes
  docs.forEach((doc) => s.add(s.dot(9.2, doc.to, 0, 2.6, 'il-face')));
  const [bx, by] = s.p(13.2, 5.9, 1.05);
  s.add(s.g('il-pop', 1500, `<circle class="il-line il-accent" cx="${n(bx)}" cy="${n(by)}" r="9"/>`, tick(s, 13.2 - 0.02, 5.9, 1.02, 3.6, 'il-tick il-tick--on')));
  return s.svg();
}

/* 02 Automation: four candidates scored, one worth a bot */
function automation() {
  const s = new Scene('automation', { label: 'Four candidate processes scored side by side; the highest score gets the bot' });
  const bars = [{ score: 42, h: 1.9 }, { score: 27, h: 1.1 }, { score: 91, h: 4.6, win: true }, { score: 58, h: 2.7 }];
  s.p(0, 0, 0); s.p(13.4, 2.8, 0);
  s.add(s.grid(-4, 17, -6, 9));
  bars.forEach((bar, i) => {
    const x = i * 3.5;
    const top = bar.win ? 'il-accent' : 'il-face';
    const [lx, ly] = s.p(x + 1.4, 1.4, 0.4 + bar.h);
    s.add(s.g('il-drop', i * 90, s.slab(x, 0, 0, 2.8, 2.8, 0.4, 0.5, bar.win ? 'il-soft' : 'il-tint')));
    s.add(s.riser(x + 0.7, 0.7, 0.4, 1.4, 1.4, bar.h, { top, left: bar.win ? 'il-soft' : 'il-face', right: bar.win ? 'il-accent-deep' : 'il-shade' }, 520 + i * 120));
    if (bar.win) {
      s.add(s.g('il-pop', 1500,
        `<path class="il-thin" d="M${n(lx)} ${n(ly - 17)}V${n(ly - 30)}"/>`,
        `<rect class="il-line il-face" x="${n(lx - 33)}" y="${n(ly - 56)}" width="66" height="26" rx="13"/>`,
        `<g transform="translate(${n(lx - 19)} ${n(ly - 43)})"><path class="il-spin il-line il-accent" d="${gear(0, 0, 8)}"/><circle class="il-face" r="2.4"/></g>`,
        `<text class="il-text il-ink" x="${n(lx + 9)}" y="${n(ly - 43)}" font-size="12" text-anchor="middle" dy="0.35em">${bar.score}</text>`));
    } else {
      s.add(s.g('il-fade', 1000 + i * 120, `<text class="il-text il-mute" x="${n(lx)}" y="${n(ly - 27)}" font-size="12" text-anchor="middle" dy="0.35em">${bar.score}</text>`));
    }
  });
  return s.svg();
}

/* 03 Process: the as-is route with its paper detour, and the shorter route that replaces it */
function processFix() {
  const s = new Scene('process', { label: 'A six-step process; the two paper-only steps drop out and the route runs straight through four' });
  const T = 2.5; // tile size
  const G = 4.3; // tile to tile
  const tiles = { a: [0, 0], b: [G, 0], p1: [G, 3.9], p2: [G * 2, 3.9], c: [G * 2, 0], d: [G * 3, 0] };
  const mid = (k) => [tiles[k][0] + T / 2, tiles[k][1] + T / 2, 0];
  s.p(0, 0, 0); s.p(G * 3 + T, 3.9 + T, 0);
  s.add(s.grid(-4, 19, -5, 12));
  // the detour, drawn first and left as a dashed trace once the paper steps are gone
  s.add(s.g('il-dim', 1500, s.route([mid('b'), mid('p1'), mid('p2'), mid('c')], { draw: 260, cls: 'il-thin il-dash' })));
  s.add(s.route([mid('a'), mid('b')], { draw: 120 }), s.route([mid('c'), mid('d')], { draw: 560 }));
  s.add(s.route([mid('b'), mid('c')], { draw: 1900, cls: 'il-wire' }));
  s.add(s.route([mid('a'), mid('d')], { draw: null, cls: 'il-none', pulse: 2600 }));
  const step = (k, label, delay, top = 'il-face') => s.g('il-drop', delay,
    s.slab(...tiles[k], 0, T, T, 0.5, 0.5, top),
    s.text(tiles[k][0] + T / 2, tiles[k][1] + T / 2, 0.5, label, { size: 15, cls: top === 'il-accent' ? 'il-on' : 'il-ink' }));
  // a paper step: its ghost stays on the ground, the slab and its sheet lift out
  const paper = (k, delay) => {
    const [x, y] = tiles[k];
    const sheet = (dz) => s.face([[x + 0.6, y + 0.55, 0.5 + dz], [x + 1.9, y + 0.55, 0.5 + dz], [x + 1.9, y + 1.95, 0.5 + dz], [x + 0.6, y + 1.95, 0.5 + dz]], 'il-face');
    return s.g('il-fade', 1500, s.tile(x, y, 0, T, T, 0.5, 'il-ghost'))
      + s.g('il-drop', delay, s.g('il-out', 1400, s.slab(x, y, 0, T, T, 0.5, 0.5, 'il-tint'), sheet(0.12), sheet(0.3),
        `<path class="il-thin" d="${s.d([[x + 0.9, y + 0.95, 0.8], [x + 1.6, y + 0.95, 0.8]], false)}${s.d([[x + 0.9, y + 1.3, 0.8], [x + 1.6, y + 1.3, 0.8]], false)}"/>`));
  };
  s.add(step('a', '1', 0), step('b', '2', 90), step('c', '3', 360), paper('p1', 180), paper('p2', 270), step('d', '4', 450, 'il-accent'));
  s.add(s.g('il-fade', 1600, s.text(G * 1.5 + T / 2, 3.9 + T + 0.9, 0, 'PAPER ONLY', { plane: 'topx', size: 11, cls: 'il-mute' })));
  return s.svg();
}

/* 04 Compliance: regulation, requirement and test as three layers, with a thread through each */
function compliance() {
  const s = new Scene('compliance', { label: 'Three layers, regulation, requirements and tests, with a line threading each requirement to both' });
  const W = 6.6;
  const D = 5;
  const GAP = 3.3;
  const T = 0.25; // plate thickness
  const NODE = 3.85; // the row of thread ends, near each plate's front edge so the threads show
  const layers = [
    { name: 'UAT TESTS', top: 'il-face' },
    { name: 'REQUIREMENT', top: 'il-accent' },
    { name: 'REGULATION', top: 'il-face' },
  ];
  const threads = [1.3, 3.3, 5.3];
  s.p(0, 0, 0); s.p(W, D, 0);
  s.add(s.grid(-6, 13, -6, 12));
  layers.forEach((layer, i) => {
    const z = i * GAP + T;
    // the threads that land on this plate are drawn before it, so the plate above hides their tops
    if (i > 0) threads.forEach((x, k) => s.add(s.route([[x, NODE, z], [x, NODE, z - GAP]], { cls: 'il-wire', draw: 900 + (2 - i) * 320 + k * 90, pulse: 2200 + (2 - i) * 900 + k * 500 })));
    const on = layer.top === 'il-accent';
    const [lx, ly] = s.p(W, 0.7, z - T / 2);
    s.add(s.g('il-drop', i * 150,
      s.slab(0, 0, z - T, W, D, T, 0.6, layer.top),
      // what is written on each plate: clauses, requirements, test rows
      `<path class="${on ? 'il-code il-code--on' : 'il-code'}" d="${[0.9, 1.6, 2.3].map((y, k) => s.d([[0.9, y, z], [[5.4, 3.6, 4.6][(k + i) % 3], y, z]], false)).join('')}"/>`,
      threads.map((x, k) => s.g('il-pop', 700 + (2 - i) * 320 + k * 90, s.dot(x, NODE, z, 3.4, on ? 'il-face' : 'il-accent')))));
    // the plate's name sits beside it, upright, so the threads never cross it
    s.p(W + 7.6, 0.7, z);
    s.add(s.g('il-fade', 500 + i * 150,
      `<path class="il-thin" d="M${n(lx + 7)} ${n(ly)}h14"/>`,
      `<text class="il-text il-ink" x="${n(lx + 28)}" y="${n(ly)}" font-size="11.5" dy="0.35em">${layer.name}</text>`));
  });
  return s.svg();
}

/* 05 Stakeholders: the 4C steps, up to a document that is signed */
function signoff() {
  const s = new Scene('signoff', { u: 19, label: 'Four steps, clarity, conflict, consensus and commitment, rising to a signed document' });
  const steps = ['CLARITY', 'CONFLICT', 'CONSENSUS', 'COMMITMENT'];
  const W = 2.5;
  const D = 5.2;
  s.p(0, 0, 0); s.p(W * 4, D, 0);
  s.add(s.grid(-6, 15, -6, 11));
  // back to front: the top step is at the back
  steps.slice().reverse().forEach((name, k) => {
    const i = 3 - k;
    const x = (3 - i) * W;
    const h = (i + 1) * 0.8;
    const last = i === 3;
    if (last) {
      // the signed sheet stands behind the top step, facing right: y1 is its left edge
      const X = -0.2;
      const y0 = 0.5;
      const y1 = 4.7;
      const z0 = h + 0.3;
      const z1 = z0 + 4.7;
      const on = (y, z) => { const [a, b] = s.p(X, y, z); return `matrix(${n(C)} ${n(-S)} 0 1 ${n(a)} ${n(b)})`; };
      s.add(s.g('il-drop', 1150,
        s.face([[X, y0, z0], [X, y1, z0], [X, y1, z1], [X, y0, z1]], 'il-face'),
        `<path class="il-code" d="${[0.7, 1.3, 1.9, 2.5].map((dz, r) => s.d([[X, y1 - 0.55, z1 - dz], [X, y1 - [3.6, 3.1, 3.6, 2.2][r], z1 - dz]], false)).join('')}"/>`,
        `<path class="il-thin" d="${s.d([[X, y1 - 0.55, z0 + 0.7], [X, y1 - 2.6, z0 + 0.7]], false)}"/>`,
        `<path class="il-sign il-draw" pathLength="1" style="--d:1750ms" transform="${on(y1 - 0.65, z0 + 0.85)}" d="M0 0c3-9 7-13 9-9s-5 11-2 10 6-10 9-8-2 8 1 7 4-5 7-4"/>`,
        s.g('il-stamp', 2250, `<g transform="${on(1.75, z0 + 1.75)} rotate(-10)"><rect class="il-stamp__box" x="-25" y="-10" width="50" height="20" rx="3"/><text class="il-text il-stamp__text" font-size="10" text-anchor="middle" dy="0.36em">SIGNED</text></g>`)));
    }
    s.add(s.riser(x, 0, 0, W, D, h, { top: last ? 'il-accent' : 'il-face', left: last ? 'il-soft' : 'il-face', right: last ? 'il-accent-deep' : 'il-shade' }, i * 170));
    s.add(s.g('il-fade', 420 + i * 170, s.text(x + W / 2, D / 2, h, name, { size: 10.5, cls: last ? 'il-on' : 'il-ink' })));
  });
  return s.svg();
}

/* ── the "Things I've built" cards: small drawings, no backdrop ──────────── */

const SPOT = { u: 14, pad: [4, 6], spot: true };

/* BA Workbench: a tray of five tools, one picked up */
function spotWorkbench() {
  const s = new Scene('spot-workbench', { ...SPOT, label: 'A tray holding five tools, one lifted out' });
  const slots = [[0.7, 0.7], [3.2, 0.7], [5.7, 0.7], [1.95, 3.2], [4.45, 3.2]];
  s.add(s.g('il-drop', 0, s.slab(0, 0, 0, 8.4, 5.9, 0.35, 0.8, 'il-tint')));
  slots.forEach(([x, y], i) => {
    const picked = i === 4;
    if (picked) s.add(s.g('il-fade', 700, s.tile(x, y, 0.35, 2, 2, 0.45, 'il-ghost')));
    s.add(s.g('il-drop', 160 + i * 90, s.g(picked ? 'il-float' : '', 0, s.slab(x, y, picked ? 1.05 : 0.35, 2, 2, 0.4, 0.45, picked ? 'il-accent' : 'il-face'))));
  });
  return s.svg();
}

/* 4C Framework: four steps, each one firmer than the last */
function spot4c() {
  const s = new Scene('spot-4c', { ...SPOT, label: 'Four blocks marked C, each taller than the one before, the last one finished' });
  s.add(s.route([[1.1, 1.1, 0], [10.7, 1.1, 0]], { draw: 300, pulse: 1600 }));
  [0, 1, 2, 3].forEach((i) => {
    const h = 0.35 + i * 0.5;
    const last = i === 3;
    s.add(s.g('il-drop', i * 110,
      s.slab(i * 3.2, 0, 0, 2.2, 2.2, h, 0.45, last ? 'il-accent' : 'il-face'),
      s.text(i * 3.2 + 1.1, 1.1, h, 'C', { size: 12, cls: last ? 'il-on' : 'il-ink' })));
  });
  return s.svg();
}

/* BA Bridge Cohort: twelve planks, one a week, from where you are to the role */
function spotBridge() {
  const s = new Scene('spot-bridge', { ...SPOT, label: 'A bridge of twelve planks between two blocks, the far one marked BA' });
  const from = 2.2;
  const to = 11.2;
  const pitch = (to - from) / 12;
  s.add(s.g('il-drop', 0, s.block(0, 0, 0, from, 3, 1.3)));
  s.add(s.route([[from, 0.45, 1.1], [to, 0.45, 1.1]], { draw: 250, r: 0 }));
  for (let i = 0; i < 12; i++) {
    s.add(s.g('il-drop', 350 + i * 70, s.block(from + i * pitch + 0.1, 0.45, 1.1, pitch - 0.2, 2.1, 0.2, { top: 'il-face', left: 'il-face', right: 'il-shade' })));
  }
  s.add(s.route([[from, 2.55, 1.1], [to, 2.55, 1.1]], { draw: 250, r: 0 }));
  s.add(s.g('il-drop', 180,
    s.block(to, 0, 0, 2.4, 3, 1.3, { top: 'il-accent', left: 'il-soft', right: 'il-accent-deep' }),
    s.text(to + 1.2, 1.5, 1.3, 'BA', { size: 11, cls: 'il-on' })));
  s.add(s.route([[from - 0.6, 1.5, 1.3], [to + 0.5, 1.5, 1.3]], { draw: null, cls: 'il-none', pulse: 1500, r: 0 }));
  return s.svg();
}

/* Apply Like You Mean It: the book, on an application that got its tick */
function spotBook() {
  const s = new Scene('spot-book', { ...SPOT, label: 'A book lying on a job application marked with a tick' });
  const sheet = [[2.6, 1.2, 0], [7.4, 1.2, 0], [7.4, 7.6, 0], [2.6, 7.6, 0]];
  s.add(s.g('il-fade', 0, s.face(sheet, 'il-face'),
    `<path class="il-code" d="${[6.3, 6.9].map((y, k) => s.d([[3.2, y, 0], [k ? 4.6 : 5.6, y, 0]], false)).join('')}"/>`));
  s.add(s.g('il-pop', 900, tick(s, 6.5, 6.75, 0, 3.4)));
  s.add(s.g('il-drop', 250,
    s.block(0, 0, 0, 4.4, 5.6, 1, { top: 'il-accent', left: 'il-face', right: 'il-accent-deep' }),
    `<path class="il-thin" d="${[0.33, 0.66].map((z) => s.d([[0, 5.6, z], [4.4, 5.6, z]], false)).join('')}"/>`,
    `<path class="il-code il-code--on" d="${[1, 1.7].map((x, k) => s.d([[x, 4.9, 1], [x, k ? 2.6 : 1.4, 1]], false)).join('')}"/>`));
  return s.svg();
}

export const illustrations = {
  requirements, automation, process: processFix, compliance, signoff,
  'spot-workbench': spotWorkbench, 'spot-4c': spot4c, 'spot-bridge': spotBridge, 'spot-book': spotBook,
};

/* ── writing them into the pages ────────────────────────────────────────── */

const MARK = /(<!--illo:([a-z0-9-]+)-->)([\s\S]*?)(<!--\/illo:\2-->)/g;

export function htmlFiles(dir = repo) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(full) : entry.name.endsWith('.html') ? [full] : [];
  });
}

export function draw(page, drawn = {}) {
  return page.replace(MARK, (_all, open, name, _old, close) => {
    if (!illustrations[name]) throw new Error(`No illustration called "${name}"`);
    drawn[name] ??= illustrations[name]();
    return open + drawn[name] + close;
  });
}

export function staleFiles(root = repo) {
  const drawn = {};
  return htmlFiles(root).filter((file) => {
    const page = fs.readFileSync(file, 'utf8');
    return draw(page, drawn) !== page;
  }).map((file) => path.relative(root, file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const drawn = {};
  let changed = 0;
  for (const file of htmlFiles()) {
    const page = fs.readFileSync(file, 'utf8');
    const next = draw(page, drawn);
    if (next === page) continue;
    changed++;
    if (check) console.log(`out of date: ${path.relative(repo, file)}`);
    else fs.writeFileSync(file, next);
  }
  console.log(check
    ? (changed ? `${changed} page(s) need: node scripts/build_illustrations.mjs` : 'Every illustration matches scripts/build_illustrations.mjs.')
    : `Redrew the illustrations in ${changed} page(s).`);
  if (check && changed) process.exitCode = 1;
}
