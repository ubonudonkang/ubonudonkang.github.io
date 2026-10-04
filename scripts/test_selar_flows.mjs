import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const site = read('js/site.js');
const cohort = read('ba-training/index.html');
const dormantCheckout = read('scripts/ba_bridge_checkout.template.txt');
const session = read('resources/1-on-1-session/index.html');
const readme = read('README.md');

const helperStart = site.indexOf('function selarCheckoutUrl');
const helperEnd = site.indexOf('/* ── 1:1 session', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'checkout helper is present');
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(site.slice(helperStart, helperEnd), sandbox);

const careerUrl = new URL(sandbox.selarCheckoutUrl('https://selar.com/a50i7pv9b6', { name: 'Ada Example', email: 'ada@example.test' }));
assert.equal(careerUrl.origin + careerUrl.pathname, 'https://selar.com/a50i7pv9b6');
assert.equal(careerUrl.searchParams.get('add_to_cart'), '1');
assert.equal(careerUrl.searchParams.get('fullname'), 'Ada Example');
assert.equal(careerUrl.searchParams.get('email'), 'ada@example.test');

assert.match(site, /uu-session-selar-pending/);
assert.match(site, /uu-session-selar-returned/);
assert.match(site, /payment'\) === 'selar'/);
assert.match(site, /clearProcessedPaymentParam\(\)/);
assert.match(site, /value\.product === 'career-clarity-selar'/);
assert.match(site, /\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$/);
assert.match(site, /cal\.com\/ubonudonkang\/1-on-1-career-clarity-session/);
assert.doesNotMatch(session, /cal\.com\/ubonudonkang\/1-on-1-career-clarity-session/, 'the booking URL must not be exposed by the page markup');

assert.match(cohort, /action="https:\/\/formspree\.io\/f\/xdaqwayj" method="POST"/);
assert.match(cohort, /name="cohort" value="February 2027"/);
assert.match(cohort, /name="name"[^>]*required data-fs-field/);
assert.match(cohort, /name="email"[^>]*required data-fs-field/);
assert.match(cohort, /name="consent"[^>]*required data-fs-field/);
assert.match(cohort, /data-fs-success/);
assert.match(cohort, /data-fs-submit-btn>Join the waitlist/);
assert.doesNotMatch(cohort, /https:\/\/selar\.com\/1187725024|ENDPOINT_URL|window\.location\.assign|id="pay-retry"|Continue to payment|payment_status\s*=/,
  'closed BA registration must not create applications or open checkout');
assert.match(dormantCheckout, /Continue to payment/);
assert.match(dormantCheckout, /grouped\.payment_status = "Awaiting payment"/);
assert.match(dormantCheckout, /grouped\.action = "signup"/);
assert.match(dormantCheckout, /https:\/\/selar\.com\/1187725024/);
assert.match(dormantCheckout, /uu-cohort-selar-pending/);
assert.match(dormantCheckout, /=== ORIGINAL ENROLMENT SCRIPT ===/);
assert.match(dormantCheckout, /<form id="waitlist-form"[\s\S]*?<\/form>/);
const archivedScript = dormantCheckout.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(archivedScript, 'the complete dormant checkout handler must be retained');
new vm.Script(archivedScript);
assert.match(cohort, /uu-cohort-selar-pending/);
assert.match(cohort, /get\('payment'\) === 'selar'/);
assert.match(cohort, /removePaymentParam\(\)/);
assert.match(cohort, /value\.product === 'ba-bridge-selar'/);
assert.doesNotMatch(cohort, /action", "payment/);
assert.doesNotMatch(cohort, /schema\.org\/InStock|2026-11-02/, 'closed cohort must not be advertised as available to search engines');
assert.match(session, /site\.js\?v=booking-button-20261004/);
assert.match(cohort, /site\.js\?v=selar-20261003/);
assert.match(readme, /browser return, query parameter, or session-storage record is not server-verified proof/i);

const legacyScript = cohort.match(/<script>\s*\/\* Keep the return message[\s\S]*?<\/script>/)?.[0];
assert.ok(legacyScript, 'earlier buyer return handler is present');
function runEarlierReturn(search, stored = {}) {
  const values = new Map(Object.entries(stored));
  const elements = {
    'waitlist-form': { hidden: false },
    'form-done': { hidden: true, focus() {} },
    'payment-status': { textContent: '' },
    'done-ref': { textContent: '' },
  };
  let replaced = '';
  let formspreeInit = null;
  const context = {
    URL, URLSearchParams,
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    document: {
      getElementById: (id) => elements[id],
      querySelectorAll: () => [],
    },
    location: { href: `https://ubonudonkang.com/ba-training/${search}`, search },
    history: { replaceState(_state, _title, url) { replaced = url; } },
    formspree(...args) { formspreeInit = args; },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(legacyScript.slice(8, -9), context);
  assert.equal(formspreeInit[0], 'initForm');
  assert.equal(formspreeInit[1].formId, 'xdaqwayj');
  return { elements, values, replaced };
}
const earlierBuyer = { product: 'ba-bridge-selar', reference: 'BAB-OLD-123', name: 'Ada Example', email: 'ada@example.test' };
const unmatchedReturn = runEarlierReturn('?payment=selar');
assert.equal(unmatchedReturn.elements['form-done'].hidden, true, 'a query parameter alone cannot show the earlier payment card');
assert.equal(unmatchedReturn.replaced, '/ba-training/');
const matchedReturn = runEarlierReturn('?payment=selar', { 'uu-cohort-selar-pending': JSON.stringify(earlierBuyer) });
assert.equal(matchedReturn.elements['form-done'].hidden, false);
assert.equal(matchedReturn.elements['waitlist-form'].hidden, true);
assert.equal(matchedReturn.elements['done-ref'].textContent, earlierBuyer.reference);
assert.equal(matchedReturn.replaced, '/ba-training/');
assert.ok(matchedReturn.values.has('uu-cohort-selar-returned'));
const refreshed = runEarlierReturn('', { 'uu-cohort-selar-returned': JSON.stringify(earlierBuyer) });
assert.equal(refreshed.elements['form-done'].hidden, false);
const unrelated = runEarlierReturn('?payment=selar', { 'uu-cohort-selar-pending': JSON.stringify({ ...earlierBuyer, product: 'another-product' }) });
assert.equal(unrelated.elements['form-done'].hidden, true);

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(fullPath) : entry.name.endsWith('.html') ? [fullPath] : [];
  });
}
let promotionCount = 0;
for (const file of htmlFiles(fileURLToPath(root))) {
  const html = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(html, /Enrol for November|Join November Cohort|10 Seats Available|Now enrolling|href="#join"/i,
    `${file} must not invite November registration`);
  if (/class="cohort__eyebrow/.test(html)) {
    promotionCount += 1;
    assert.match(html, /November cohort full · February 2027 waitlist/);
    assert.match(html, /href="\/ba-training\/#waitlist"[^>]*>Join the February waitlist/);
  }
  if (/class="topbar__cta"|class="cohort-cta"/.test(html)) {
    assert.match(html, /aria-label="Join February 2027 Waitlist"/);
  }
}
assert.equal(promotionCount, 21, 'all content-page promotions should point to the waitlist');

const retiredProvider = new RegExp('s' + 'quad', 'i');
for (const [name, source] of Object.entries({ site, cohort, session, readme })) {
  assert.doesNotMatch(source, retiredProvider, `${name} must not retain retired checkout integration`);
}
console.log('Selar and closed-cohort waitlist offline checks passed.');
