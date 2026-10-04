import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const site = read('js/site.js');
const cohort = read('ba-training/index.html');
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

assert.match(cohort, /https:\/\/selar\.com\/1187725024/);
assert.match(cohort, /payment_status = "Awaiting payment"/);
assert.match(cohort, /uu-cohort-selar-pending/);
assert.match(cohort, /payment"\) === "selar"/);
assert.match(cohort, /removePaymentParam\(\)/);
assert.match(cohort, /value\.product === "ba-bridge-selar"/);
assert.doesNotMatch(cohort, /action", "payment/);
assert.match(session, /site\.js\?v=booking-button-20261004/);
assert.match(cohort, /site\.js\?v=selar-20261003/);
assert.match(readme, /browser return, query parameter, or session-storage record is not server-verified proof/i);

const retiredProvider = new RegExp('s' + 'quad', 'i');
for (const [name, source] of Object.entries({ site, cohort, session, readme })) {
  assert.doesNotMatch(source, retiredProvider, `${name} must not retain retired checkout integration`);
}
console.log('Selar offline flow checks passed.');
