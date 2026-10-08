import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { openTrainingPage, openContentPage, renderCheckoutTemplate, updateAppsScript,
  validateConfig, moveHomePromoBelowHero, openReadme, defaultEndpoint } from './open_ba_registration.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const input = {
  cohort: 'February 2027', start: '2027-02-02', deadline: '2027-01-25',
  seats: '12', price: '90000', selar: 'https://selar.com/abc123',
};
const config = validateConfig(input);
assert.equal(config.endpoint, defaultEndpoint(), 'without --apps-script the shared endpoint in js/forms.js is used');
assert.equal(validateConfig({ ...input, 'apps-script': 'https://script.google.com/macros/s/AKfycbyabc123/exec' }).endpoint,
  'https://script.google.com/macros/s/AKfycbyabc123/exec');
assert.equal(config.priceText, '90,000');
assert.equal(config.startLong, '2 February 2027');
assert.throws(() => validateConfig({ ...input, cohort: 'March 2027' }), /must match/);
assert.throws(() => validateConfig({ ...input, deadline: '2027-02-03' }), /before --start/);
assert.throws(() => validateConfig({ ...input, selar: 'https://evil.example/product' }), /--selar/);
assert.throws(() => validateConfig({ ...input, 'apps-script': 'https://script.google.com/macros/library/d/ABC/1' }), /deployed/);
assert.throws(() => validateConfig({ ...input, seats: '0' }), /positive whole number/);
assert.throws(() => validateConfig({ ...input, price: '90000.5' }), /positive NGN whole number/);
assert.throws(() => validateConfig({ ...input, selar: 'https://selar.com/NEW_PRODUCT' }), /Replace example/);

const template = renderCheckoutTemplate(read('scripts/ba_bridge_checkout.template.txt'), config);
assert.doesNotMatch(template, /\{\{/);
assert.match(template, /data-amount="90000"/);
assert.match(template, /data-cohort="February 2027"/);
assert.match(template, /data-selar-url="https:\/\/selar\.com\/abc123"/);
assert.match(template, /data-storage-prefix="uu-cohort-selar-february-2027"/);
assert.doesNotMatch(template, /data-endpoint=/, 'the default endpoint is not repeated in the page');
assert.match(renderCheckoutTemplate(read('scripts/ba_bridge_checkout.template.txt'),
  validateConfig({ ...input, 'apps-script': 'https://script.google.com/macros/s/AKfycbyabc123/exec' })),
  /data-endpoint="https:\/\/script\.google\.com\/macros\/s\/AKfycbyabc123\/exec"/);

const training = openContentPage(openTrainingPage(read('ba-training/index.html'), template, config), config, { training: true });
assert.match(training, /id="join"/);
assert.match(training, /Continue to payment/);
assert.match(training, /Pay ₦90,000/);
assert.match(training, /12 seats available/);
assert.match(training, /2 February 2027/);
assert.match(training, /25 January 2027/);
assert.match(training, /href="#join" aria-label="Join February Cohort"/);
assert.doesNotMatch(training, /data-form="waitlist"|name="form_name" value="ba-waitlist|name="cohort" value="February 2027"|Join the waitlist/);
assert.doesNotMatch(training, /href="#waitlist"|November cohort full|All 10 November seats taken/);
assert.match(training, /<form id="enrol-form" data-form="enrol"/);
assert.doesNotMatch(training, /BA_FLOW_SCRIPT|<form id="waitlist-form"/);

const jsonLd = JSON.parse(training.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
const course = jsonLd['@graph'].find((item) => item['@type'] === 'Course');
assert.equal(course.offers.price, 90000);
assert.equal(course.offers.validThrough, '2027-01-25');
assert.equal(course.hasCourseInstance.startDate, '2027-02-02');

const home = openContentPage(read('index.html'), config, { home: true });
assert.ok(home.indexOf('HOME_COHORT_PROMO_START') < home.indexOf('CASE FILE (about)'));
assert.ok(home.indexOf('HOME_COHORT_PROMO_START') > home.indexOf('class="stats"'));
assert.equal(moveHomePromoBelowHero(home), home);
assert.match(home, /Enrolling · February 2027/);
assert.match(home, /₦90,000/);
assert.match(home, /12 seats available/);
assert.match(home, /Join February Cohort/);
assert.doesNotMatch(home, /November cohort full|February 2027 waitlist|href="\/ba-training\/#waitlist"/);

const updatedApps = updateAppsScript(read('scripts/site_forms.gs'), config);
assert.match(updatedApps, /const EXPECTED_AMOUNT = 90000;/);
new vm.Script(updatedApps);
const updatedReadme = openReadme(read('README.md'), config);
assert.match(updatedReadme, /\*\*February 2027 enrolment:\*\*/);
assert.match(updatedReadme, /\*\*BA Bridge registration is open:\*\*/);

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(full) : entry.name.endsWith('.html') ? [full] : [];
  });
}
let promos = 0;
for (const file of htmlFiles(root)) {
  if (file.endsWith(path.join('ba-training', 'index.html'))) continue;
  const source = fs.readFileSync(file, 'utf8');
  const output = openContentPage(source, config, { home: file === path.join(root, 'index.html') });
  assert.doesNotMatch(output, /href="\/ba-training\/#waitlist"|aria-label="Join Waitlist"/);
  const stale = output.match(/November cohort full|February 2027 waitlist|Join the waitlist|join the free waitlist/i);
  assert.equal(stale?.[0], undefined, `${file} retains stale copy: ${stale?.[0]}`);
  if (source.includes('class="cohort__eyebrow')) {
    promos++;
    assert.match(output, /Enrolling · February 2027/);
    assert.match(output, /₦90,000/);
  }
}
assert.equal(promos, 21);
console.log('BA Bridge open-registration preview checks passed.');
