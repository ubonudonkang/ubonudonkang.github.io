import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { makeHarness } from './gas_harness.mjs';

/* Shared set-up for the dashboard page tests (test_admin_ui.mjs and test_admin_pages.mjs):
   the page (scripts/admin.html.txt) runs in a real browser against the real server code (scripts/site_forms.gs, in the Apps Script stand-in).
   google.script.run is replaced by a shim that forwards adminApi() calls to that stand-in. */

const require = createRequire(import.meta.url);
export let chromium;
for (const where of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
  try { ({ chromium } = require(where)); break; } catch (e) { /* try the next place */ }
}
export const chromePath = ['/opt/pw-browsers/chromium', process.env.CHROME_PATH].find((p) => p && fs.existsSync(p));
export let axeSource = '';
for (const where of ['axe-core/axe.min.js', process.env.AXE_PATH || '']) {
  try { axeSource = fs.readFileSync(where.startsWith('/') ? where : require.resolve(where), 'utf8'); break; } catch (e) { /* optional */ }
}

export const BUILD = 'Build 7';
export const SANDBOX_KEY = 'sandbox_sk_testkey123';
export const DAY = 24 * 60 * 60 * 1000;
export const squadOk = (extra = {}) => ({ code: 200, body: { data: { transaction_status: 'Success', transaction_amount: 8000000, transaction_currency_id: 'NGN', ...extra } } });
export const enrolOf = (reference, extra = {}) => ({
  action: 'signup', reference, name: 'Ada Example', email: 'ada@example.test', whatsapp: '+234 800 000 0001',
  location: 'Lagos', background: 'Finance', experience: '3', stage: 'Exploring', wants: 'Portfolio', availability: 'Weekday evenings',
  source: 'LinkedIn', consent: 'Yes', ...extra,
});
export const webhook = (ref) => ({ Event: 'charge_successful', TransactionRef: ref, Body: { transaction_ref: ref } });
export const postJson = (h, payload) => h.context.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(payload) } });

export function seeded(options = {}) {
  const answers = {};
  const h = makeHarness({ squad: { key: SANDBOX_KEY, respond: (url) => answers[url.split('/verify/')[1]] || { code: 400, body: { data: null } } }, ...options });
  h.answers = answers;
  h.cell = (reference, label, value) => {
    const row = h.enrolmentSheet.rows.find((r) => r[1] === reference);
    const index = h.enrolmentSheet.rows[0].indexOf(label);
    if (value !== undefined) row[index] = value;
    return row[index];
  };
  h.pay = (reference, extra) => { h.answers[`${reference}-1`] = squadOk(extra); postJson(h, webhook(`${reference}-1`)); };
  return h;
}

// Enough people for two pages, and one of each state. Names are fixed so the tests can find them.
export function populate(h) {
  const now = Date.now();
  const people = [
    ['BAB-UI1-AAA', 'Adaeze Awaiting', 'adaeze@example.test'],
    ['BAB-UI2-AAA', 'Bola Stale', 'bola@example.test'],
    ['BAB-UI3-AAA', 'Chidi Paid', 'chidi@example.test'],
    ['BAB-UI4-AAA', 'Dayo Wrong Amount', 'dayo@example.test'],
    ['BAB-UI5-AAA', 'Efe Confirmed', 'efe@example.test'],
    ['BAB-UI6-AAA', '<img src=x onerror="window.__xss=1"> Mallory', 'mallory@example.test'],
  ];
  people.forEach(([reference, name, email]) => h.context.doPost({ parameter: enrolOf(reference, { name, email }) }));
  h.cell('BAB-UI2-AAA', 'Timestamp', new Date(now - 5 * DAY));
  h.pay('BAB-UI3-AAA');
  h.pay('BAB-UI4-AAA', { transaction_amount: 100000 });
  h.pay('BAB-UI5-AAA');
  h.context.doPost({ parameter: { action: 'confirm', intent: 'confirm', reference: 'BAB-UI5-AAA', token: h.cell('BAB-UI5-AAA', 'Confirmation token'), amount_paid: '80000' } });
  // the confirmed one's welcome email failed, which is the most urgent kind of problem
  h.cell('BAB-UI5-AAA', 'Welcome email sent at', '');
  h.cell('BAB-UI5-AAA', 'Welcome email error', 'Invalid student email address.');
  // Fill out a second page of list.
  for (let i = 0; i < 24; i++) h.context.doPost({ parameter: enrolOf(`BAB-FILL${String(i).padStart(2, '0')}-AAA`, { name: `Filler ${i}`, email: `filler${i}@example.test` }) });
  return h;
}

// A tiny server for the page. The page is whatever doGet returns, as the live deployment would serve it.
export function serve(html, policy = "require-trusted-types-for 'script'") {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/fonts/')) { res.writeHead(404); res.end(); return; }
    // Google's frame can refuse string-to-HTML assignments (innerHTML and friends); serving the page under the same rule keeps it honest.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy });
    res.end(html);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

// Stands in for google.script.run. Calls go to `backend`, a harness.
export async function open(browser, backend, { width = 1280, height = 900, scheme = 'light', url, failures = {}, delays = {}, before = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: 'reduce', permissions: [] });
  await context.route('**/*', (route) => (route.request().url().startsWith('http://127.0.0.1') ? route.continue() : route.abort()));
  const page = await context.newPage();
  const calls = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.exposeFunction('__adminApi', async (method, json) => {
    calls.push(method);
    if (failures[method]) throw new Error(failures[method]);
    // delays[method] is a queue of milliseconds to hold back the next answers, so a slow reply can arrive after a fast one
    const wait = (delays[method] || []).shift();
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return JSON.stringify(backend.api(method, JSON.parse(json)));
  });
  await page.addInitScript(() => {
    const make = (ok, fail) => ({
      withSuccessHandler: (f) => make(f, fail),
      withFailureHandler: (f) => make(ok, f),
      adminApi: (method, params) => {
        window.__adminApi(method, JSON.stringify(params))
          .then((text) => setTimeout(() => ok && ok(JSON.parse(text)), 20))
          .catch((e) => setTimeout(() => fail && fail(new Error(String(e.message).replace(/^Error: /, ''))), 20));
      },
    });
    window.google = { script: { run: make() } };
  });
  if (before) await page.addInitScript(before);
  await page.goto(url);
  return { page, context, calls, errors };
}

export async function until(check, ms = 5000) {
  const stop = Date.now() + ms;
  while (!check()) {
    if (Date.now() > stop) throw new Error('Timed out waiting for: ' + check);
    await new Promise((r) => setTimeout(r, 25));
  }
}
export const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
export const rowsOf = (page) => page.locator('tbody tr');
export async function axeViolations(page) {
  if (!axeSource) return [];
  await page.evaluate(axeSource);
  const res = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })).violations
    .map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.html.slice(0, 120)).join(' | ')}`));
  return res;
}


// The other pages' data: a waitlist (with a repeat and some hostile text), enquiries, 1:1 sessions and invites.
export function populateMore(h) {
  const wl = (email, cohort, name) => h.post({ form_name: 'ba-waitlist-x', name, email, cohort, consent: 'Yes' });
  wl('ada.w@example.test', 'February 2027', 'Ada Waits');
  wl('bayo.w@example.test', 'February 2027', 'Bayo Waits');
  wl('chi.w@example.test', 'May 2027', 'Chi Waits');
  wl('mal.w@example.test', 'May 2027', '<img src=x onerror="window.__xss=3"> Mallory');
  wl('formula.w@example.test', 'May 2027', '=HYPERLINK("http://evil.example","click")');
  const tab = h.named.Waitlist;
  // Google Sheets turns the typed cohort into a date; one signup repeats an earlier one (saved before the form refused repeats)
  const cohortAt = tab.rows[0].indexOf('cohort');
  tab.rows.slice(1).forEach((row) => { if (row[cohortAt] === 'February 2027') row[cohortAt] = new Date('2027-01-31T23:00:00Z'); });
  tab.rows.push([new Date(), 'ba-waitlist-x', 'Ada Waits again', 'Ada.W@example.test', 'February 2027', 'Yes', 'x']);

  const contact = (n, extra = {}) => h.post({ form_name: 'contact', first_name: 'Ola' + n, last_name: 'Okoye', email: `enq${n}@example.test`, company: 'Acme', type: 'Mentoring', message: 'Hello, I would like to know more.\nSecond line ' + n, submission_id: 'sub' + n, ...extra });
  contact(1);
  contact(2, { first_name: '<img src=x onerror="window.__xss=2">', message: '<script>window.__xss=4</script> text' });
  contact(3, { company: '', type: '' });

  h.answers['UU1-SESS0001'] = squadOk({ transaction_amount: 1500000 });
  h.answers['UU1-SESS0002'] = squadOk({ transaction_amount: 100 });
  postJson(h, webhook('UU1-SESS0001')); postJson(h, webhook('UU1-SESS0002'));

  h.api('createInvite', { name: 'Ngozi Eze', email: 'ngozi@example.test' });
  h.api('createInvite', { name: 'Used Person', email: 'used@example.test' });
  const invites = h.named['BA Bridge Invites'];
  const used = invites.rows.at(-1);
  used[4] = 'Used'; used[5] = '2026-10-10 10:00:00'; used[6] = 'BAB-UI3-AAA';
  return h;
}
