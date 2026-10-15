import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const forms = read('js/forms.js');
const ENDPOINT = forms.match(/const ENDPOINT = '([^']+)'/)[1];

assert.match(ENDPOINT, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
assert.equal((forms.match(/script\.google\.com/g) || []).length, 1, 'the endpoint is written once');
assert.doesNotMatch(forms, /formspree/i);

// The committed file ships with no Squad key; payment tests run against a copy that has one.
const SANDBOX_PUBLIC_KEY = 'sandbox_pk_testkey123';
assert.match(forms, /const SQUAD_PUBLIC_KEY = '(sandbox_)?(pk_[A-Za-z0-9]+)?';/, 'the key is a plain pk_ value or still empty');
const formsWithKey = forms.replace(/const SQUAD_PUBLIC_KEY = '[^']*';/, `const SQUAD_PUBLIC_KEY = '${SANDBOX_PUBLIC_KEY}';`);
assert.notEqual(formsWithKey, forms);

function element(props = {}) {
  const handlers = {};
  const el = {
    dataset: {}, style: {}, hidden: false, disabled: false, textContent: '', innerHTML: '', value: '', type: 'text',
    classes: new Set(), q: {},
    classList: { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)) },
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    fire(type, event = {}) { (handlers[type] || []).forEach((fn) => fn({ preventDefault() {}, ...event })); },
    querySelector(sel) { return (el.q[sel] || [])[0] || null; },
    querySelectorAll(sel) { return el.q[sel] || []; },
    scrollIntoView() {}, focus() {}, closest: () => null,
    ...props,
  };
  return el;
}

function run({ kind, dataset = {}, fields = [], search = '', storage = {}, fetchImpl, extra = {}, source = forms }) {
  const calls = [];
  const tracked = [];
  const assigned = [];
  const widgets = [];
  const store = new Map(Object.entries(storage));
  const success = element({ style: { display: 'none' } });
  const failure = element({ style: { display: 'none' } });
  const button = element({ innerHTML: 'Send <svg></svg>' });
  const form = element({
    dataset: { form: kind, ...dataset },
    checkValidity: () => form.valid !== false,
    reportValidity() { form.reported = true; },
    reset() { form.wasReset = true; },
    _fields: fields,
    ...extra.form,
  });
  form.q['button[type="submit"]'] = [button];
  Object.assign(form.q, extra.q);
  const byId = { 'form-done': element({ hidden: true }), 'done-ref': element(), 'payment-status': element(), ...extra.ids };
  const replaced = [];
  const context = {
    URL, URLSearchParams, JSON, Date, Math, console, Promise, parseInt, Set,
    crypto: { randomUUID: () => 'unique-id-1' },
    FormData: class { constructor(f) { this.entries = f._fields; } forEach(fn) { this.entries.forEach(([k, v]) => fn(v, k)); } },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    document: {
      querySelectorAll: (sel) => (sel === 'form[data-form]' ? [form] : []),
      querySelector: (sel) => ({ '[data-fs-success]': success, '[data-fs-error]': failure }[sel] || null),
      getElementById: (id) => byId[id],
    },
    location: { search, href: `https://ubonudonkang.com/page/${search}` },
    history: { replaceState: (_s, _t, url) => replaced.push(url) },
    fetch: (url, init) => { calls.push({ url, init, body: Object.fromEntries(init.body) }); return fetchImpl(url, init, calls.length); },
  };
  context.window = context;
  context.window.location.assign = (url) => assigned.push(url);
  // Squad's checkout widget: records how it was set up and lets a test finish or close it.
  context.squad = class {
    constructor(options) { this.options = options; widgets.push(this); }
    setup() { this.isSetup = true; }
    open() { this.isOpen = true; }
  };
  context.uuTrack = (name) => tracked.push(name);
  context.window.uuTrack = context.uuTrack;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { form, button, success, failure, byId, calls, tracked, assigned, store, replaced, widgets };
}

const ok = () => Promise.resolve({ json: () => Promise.resolve({ result: 'ok' }) });
const rejected = () => Promise.resolve({ json: () => Promise.resolve({ result: 'error', message: 'bad' }) });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ── Contact ─────────────────────────────────────────────── */
{
  const t = run({
    kind: 'contact', dataset: { errorText: 'Email me instead.' },
    fields: [['form_name', 'contact'], ['_gotcha', ''], ['first_name', ' Chidi '], ['last_name', 'Okafor'], ['email', 'chidi@example.test'], ['company', ''], ['type', 'consulting'], ['message', 'Hello']],
    fetchImpl: ok,
  });
  t.form.fire('submit');
  assert.equal(t.button.disabled, true, 'the button is disabled while sending');
  assert.equal(t.button.textContent, 'Sending…');
  t.form.fire('submit');
  assert.equal(t.calls.length, 1, 'a second click while sending is ignored');
  await flush();
  assert.equal(t.calls[0].url, ENDPOINT);
  assert.equal(t.calls[0].body.form_name, 'contact');
  assert.equal(t.calls[0].body.first_name, 'Chidi', 'values are trimmed');
  assert.equal(t.calls[0].body.submission_id, 'unique-id-1');
  assert.equal(t.success.style.display, 'block');
  assert.equal(t.form.wasReset, true);
  assert.deepEqual(t.tracked, ['contact-enquiry-consulting']);
  assert.equal(t.button.disabled, false);
  assert.equal(t.button.innerHTML, 'Send <svg></svg>', 'the button label and icon are restored');
}
{
  const t = run({ kind: 'contact', dataset: { errorText: 'Email me instead.' }, fields: [['email', 'a@b.test']], fetchImpl: rejected });
  t.form.fire('submit');
  await flush();
  assert.equal(t.failure.style.display, 'block');
  assert.equal(t.failure.textContent, 'Email me instead.');
  assert.equal(t.success.style.display, 'none');
  assert.equal(t.form.wasReset, undefined, 'a failed send keeps what the visitor typed');
  assert.deepEqual(t.tracked, []);
  assert.equal(t.calls.length, 1, 'a rejected answer is not retried');
}
{
  // Apps Script's redirect has no CORS headers: the answer is unreadable, so the send is repeated blind.
  const t = run({ kind: 'contact', fields: [['email', 'a@b.test']], fetchImpl: (_u, init, n) => (n === 1 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({})) });
  t.form.fire('submit');
  await flush();
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1].init.mode, 'no-cors');
  assert.equal(t.calls[1].body.submission_id, t.calls[0].body.submission_id, 'the resend carries the same id so the script can ignore it');
  assert.equal(t.success.style.display, 'block');
}
{
  const failing = run({ kind: 'contact', fields: [['email', 'a@b.test']], fetchImpl: () => Promise.reject(new TypeError('offline')) });
  failing.form.fire('submit');
  await flush();
  assert.equal(failing.failure.style.display, 'block', 'when both attempts fail the visitor sees the error');
  assert.equal(failing.button.disabled, false);
}
{
  const t = run({ kind: 'contact', fields: [], fetchImpl: ok });
  t.form.valid = false;
  t.form.fire('submit');
  await flush();
  assert.equal(t.calls.length, 0, 'invalid forms are not sent');
  assert.equal(t.form.reported, true);
}
{
  const msg = element(); const type = element(); const first = element({ focus() { first.focused = true; } });
  const t = run({
    kind: 'contact', search: '?request=BRD%20template&from=resources', fetchImpl: ok,
    extra: { q: { '#ty': [type], '#msg': [msg], '#fn': [first] } },
  });
  assert.equal(type.value, 'resource');
  assert.equal(msg.value, 'Hi Ubon, I\'d like to request "BRD template" (from the resources). ');
  assert.equal(first.focused, true);
  assert.ok(t);
}

/* ── Waitlist ────────────────────────────────────────────── */
{
  const t = run({
    kind: 'waitlist', dataset: { storagePrefix: 'uu-cohort-selar' },
    fields: [['form_name', 'ba-waitlist-feb-2027'], ['type', 'BA Bridge February 2027 waitlist'], ['cohort', 'February 2027'], ['_gotcha', ''], ['name', 'Ada'], ['email', 'ada@example.test'], ['consent', 'Yes']],
    fetchImpl: ok,
  });
  t.form.fire('submit');
  await flush();
  assert.deepEqual(Object.keys(t.calls[0].body).sort(), ['_gotcha', 'cohort', 'consent', 'email', 'form_name', 'name', 'submission_id', 'type']);
  assert.equal(t.calls[0].body.form_name, 'ba-waitlist-feb-2027');
  assert.equal(t.success.style.display, 'block');
  assert.deepEqual(t.tracked, [], 'a waitlist signup is not counted as an enquiry');
}

// Earlier buyers: a Selar return is shown only when this browser holds the matching saved enrolment.
const earlierBuyer = { product: 'ba-bridge-selar', reference: 'BAB-OLD-123', name: 'Ada Example', email: 'ada@example.test' };
const earlier = (search, storage) => run({ kind: 'waitlist', dataset: { storagePrefix: 'uu-cohort-selar' }, search, storage, fetchImpl: ok });
{
  const unmatched = earlier('?payment=selar');
  assert.equal(unmatched.byId['form-done'].hidden, true, 'a query parameter alone cannot show the earlier payment card');
  assert.deepEqual(unmatched.replaced, ['/page/']);
  assert.match(unmatched.byId['payment-status'].textContent, /contact us with your payment receipt/);
  const matched = earlier('?payment=selar', { 'uu-cohort-selar-pending': JSON.stringify(earlierBuyer) });
  assert.equal(matched.byId['form-done'].hidden, false);
  assert.equal(matched.form.hidden, true);
  assert.equal(matched.byId['done-ref'].textContent, 'BAB-OLD-123');
  assert.ok(matched.store.has('uu-cohort-selar-returned'));
  assert.deepEqual(matched.tracked, ['cohort-selar-returned']);
  const refreshed = earlier('', { 'uu-cohort-selar-returned': JSON.stringify(earlierBuyer) });
  assert.equal(refreshed.byId['form-done'].hidden, false);
  const other = earlier('?payment=selar', { 'uu-cohort-selar-pending': JSON.stringify({ ...earlierBuyer, product: 'another-product' }) });
  assert.equal(other.byId['form-done'].hidden, true);
  const waiting = earlier('', { 'uu-cohort-selar-pending': JSON.stringify(earlierBuyer) });
  assert.match(waiting.byId['payment-status'].textContent, /Registration is closed.*BAB-OLD-123/);
}
{
  // A closed Squad cohort: the redirect brings ?reference=BAB-...-N, and the endpoint is told so it can verify.
  const buyer = { product: 'ba-bridge-squad', cohort: 'February 2027', reference: 'BAB-SQ-ABC', name: 'Ada Example', email: 'ada@example.test' };
  const closed = (search, storage) => run({ kind: 'waitlist', dataset: { storagePrefix: 'uu-cohort-pay-february-2027' }, search, storage, fetchImpl: ok });
  const back = closed('?reference=BAB-SQ-ABC-2', { 'uu-cohort-pay-february-2027-pending': JSON.stringify(buyer) });
  assert.equal(back.byId['form-done'].hidden, false);
  assert.equal(back.byId['done-ref'].textContent, 'BAB-SQ-ABC');
  assert.deepEqual(back.replaced, ['/page/'], 'the reference parameter is removed from the address');
  assert.deepEqual(back.tracked, ['cohort-squad-paid']);
  assert.deepEqual(back.calls.map((c) => c.body), [{ action: 'payment', squad_ref: 'BAB-SQ-ABC-2' }]);
  // Someone else's reference does not show this browser's card, though it is still passed on for checking.
  const stranger = closed('?reference=BAB-OTHER-XYZ-1', { 'uu-cohort-pay-february-2027-pending': JSON.stringify(buyer) });
  assert.equal(stranger.byId['form-done'].hidden, true);
  assert.equal(stranger.calls.length, 1);
  // Not a reference at all: ignored.
  const junk = closed('?reference=hello');
  assert.equal(junk.byId['form-done'].hidden, true);
  assert.equal(junk.calls.length, 0);
}

/* ── BA Bridge enrolment (Squad) ─────────────────────────── */
const enrolDataset = {
  cohort: 'February 2027', amount: '90000', storagePrefix: 'uu-cohort-pay-february-2027',
};
const PENDING_KEY = 'uu-cohort-pay-february-2027-pending';
const RETURNED_KEY = 'uu-cohort-pay-february-2027-returned';
function enrolRun(overrides = {}) {
  const status = element(); const submit = element({ textContent: 'Continue to payment' }); const retry = element({ hidden: true });
  const required = [
    element({ value: 'Ada Example' }), element({ type: 'email', value: 'ada@example.test' }), element({ value: 'Lagos' }),
    element({ type: 'checkbox', checked: true }),
  ];
  const t = run({
    kind: 'enrol', dataset: enrolDataset, source: formsWithKey,
    fields: [['name', 'Ada Example'], ['email', 'ada@example.test'], ['whatsapp', '+2341'], ['background', 'Other'], ['background_other', 'Teacher'],
      ['wants', 'Practical skills'], ['wants', 'Mentorship'], ['availability', 'Weekday evenings'], ['source', 'LinkedIn'], ['_gotcha', ''], ['consent', 'Yes']],
    fetchImpl: ok,
    extra: {
      q: { '[required]': required, 'input[name=wants]:checked': [element()], 'input[name=availability]:checked': [element()] },
      ids: { 'form-status': status, 'submit-btn': submit, 'pay-retry': retry },
    },
    ...overrides,
  });
  return { ...t, status, submit, retry, required };
}
const bodies = (t) => t.calls.map((c) => c.body);
{
  const t = enrolRun();
  t.form.fire('submit');
  await flush();
  const body = t.calls[0].body;
  assert.equal(t.calls[0].url, ENDPOINT);
  assert.equal(body.action, 'signup');
  assert.match(body.reference, /^BAB-[A-Z0-9]+-[A-Z0-9]{3}$/);
  assert.equal(body.amount, '90000');
  assert.equal(body.cohort, 'February 2027');
  assert.equal(body.payment_status, 'Awaiting payment');
  assert.equal(body.wants, 'Practical skills, Mentorship', 'checkbox groups join into one answer');
  assert.equal(body.background, 'Other: Teacher', 'Other text folds into its answer');
  assert.equal('background_other' in body, false);
  const saved = JSON.parse(t.store.get(PENDING_KEY));
  assert.equal(saved.reference, body.reference);
  assert.equal(saved.product, 'ba-bridge-squad');
  assert.equal(saved.cohort, 'February 2027');
  assert.equal(t.assigned.length, 0, 'there is no redirect away from the site');

  // Squad checkout opens with the cohort price in kobo and a reference that names the attempt.
  assert.equal(t.widgets.length, 1);
  const widget = t.widgets[0];
  assert.equal(widget.isSetup && widget.isOpen, true);
  assert.equal(widget.options.key, SANDBOX_PUBLIC_KEY);
  assert.equal(widget.options.amount, 9000000);
  assert.equal(widget.options.currency_code, 'NGN');
  assert.equal(widget.options.transaction_ref, body.reference + '-1');
  assert.equal(widget.options.email, 'ada@example.test');
  assert.equal(widget.options.customer_name, 'Ada Example');
  assert.deepEqual({ ...widget.options.metadata }, { product: 'BA Bridge Cohort', reference: body.reference, cohort: 'February 2027', whatsapp: '+2341' });
  assert.deepEqual(t.tracked, ['cohort-enrolment-started', 'cohort-squad-checkout-opened']);
  assert.equal(t.submit.hidden, true);

  // Paying: the card appears, the endpoint is told to verify, and closing the window afterwards changes nothing.
  widget.options.onSuccess({});
  widget.options.onClose();
  await flush();
  assert.equal(t.byId['form-done'].hidden, false);
  assert.equal(t.byId['done-ref'].textContent, body.reference);
  assert.equal(t.form.hidden, true);
  assert.equal(t.retry.hidden, true, 'a closed window after paying does not offer to pay again');
  assert.ok(t.store.has(RETURNED_KEY));
  assert.deepEqual(bodies(t)[1], { action: 'payment', squad_ref: body.reference + '-1' });
  assert.deepEqual(t.tracked.slice(2), ['cohort-squad-paid']);
}
{
  // Closing checkout without paying offers a retry, and each attempt gets a fresh Squad reference.
  const t = enrolRun();
  t.form.fire('submit');
  await flush();
  const reference = t.calls[0].body.reference;
  t.widgets[0].options.onClose();
  assert.equal(t.retry.hidden, false);
  assert.match(t.status.textContent, /Payment wasn't completed/);
  assert.equal(t.byId['form-done'].hidden, true);
  t.retry.fire('click');
  await flush();
  assert.equal(t.widgets.length, 2);
  assert.equal(t.widgets[1].options.transaction_ref, reference + '-2');
  assert.equal(JSON.parse(t.store.get(PENDING_KEY)).attempt, 2, 'the attempt number survives a refresh');
  assert.equal(t.calls.length, 1, 'nothing is verified until a payment is reported');
}
{
  // Without a public key the application is still saved, and the visitor is told why they cannot pay.
  const t = enrolRun({ source: forms.replace(/const SQUAD_PUBLIC_KEY = '[^']*';/, "const SQUAD_PUBLIC_KEY = '';") });
  t.form.fire('submit');
  await flush();
  assert.equal(t.calls[0].body.action, 'signup');
  assert.equal(t.widgets.length, 0);
  assert.match(t.status.textContent, /Online payment is not switched on yet/);
  assert.equal(t.retry.hidden, false);
}
{
  const t = enrolRun({ fetchImpl: rejected });
  t.form.fire('submit');
  await flush();
  assert.equal(t.widgets.length, 0, 'checkout never opens when the application was not saved');
  assert.equal(t.store.size, 0);
  assert.equal(t.submit.disabled, false);
  assert.match(t.status.textContent, /did not go through/);
}
{
  const t = enrolRun();
  t.required[1].value = 'nope';
  t.form.fire('submit');
  await flush();
  assert.equal(t.calls.length, 0);
  assert.match(t.status.textContent, /email address does not look right/);
  const consent = enrolRun();
  consent.required[3].checked = false;
  consent.form.fire('submit');
  assert.equal(consent.calls.length, 0);
  assert.match(consent.status.textContent, /consent box/);
}
{
  const buyer = { product: 'ba-bridge-squad', reference: 'BAB-NEW-123', name: 'Ada Example', email: 'ada@example.test', cohort: 'February 2027' };
  // Squad's redirect URL brings the buyer back with ?reference=BAB-...-N.
  const back = enrolRun({ search: '?reference=BAB-NEW-123-1', storage: { [PENDING_KEY]: JSON.stringify(buyer) } });
  assert.equal(back.byId['form-done'].hidden, false);
  assert.equal(back.byId['done-ref'].textContent, 'BAB-NEW-123');
  assert.ok(back.store.has(RETURNED_KEY));
  assert.deepEqual(back.replaced, ['/page/']);
  assert.deepEqual(back.tracked, ['cohort-squad-paid']);
  assert.deepEqual(bodies(back), [{ action: 'payment', squad_ref: 'BAB-NEW-123-1' }]);
  // A reference that is not this browser's enrolment shows no card, but is still passed on for checking.
  const other = enrolRun({ search: '?reference=BAB-ELSE-999-1', storage: { [PENDING_KEY]: JSON.stringify(buyer) } });
  assert.equal(other.byId['form-done'].hidden, true);
  assert.equal(other.calls.length, 1);
  assert.match(other.status.textContent, /Squad confirms it to us automatically/);
  // The earlier provider's query parameter no longer does anything on a new enrolment.
  const selar = enrolRun({ search: '?payment=selar', storage: { [PENDING_KEY]: JSON.stringify(buyer) } });
  assert.equal(selar.byId['form-done'].hidden, true);
  assert.equal(selar.calls.length, 0);
  // A saved enrolment from another cohort is not accepted.
  const wrongCohort = enrolRun({ search: '?reference=BAB-NEW-123-1', storage: { [PENDING_KEY]: JSON.stringify({ ...buyer, cohort: 'November 2026' }) } });
  assert.equal(wrongCohort.byId['form-done'].hidden, true);
  // Refresh after paying, and a saved but unpaid enrolment.
  const refreshed = enrolRun({ storage: { [RETURNED_KEY]: JSON.stringify(buyer) } });
  assert.equal(refreshed.byId['form-done'].hidden, false);
  const saved = enrolRun({ storage: { [PENDING_KEY]: JSON.stringify(buyer) } });
  assert.equal(saved.retry.hidden, false, 'a saved but unpaid enrolment offers the payment button');
  assert.equal(saved.submit.hidden, true);
  saved.retry.fire('click');
  await flush();
  assert.equal(saved.widgets.length, 1);
  assert.equal(saved.widgets[0].options.transaction_ref, 'BAB-NEW-123-1');
}

console.log('Form script checks passed (contact, waitlist, Squad enrolment and returns).');
