import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The site's build step. There is nothing to compile; two things are copied into the pages:
 *
 *  1. css/site.css, lightly minified, goes into a <style data-inline="site.css"> block in every
 *     page, so the first paint is not held up by a separate stylesheet request.
 *  2. A version taken from the contents of js/site.js and js/forms.js goes into each script tag
 *     (/js/site.js?v=<hash>). GitHub Pages lets browsers keep a file for ten minutes, so without
 *     it a visitor could pair a new page with an old cached script.
 *
 * After editing css/site.css, js/site.js or js/forms.js, run:
 *
 *   node scripts/build_assets.mjs          update every page
 *   node scripts/build_assets.mjs --check  list pages that are out of date (the tests use this)
 */
const repo = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS = ['js/site.js', 'js/forms.js'];
const INLINE_CSS = /(<style data-inline="site\.css">)([\s\S]*?)(<\/style>)/;

export function minify(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

export function versions(root = repo) {
  return Object.fromEntries(SCRIPTS.map((file) => [
    file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 8),
  ]));
}

export function build(page, { css, hashes }) {
  let result = page.replace(INLINE_CSS, (_all, open, _old, close) => open + css + close);
  for (const [file, hash] of Object.entries(hashes)) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    result = result.replace(new RegExp(`(src="/${escaped})\\?v=[^"]*"`, 'g'), `$1?v=${hash}"`);
  }
  return result;
}

export function htmlFiles(dir = repo) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(full) : entry.name.endsWith('.html') ? [full] : [];
  });
}

export function inputs(root = repo) {
  return { css: minify(fs.readFileSync(path.join(root, 'css/site.css'), 'utf8')), hashes: versions(root) };
}

export function staleFiles(root = repo) {
  const built = inputs(root);
  return htmlFiles(root).filter((file) => {
    const page = fs.readFileSync(file, 'utf8');
    return build(page, built) !== page;
  }).map((file) => path.relative(root, file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const built = inputs();
  let changed = 0;
  for (const file of htmlFiles()) {
    const page = fs.readFileSync(file, 'utf8');
    const next = build(page, built);
    if (next === page) continue;
    changed++;
    if (check) console.log(`out of date: ${path.relative(repo, file)}`);
    else fs.writeFileSync(file, next);
  }
  const tags = Object.entries(built.hashes).map(([f, h]) => `${path.basename(f)}?v=${h}`).join(' and ');
  console.log(check
    ? (changed ? `${changed} page(s) need: node scripts/build_assets.mjs` : 'Every page matches css/site.css and the current script versions.')
    : `Updated ${changed} page(s) from css/site.css, with ${tags}.`);
  if (check && changed) process.exitCode = 1;
}
