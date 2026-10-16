import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, htmlFiles, inputs, minify, staleFiles, versions } from './build_assets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// Every page carries the current stylesheet and script versions (run: node scripts/build_assets.mjs).
assert.deepEqual(staleFiles(), [], 'run: node scripts/build_assets.mjs');

const { css, hashes } = inputs();
for (const [file, hash] of Object.entries(hashes)) assert.match(hash, /^[0-9a-f]{8}$/, file);

let carriers = 0;
let inlined = 0;
const withoutSite = [];
const withoutCss = [];
for (const file of htmlFiles()) {
  const page = fs.readFileSync(file, 'utf8');
  const relative = file.replace(root, '');
  const style = page.match(/<style data-inline="site\.css">([\s\S]*?)<\/style>/);
  if (style) { inlined++; assert.equal(style[1], css, `${relative} has the current css/site.css inline`); } else withoutCss.push(relative);
  if (!/\/js\/site\.js/.test(page)) { withoutSite.push(relative); continue; }
  assert.match(page, /<script src="\/js\/site\.js\?v=[0-9a-f]{8}"><\/script>/, `${relative} loads site.js with a content version`);
  if (/\/js\/forms\.js/.test(page)) {
    carriers++;
    assert.match(page, /<script src="\/js\/forms\.js\?v=[0-9a-f]{8}"><\/script>/, `${relative} loads forms.js with a content version`);
    // forms.js needs window.uuTrack from site.js, so site.js must come first.
    assert.ok(page.indexOf('/js/site.js') < page.indexOf('/js/forms.js'), `${relative} loads site.js before forms.js`);
  }
}
// The BA Workbench is a self-contained tool with its own styles and no site.js.
assert.deepEqual(withoutSite, ['resources/ba-workbench/index.html']);
assert.deepEqual(withoutCss, ['resources/ba-workbench/index.html']);
assert.equal(inlined, 23);
assert.equal(carriers, 3, 'contact, BA Training and the 1:1 session load forms.js');

// minify: drops comments and the whitespace around punctuation, and nothing inside a value
assert.equal(minify('/* c */ a { color: red; margin: 0 auto; }\n\n.b , .c {\n  font: 1px/2 x, y;\n}'), 'a{color: red;margin: 0 auto}.b,.c{font: 1px/2 x,y}');

// building touches only the stylesheet block and the version tags, and is idempotent
const fake = { css: 'p{color: red}', hashes: { 'js/site.js': 'aaaaaaaa', 'js/forms.js': 'bbbbbbbb' } };
const sample = '<style data-inline="site.css">old</style><script src="/js/site.js?v=old"></script><script src="/js/forms.js"></script><img src="/img/site.js?v=keep">';
const once = build(sample, fake);
assert.equal(once, '<style data-inline="site.css">p{color: red}</style><script src="/js/site.js?v=aaaaaaaa"></script><script src="/js/forms.js"></script><img src="/img/site.js?v=keep">');
assert.equal(build(once, fake), once);

// Text that must stay readable. These are the colours fixed after an accessibility scan; the check keeps them from drifting back.
const luminance = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const blend = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const source = fs.readFileSync(new URL('../css/site.css', import.meta.url), 'utf8');
const alphaOf = (selector) => Number(source.match(new RegExp(`${selector} \\{[^}]*color: rgba\\(\\d+,\\d+,\\d+,([\\d.]+)\\)`))[1]);
const paper = hex('#E3C58F');
for (const selector of ['\\.doc__caption', '\\.doc__hint']) assert.ok(contrast(blend([60, 40, 5], paper, alphaOf(selector)), paper) >= 4.5, `${selector} on the case-file paper`);
assert.ok(contrast(blend([0, 0, 0], hex('#FBE38A'), alphaOf('\\.ways__note-label')), hex('#FBE38A')) >= 4.5, 'note label on the sticky note');
assert.ok(contrast(hex(source.match(/\.doc-rtm \.ok \{ color: (#[0-9A-Fa-f]{6})/)[1]), [255, 255, 255]) >= 4.5, 'Passed cells');
// the stamp is drawn at 0.88 opacity, so test the colour as it is actually painted
assert.ok(contrast(blend(hex(source.match(/--stamp: (#[0-9A-Fa-f]{6})/)[1]), [255, 255, 255], 0.88), [255, 255, 255]) >= 4.5, 'stamp on white');
assert.ok(contrast(hex(source.match(/\[data-theme="dark"\] \.outcome \.stamp \{[^}]*color: (#[0-9A-Fa-f]{6})/)[1]), hex('#0E0E10')) >= 4.5, 'stamp on the dark theme');
const workbench = fs.readFileSync(new URL('../resources/ba-workbench/index.html', import.meta.url), 'utf8');
const rail = hex('#10172A');
for (const selector of ['\\.nav-group', '\\.rail-foot']) {
  const a = Number(workbench.match(new RegExp(`${selector}\\{[^}]*color:rgba\\(247,244,236,([\\d.]+)\\)`))[1]);
  assert.ok(contrast(blend([247, 244, 236], rail, a), rail) >= 4.5, `Workbench ${selector} on the side rail`);
}
// Fonts: the naira sign must come from its own tiny file, and no big latin-ext face may claim it,
// otherwise every page with a price downloads tens of kilobytes of font to draw one character.
const faces = [...source.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => ({
  family: m[1].match(/font-family:\s*'([^']+)'/)[1],
  file: m[1].match(/url\(([^)]+)\)/)[1],
  ranges: m[1].match(/unicode-range:\s*([^;]+)/)[1].split(',').map((r) => r.trim().slice(2).split('-').map((h) => parseInt(h, 16))).map(([a, b = a]) => [a, b]),
}));
const claimsNaira = faces.filter((f) => f.ranges.some(([a, b]) => a <= 0x20A6 && 0x20A6 <= b));
assert.deepEqual(claimsNaira.map((f) => f.file), ['/fonts/inter-naira.woff2'], 'only the small naira font may claim U+20A6');
const naira = fs.readFileSync(new URL('../fonts/inter-naira.woff2', import.meta.url));
assert.equal(naira.subarray(0, 4).toString(), 'wOF2');
assert.ok(naira.length < 4096, `the naira font is ${naira.length} bytes`);
for (const face of faces) assert.ok(fs.existsSync(new URL(`..${face.file}`, import.meta.url)), `${face.file} exists`);
// the carve-out must not drop the rest of the currency block from the latin-ext faces
for (const f of faces.filter((x) => /latin-ext/.test(x.file))) {
  const covers = (cp) => f.ranges.some(([a, b]) => a <= cp && cp <= b);
  assert.ok(covers(0x20A5) && covers(0x20A7) && covers(0x20AB) && covers(0x20AD), `${f.file} still covers the rest of the currency symbols`);
  assert.ok(covers(0x0100) && covers(0x0142), `${f.file} still covers Latin Extended letters`);
}
console.log('Asset build and readability checks passed.');
