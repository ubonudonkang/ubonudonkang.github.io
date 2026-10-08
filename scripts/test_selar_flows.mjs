import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { closeRegistration, headerCtaToWaitlist, moveHomePromoToBottom, pointCohortLinksToWaitlist } from './close_ba_registration.mjs';
import { renderCheckoutTemplate, validateConfig } from './open_ba_registration.mjs';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const site = read('js/site.js');
const cohort = read('ba-training/index.html');
const dormantCheckout = read('scripts/ba_bridge_checkout.template.txt');
const dormantWaitlist = read('scripts/ba_bridge_waitlist.template.txt');
const session = read('resources/1-on-1-session/index.html');
const home = read('index.html');
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

const waitlistForm = cohort.match(/<form id="waitlist-form"[\s\S]*?<\/form>/)?.[0];
assert.ok(waitlistForm, 'the waitlist form is present');
assert.match(waitlistForm, /<form id="waitlist-form" data-form="waitlist" data-storage-prefix="uu-cohort-selar"/);
assert.doesNotMatch(waitlistForm, /\saction=/, 'the endpoint lives in js/forms.js only');
assert.doesNotMatch(cohort + read('contact/index.html'), /formspree|script\.google\.com/i, 'no page names a form backend');
assert.match(waitlistForm, /name="form_name" value="ba-waitlist-feb-2027"/);
assert.match(waitlistForm, /name="cohort" value="February 2027"/);
assert.match(waitlistForm, /name="type" value="BA Bridge February 2027 waitlist"/);
assert.match(waitlistForm, /<input type="text" name="_gotcha" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">/);
assert.match(waitlistForm, /name="name"[^>]*required/);
assert.match(waitlistForm, /name="email"[^>]*required/);
assert.match(waitlistForm, /name="consent" value="Yes" required/);
assert.deepEqual([...new Set([...waitlistForm.matchAll(/<input\b[^>]*?\sname="([^"]+)"/g)].map((m) => m[1]))].sort(),
  ['_gotcha', 'cohort', 'consent', 'email', 'form_name', 'name', 'type'],
  'the Waitlist tab only stores these fields, so the form must send no others');
assert.match(cohort, /<div data-fs-success class="f-done"/);
assert.match(cohort, /<script src="\/js\/forms\.js\?v=[^"]+"><\/script>/);
assert.doesNotMatch(cohort, /BA_FLOW_SCRIPT/, 'form behaviour lives in js/forms.js, not in the page');
assert.match(cohort, />Join the waitlist<\/button>/);
const contactForm = read('contact/index.html');
assert.match(contactForm, /<form id="contact-form" data-form="contact"/);
assert.match(contactForm, /name="form_name" value="contact"/);
assert.match(contactForm, /<script src="\/js\/forms\.js\?v=[^"]+"><\/script>/);
assert.doesNotMatch(contactForm, /unpkg\.com/);
assert.doesNotMatch(cohort, /https:\/\/selar\.com\/1187725024|ENDPOINT_URL|window\.location\.assign|id="pay-retry"|Continue to payment|payment_status\s*=/,
  'closed BA registration must not create applications or open checkout');
assert.match(dormantCheckout, /Continue to payment/);
assert.match(dormantCheckout, /\{\{SELAR_URL\}\}/);
assert.match(dormantCheckout, /data-storage-prefix="uu-cohort-selar-\{\{COHORT_SLUG\}\}"/);
assert.match(dormantCheckout, /=== ENROLMENT SECTION ===/);
assert.match(dormantCheckout, /<form id="enrol-form" data-form="enrol"[\s\S]*?<\/form>/);
assert.doesNotMatch(dormantCheckout, /<script/, 'enrolment behaviour lives in js/forms.js');
assert.match(dormantWaitlist, /\{\{CLOSED_COHORT\}\}/);
assert.match(dormantWaitlist, /\{\{NEXT_COHORT\}\}/);
assert.match(dormantWaitlist, /\{\{NEXT_COHORT_SLUG\}\}/);
assert.match(dormantWaitlist, /\{\{CLOSED_STORAGE_PREFIX\}\}/);
assert.doesNotMatch(dormantWaitlist, /formspree|<script/i);

function flowBlock(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last + end.length);
}
function replaceFlowBlock(page, template, start, end) {
  return page.replace(flowBlock(page, start, end), flowBlock(template, start, end));
}
const sectionStart = '<!-- BA_FLOW_SECTION_START -->';
const sectionEnd = '<!-- BA_FLOW_SECTION_END -->';
const renderedCheckout = renderCheckoutTemplate(dormantCheckout, validateConfig({
  cohort: 'November 2026', start: '2026-11-02', deadline: '2026-10-30', seats: '10', price: '80000',
  selar: 'https://selar.com/1187725024',
}));
const openedPage = replaceFlowBlock(cohort, renderedCheckout, sectionStart, sectionEnd);
const closedAgain = closeRegistration(openedPage, dormantWaitlist, 'November 2026', 'February 2027');
assert.equal(closedAgain, cohort, 'the stored waitlist flow should restore the current closed page exactly');
assert.equal(closeRegistration(cohort, dormantWaitlist, 'November 2026', 'February 2027'), cohort,
  'closing an already closed page should be idempotent');
const futureClosure = closeRegistration(openedPage, dormantWaitlist, 'February 2027', 'May 2027');
assert.match(futureClosure, /name="cohort" value="May 2027"/);
assert.match(futureClosure, /name="form_name" value="ba-waitlist-may-2027"/);
assert.match(futureClosure, /The February 2027 cohort is full/);
assert.match(futureClosure, /data-storage-prefix="uu-cohort-selar-february-2027"/);
assert.doesNotMatch(futureClosure, /Continue to payment|https:\/\/selar\.com\//);
assert.throws(() => closeRegistration(openedPage, dormantWaitlist, 'February', 'May 2027'), /Month YYYY/);
assert.equal(pointCohortLinksToWaitlist('<a href="/ba-training/#join">Enrol</a>'),
  '<a href="/ba-training/#waitlist">Enrol</a>');
assert.equal(headerCtaToWaitlist('<a class="btn btn-primary topbar__cta" href="/ba-training/#join" aria-label="Join February Cohort" data-goatcounter-click="header-cohort-cta">Join<span class="topbar__cta-detail"> February Cohort</span></a>'),
  '<a class="btn btn-primary topbar__cta" href="/ba-training/#waitlist" aria-label="Join Waitlist" data-goatcounter-click="header-waitlist-cta">Join Waitlist</a>');
assert.equal(headerCtaToWaitlist('<a class="btn btn-primary topbar__cta" href="#join" aria-label="Join Cohort">Join</a>', true),
  '<a class="btn btn-primary topbar__cta" href="#waitlist" aria-label="Join Waitlist">Join Waitlist</a>');
const movedHome = moveHomePromoToBottom(home);
assert.ok(movedHome.indexOf('HOME_COHORT_PROMO_START') > movedHome.indexOf('══ NOTES'));
assert.ok(movedHome.indexOf('HOME_COHORT_PROMO_END') < movedHome.indexOf('══ CLOSING'));
assert.equal(movedHome, home, 'the closed homepage promo should already be at the bottom');
assert.equal(moveHomePromoToBottom(movedHome), movedHome, 'closing twice must not move the promo again');
assert.doesNotMatch(cohort, /schema\.org\/InStock|2026-11-02/, 'closed cohort must not be advertised as available to search engines');
assert.match(session, /site\.js\?v=booking-button-20261004/);
assert.match(cohort, /site\.js\?v=selar-20261003/);
assert.match(readme, /browser return, query parameter, or session-storage record is not server-verified proof/i);

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
    const button = html.match(/<a class="(?:btn btn-primary topbar__cta|cohort-cta)"[^>]*>[\s\S]*?<\/a>/)?.[0];
    assert.ok(button, `${file} should have a header cohort button`);
    assert.match(button, /aria-label="Join Waitlist"/);
    assert.match(button, />Join Waitlist<\/a>$/);
  }
}
assert.equal(promotionCount, 21, 'all content-page promotions should point to the waitlist');

const retiredProvider = new RegExp('s' + 'quad', 'i');
for (const [name, source] of Object.entries({ site, cohort, session, readme })) {
  assert.doesNotMatch(source, retiredProvider, `${name} must not retain retired checkout integration`);
}
console.log('Selar and closed-cohort waitlist offline checks passed.');
