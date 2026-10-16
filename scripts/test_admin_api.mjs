import assert from 'node:assert/strict';
import { makeHarness, makeSheet } from './gas_harness.mjs';

const SANDBOX_KEY = 'sandbox_sk_testkey123';
const DAY = 24 * 60 * 60 * 1000;
const squadOk = (extra = {}) => ({ code: 200, body: { data: { transaction_status: 'Success', transaction_amount: 8000000, transaction_currency_id: 'NGN', ...extra } } });
const enrol = (reference, extra = {}) => ({
  action: 'signup', reference, name: 'Ada Example', email: 'ada@example.test', whatsapp: '+234 800 000 0001',
  location: 'Lagos', background: 'Finance', experience: '3', stage: 'Exploring', wants: 'Portfolio', availability: 'Weekday evenings',
  source: 'LinkedIn', consent: 'Yes', ...extra,
});
const webhook = (ref) => ({ Event: 'charge_successful', TransactionRef: ref, Body: { transaction_ref: ref } });
const postJson = (h, payload) => h.context.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(payload) } });

// A workbook with enrolments in every state. Cells are set by their sheet heading.
function seeded(options = {}) {
  const answers = {};
  const h = makeHarness({ squad: { key: SANDBOX_KEY, respond: (url) => answers[url.split('/verify/')[1]] || { code: 400, body: { data: null } } }, ...options });
  h.answers = answers;
  h.raw = (method, params) => h.context.adminApi(method, params);
  // h.api (from the harness) is what the page receives: plain data only, as JSON.
  h.data = (method, params) => {
    const out = h.api(method, params);
    assert.equal(out.ok, true, `${method}: ${out.error}`);
    return out.data;
  };
  h.col = (label) => h.enrolmentSheet.rows[0].indexOf(label);
  h.cell = (reference, label, value) => {
    const row = h.enrolmentSheet.rows.find((r) => r[1] === reference);
    if (value !== undefined) row[h.col(label)] = value;
    return row[h.col(label)];
  };
  return h;
}

/* ── Access: only the signed-in owner ── */
{
  const owner = seeded();
  owner.post(enrol('BAB-AD1-AAA'));
  assert.equal(owner.api('overview').ok, true);
  assert.equal(owner.api('overview').user, 'owner@example.test');
  assert.equal(owner.api('nope').ok, false);
  assert.match(owner.api('nope').error, /Unknown request/);

  // Anonymous visitors on the public deployment: no address at all.
  const anon = seeded({ user: { active: '' } });
  anon.post(enrol('BAB-AD2-AAA'));
  for (const method of ['overview', 'enrolments', 'enrolment', 'sendReview', 'confirmPayment', 'resendWelcome', 'saveNote']) {
    const out = anon.api(method, { reference: 'BAB-AD2-AAA' });
    assert.equal(out.ok, false, method);
    assert.match(out.error, /Only the site owner/, method);
    assert.equal(out.data, undefined);
  }
  assert.equal(anon.enrolmentSheet.rows[1][anon.col('Payment status')], 'Awaiting payment', 'a refused call changes nothing');
  assert.equal(JSON.parse(anon.context.doGet({ parameter: {} }).text).message, 'BA Bridge endpoint is online.', 'the public root still answers as before');
  assert.match(anon.context.doGet({ parameter: { action: 'app' } }).html, /Not authorised/);
  assert.match(anon.context.doGet({ parameter: { action: 'app' } }).html, /did not tell the script which account/, 'a missing address is explained');
  const wrongAccount = seeded({ user: { active: 'Stranger@Example.test' } }).context.doGet({ parameter: { action: 'app' } }).html;
  assert.match(wrongAccount, /signed in as <strong>stranger@example\.test<\/strong>/, 'a visitor is told which account they used');
  assert.doesNotMatch(wrongAccount, /owner@example\.test/, 'and never who the owner is');
  const scripted = seeded({ user: { active: '<script>alert(1)</script>' } }).context.doGet({ parameter: { action: 'app' } }).html;
  assert.doesNotMatch(scripted, /<script>alert/, 'an address is shown as text, never as markup');

  // If Google shows the script no address at all (for either side), an empty value must never count as a match.
  const blind = seeded({ user: { active: '', effective: '' } });
  assert.equal(blind.api('overview').ok, false);
  assert.match(blind.context.doGet({ parameter: { action: 'app' } }).html, /Not authorised/);

  // Another Google account is refused unless the owner lists it.
  const visitor = seeded({ user: { active: 'Visitor@Example.test' } });
  assert.equal(visitor.api('overview').ok, false);
  visitor.properties.BA_BRIDGE_ADMIN_EMAILS = 'someone@example.test, visitor@example.TEST';
  assert.equal(visitor.api('overview').ok, true);
  assert.equal(visitor.api('overview').user, 'visitor@example.test');

  // The owner gets the dashboard page, at the root of the deployment and at ?action=app.
  const page = owner.context.doGet({ parameter: {} });
  assert.equal(page.file, 'admin');
  assert.equal(page.title, 'BA Bridge Admin');
  assert.match(page.meta.viewport, /width=device-width/);
  assert.equal(owner.context.doGet({ parameter: { action: 'app' } }).file, 'admin');

  // If the HTML file was never added to the project, the owner is told what to do instead of seeing a bare Google error.
  const missingFile = seeded();
  missingFile.context.HtmlService.createHtmlOutputFromFile = () => { throw new Error('No HTML file named admin was found.'); };
  assert.match(missingFile.context.doGet({ parameter: { action: 'app' } }).html, /no HTML file named <strong>admin<\/strong>/);
  assert.match(missingFile.context.doGet({ parameter: {} }).html, /Dashboard page missing/, 'the same on the deployment root');

  // Functions that return secrets or email every student cannot be run by a stranger, from a page or anywhere else.
  for (const fn of ['setupIntegrationSecrets', 'getIntegrationUrls', 'previewPaidCohortWelcomeReminder', 'sendPaidCohortWelcomeReminder', 'resetPaidCohortWelcomeReminderLog']) {
    assert.throws(() => anon.context[fn](), /Only the site owner/, fn);
    assert.throws(() => visitor.context[fn] && seeded({ user: { active: 'x@example.test' } }).context[fn](), /Only the site owner/, fn);
  }
  assert.doesNotThrow(() => owner.context.setupIntegrationSecrets());
  assert.match(owner.context.getIntegrationUrls(), /ADMIN PANEL URL/);
}

/* ── Overview ── */
{
  const h = seeded();
  const now = Date.now();
  // five enrolments: awaiting (new), awaiting (stale), paid + waiting for the owner, wrong amount, confirmed
  ['BAB-OV1-AAA', 'BAB-OV2-AAA', 'BAB-OV3-AAA', 'BAB-OV4-AAA', 'BAB-OV5-AAA'].forEach((r, i) => h.post(enrol(r, { name: 'Person ' + (i + 1), email: `p${i + 1}@example.test` })));
  h.cell('BAB-OV2-AAA', 'Timestamp', new Date(now - 5 * DAY));
  h.answers['BAB-OV3-AAA-1'] = squadOk();
  postJson(h, webhook('BAB-OV3-AAA-1'));
  h.answers['BAB-OV4-AAA-1'] = squadOk({ transaction_amount: 100000 });
  postJson(h, webhook('BAB-OV4-AAA-1'));
  h.answers['BAB-OV5-AAA-1'] = squadOk();
  postJson(h, webhook('BAB-OV5-AAA-1'));
  h.context.doPost({ parameter: { action: 'confirm', intent: 'confirm', reference: 'BAB-OV5-AAA', token: h.cell('BAB-OV5-AAA', 'Confirmation token'), amount_paid: '80000' } });
  // a confirmed enrolment whose welcome email failed
  h.cell('BAB-OV5-AAA', 'Welcome email sent at', '');
  h.cell('BAB-OV5-AAA', 'Welcome email error', 'Invalid student email address.');

  const o = h.data('overview');
  assert.deepEqual(o.counts, { all: 5, awaiting: 2, review: 2, confirmed: 1 });
  assert.equal(o.revenue.confirmed, 80000);
  assert.equal(o.revenue.awaitingConfirmation, 80000 + 1000);
  assert.equal(o.expectedAmount, 80000);
  const kinds = o.attention.map((a) => `${a.severity}:${a.type}:${a.reference}`);
  assert.deepEqual(kinds, [
    'high:amount:BAB-OV4-AAA', 'high:welcome:BAB-OV5-AAA', 'medium:confirm:BAB-OV3-AAA', 'low:stale:BAB-OV2-AAA',
  ], 'worst first; each issue is named with its enrolment');
  assert.match(o.attention[0].detail, /NGN 1000, not the expected NGN 80000/);
  assert.match(o.attention[3].title, /Awaiting payment for 5 days/);
  assert.equal(o.attentionTotal, 4);
  assert.ok(o.activity.length >= 5 && o.activity.length <= 10);
  assert.ok(o.activity.every((e, i, all) => i === 0 || all[i - 1].at >= e.at), 'newest activity first');
  assert.ok(o.activity.some((e) => e.type === 'paid') && o.activity.some((e) => e.type === 'confirmed') && o.activity.some((e) => e.type === 'enrolled'));
  assert.equal(o.health.squad, 'sandbox');
  assert.equal(o.health.sweepInstalled, false);
  assert.equal(o.health.emailQuota, 100);
  assert.equal(o.health.whatsappGroupSet, true);
  assert.equal(o.health.lastWebhook.event, 'charge_successful', 'the last webhook Squad sent is remembered');
  assert.equal(o.health.lastWebhook.result, 'ok');
  h.context.installSquadSweepTrigger();
  assert.equal(h.data('overview').health.sweepInstalled, true);

  // Nothing in a response may be a Date, and no confirmation token may ever reach the page.
  const walk = (value) => { if (value instanceof Date) throw new Error('Date in response'); if (value && typeof value === 'object') Object.values(value).forEach(walk); };
  walk(h.raw('overview'));
  const token = h.cell('BAB-OV3-AAA', 'Confirmation token');
  assert.ok(token);
  assert.equal(JSON.stringify(o).includes(token), false);
}

/* ── Older cohorts do not raise alarms ── */
{
  const h = seeded();
  h.post(enrol('BAB-OLD-AAA'));
  h.post(enrol('BAB-OLD-BBB'));
  // confirmed long ago, before welcome emails were tracked
  h.cell('BAB-OLD-AAA', 'Payment status', 'Paid — manually confirmed');
  h.cell('BAB-OLD-AAA', 'Verified by you', 'Yes');
  h.cell('BAB-OLD-AAA', 'Confirmed at', '2026-07-01 10:00:00');
  h.cell('BAB-OLD-AAA', 'Amount paid (NGN)', 80000);
  // unpaid for 40 days: abandoned, not "stale"
  h.cell('BAB-OLD-BBB', 'Timestamp', new Date(Date.now() - 40 * DAY));
  const o = h.data('overview');
  assert.deepEqual(o.attention, [], 'nothing to chase');
  assert.equal(o.counts.confirmed, 1);
  assert.equal(o.revenue.confirmed, 80000);
  // an unconfirmed earlier-provider payment is still waiting for the owner
  h.post(enrol('BAB-OLD-CCC'));
  h.cell('BAB-OLD-CCC', 'Payment status', 'Paid — Selar detected');
  assert.equal(h.data('overview').attention[0].type, 'confirm');
}

/* ── Other tabs feed the overview without being created ── */
{
  const h = seeded();
  assert.equal(h.named.Waitlist, undefined);
  let o = h.data('overview');
  assert.deepEqual([o.waitlist.total, o.enquiries.total, o.sessions.total], [0, 0, 0]);
  assert.equal(h.named.Waitlist, undefined, 'reading the overview does not create tabs');
  const wl = (email, cohort) => h.post({ form_name: 'ba-waitlist-x', name: 'N', email, cohort, consent: 'Yes' });
  wl('a@example.test', 'February 2027'); wl('b@example.test', 'February 2027'); wl('c@example.test', 'May 2027');
  h.post({ form_name: 'contact', first_name: 'A', last_name: 'B', email: 'a@example.test', message: 'Hi', submission_id: 's1' });
  h.answers['UU1-SESS0001'] = squadOk({ transaction_amount: 1500000 });
  h.answers['UU1-SESS0002'] = squadOk({ transaction_amount: 100 });
  postJson(h, webhook('UU1-SESS0001')); postJson(h, webhook('UU1-SESS0002'));
  o = h.data('overview');
  assert.deepEqual(o.waitlist, { total: 3, byCohort: { 'February 2027': 2, 'May 2027': 1 } });
  assert.equal(o.enquiries.total, 1);
  assert.deepEqual(o.sessions, { total: 2, paid: 1, review: 1, revenue: 15000 });
  assert.ok(o.attention.some((a) => a.type === 'session'));
}

/* ── Enrolment list: order, paging, search, status filter ── */
{
  const h = seeded();
  for (let i = 1; i <= 30; i++) h.post(enrol(`BAB-LS${String(i).padStart(2, '0')}-AAA`, { name: i === 7 ? 'Ngozi Okeke' : `Student ${i}`, email: i === 7 ? 'ngozi@example.test' : `s${i}@example.test`, whatsapp: i === 7 ? '+234 803 555 0107' : `+234 800 000 ${String(1000 + i)}` }));
  h.answers['BAB-LS07-AAA-1'] = squadOk(); postJson(h, webhook('BAB-LS07-AAA-1'));
  const first = h.data('enrolments', {});
  assert.equal(first.items.length, 25);
  assert.equal(first.total, 30);
  assert.equal(first.pages, 2);
  assert.equal(first.items[0].reference, 'BAB-LS30-AAA', 'newest first');
  assert.deepEqual(first.counts, { all: 30, awaiting: 29, review: 1, confirmed: 0 });
  const second = h.data('enrolments', { page: 2 });
  assert.equal(second.items.length, 5);
  assert.equal(second.items.at(-1).reference, 'BAB-LS01-AAA');
  assert.equal(h.data('enrolments', { page: 99 }).page, 2, 'an out-of-range page is clamped');
  assert.equal(h.data('enrolments', { page: -3 }).page, 1);
  // search: name, email, reference and phone digits; short digit strings are not treated as phone searches
  assert.deepEqual(h.data('enrolments', { q: 'ngozi' }).items.map((i) => i.reference), ['BAB-LS07-AAA']);
  assert.deepEqual(h.data('enrolments', { q: 'OKEKE' }).items.map((i) => i.reference), ['BAB-LS07-AAA']);
  assert.deepEqual(h.data('enrolments', { q: 'bab-ls07' }).items.map((i) => i.reference), ['BAB-LS07-AAA']);
  assert.deepEqual(h.data('enrolments', { q: '0355' }).items.map((i) => i.reference), ['BAB-LS07-AAA']);
  assert.deepEqual(h.data('enrolments', { q: '+234 803 555' }).items.map((i) => i.reference), ['BAB-LS07-AAA']);
  assert.equal(h.data('enrolments', { q: '80' }).total, 0, 'two digits match nothing');
  // status filter, with chip counts that follow the search
  const review = h.data('enrolments', { status: 'review' });
  assert.deepEqual(review.items.map((i) => i.reference), ['BAB-LS07-AAA']);
  assert.equal(review.items[0].status, 'review');
  assert.equal(review.items[0].amountPaid, 80000);
  assert.equal(review.counts.all, 30, 'the chips show the whole search, not just the chosen status');
  assert.equal(h.data('enrolments', { status: 'bogus' }).total, 30, 'an unknown status is ignored');
  assert.deepEqual(h.data('enrolments', { q: 'ngozi', status: 'awaiting' }).items, []);
  const ngozi = h.data('enrolments', { q: 'ngozi' });
  assert.deepEqual(ngozi.counts, { all: 1, awaiting: 0, review: 1, confirmed: 0 });
  // summaries carry no sensitive internals
  assert.deepEqual(Object.keys(first.items[0]).sort(), ['amountPaid', 'createdAt', 'createdMs', 'email', 'hasError', 'name', 'paidAt', 'paymentStatus', 'reference', 'squadStatus', 'status', 'welcomeSent', 'whatsapp']);
}

/* ── One enrolment ── */
{
  const h = seeded();
  h.post(enrol('BAB-DT1-AAA', { blocker: '<img src=x onerror=alert(1)>' }));
  const d = h.data('enrolment', { reference: 'BAB-DT1-AAA' });
  assert.equal(d.status, 'awaiting');
  assert.equal(d.canConfirm, true);
  assert.equal(d.canResend, false);
  assert.equal(d.expectedAmount, 80000);
  assert.equal(d.defaultAmount, '80000');
  assert.equal(d.reviewTo, 'ubonanalyst@gmail.com');
  const titles = d.sections.map((s) => s.title);
  assert.deepEqual(titles, ['Contact', 'About them', 'Payment', 'Emails', 'Enrolment']);
  const items = Object.fromEntries(d.sections.flatMap((s) => s.items.map((i) => [i.label, i])));
  assert.deepEqual(items.Email, { label: 'Email', value: 'ada@example.test', kind: 'email' });
  assert.equal(items.WhatsApp.kind, 'phone');
  assert.equal(items.WhatsApp.value, '+234 800 000 0001', "the ' that guards a number starting with + is not shown");
  assert.equal(d.summary.whatsapp, '+234 800 000 0001');
  assert.equal(items.Reference.kind, 'mono');
  assert.equal(items['Squad reference'].value, '', 'known payment fields are listed even when empty');
  assert.equal(items['Biggest blocker'].value, '<img src=x onerror=alert(1)>', 'values are passed through untouched; the page renders them as text');
  assert.equal(items['Preferred format'], undefined, 'unknown optional answers are left out');
  assert.equal(JSON.stringify(d).includes(h.cell('BAB-DT1-AAA', 'Confirmation token')), false);
  assert.equal(h.api('enrolment', { reference: 'BAB-NOPE-AAA' }).ok, false);
  assert.match(h.api('enrolment', { reference: 'BAB-NOPE-AAA' }).error, /not found/);
  assert.equal(h.api('enrolment', {}).ok, false);
}

/* ── Actions ── */
{
  const h = seeded();
  h.post(enrol('BAB-AC1-AAA'));
  const locksBefore = h.locks.count;
  h.data('overview'); h.data('enrolments', {}); h.data('enrolment', { reference: 'BAB-AC1-AAA' });
  assert.equal(h.locks.count, locksBefore, 'reads take no lock');

  // review email
  const sent = h.data('sendReview', { reference: 'BAB-AC1-AAA' });
  assert.deepEqual(sent, { sent: true, error: '', to: 'ubonanalyst@gmail.com' });
  assert.equal(h.locks.count, locksBefore + 1, 'writes are serialised');
  const review = h.emails.find((m) => /Review payment/.test(m.subject));
  assert.equal(review.to, 'ubonanalyst@gmail.com');
  assert.match(review.body, /Review requested from the dashboard/);
  assert.match(review.body, /action=review&reference=BAB-AC1-AAA&token=/);
  assert.equal(h.api('sendReview', { reference: 'BAB-NOPE-AAA' }).ok, false);

  // confirm: bad amount, then good
  assert.match(h.api('confirmPayment', { reference: 'BAB-AC1-AAA', amountPaid: '80,000' }).error, /as a number/);
  assert.equal(h.cell('BAB-AC1-AAA', 'Verified by you'), 'No');
  const confirmed = h.data('confirmPayment', { reference: 'BAB-AC1-AAA', amountPaid: '80000' });
  assert.deepEqual(confirmed, { welcome: 'sent', error: '', to: 'ada@example.test', cc: 'alabioluwafunmito@gmail.com,ubonudonkang@gmail.com' });
  assert.equal(h.cell('BAB-AC1-AAA', 'Payment status'), 'Paid — manually confirmed');
  assert.equal(h.cell('BAB-AC1-AAA', 'Verified by you'), 'Yes');
  assert.equal(h.cell('BAB-AC1-AAA', 'Confirmed by'), 'owner@example.test', 'the dashboard records who confirmed');
  assert.equal(h.cell('BAB-AC1-AAA', 'Amount paid (NGN)'), 80000);
  const welcome = h.emails.filter((m) => m.to === 'ada@example.test');
  assert.equal(welcome.length, 1);
  assert.equal(welcome[0].cc, 'alabioluwafunmito@gmail.com,ubonudonkang@gmail.com');
  assert.match(welcome[0].body, /chat\.whatsapp\.com\/TestGroup123/);
  assert.match(h.api('confirmPayment', { reference: 'BAB-AC1-AAA' }).error, /already confirmed/);
  assert.equal(h.emails.filter((m) => m.to === 'ada@example.test').length, 1, 'a second confirm sends nothing');
  const after = h.data('enrolment', { reference: 'BAB-AC1-AAA' });
  assert.equal(after.status, 'confirmed');
  assert.equal(after.canConfirm, false);
  assert.equal(after.canResend, true);

  // resend: only after confirmation, and it really sends a second email
  assert.deepEqual(h.data('resendWelcome', { reference: 'BAB-AC1-AAA' }), { welcome: 'sent', error: '', to: 'ada@example.test', cc: 'alabioluwafunmito@gmail.com,ubonudonkang@gmail.com' });
  assert.equal(h.emails.filter((m) => m.to === 'ada@example.test').length, 2);
  h.post(enrol('BAB-AC2-AAA'));
  assert.match(h.api('resendWelcome', { reference: 'BAB-AC2-AAA' }).error, /Confirm the payment before sending/);

  // confirming with no amount keeps what is on record; a failed welcome email is reported, not hidden
  h.post(enrol('BAB-AC3-AAA', { email: 'bad-email' }));
  h.cell('BAB-AC3-AAA', 'Email', 'bad-email');
  const failed = h.data('confirmPayment', { reference: 'BAB-AC3-AAA' });
  assert.equal(failed.welcome, 'failed');
  assert.match(failed.error, /Invalid student email/);
  assert.equal(h.cell('BAB-AC3-AAA', 'Verified by you'), 'Yes', 'the payment stays confirmed');
  assert.equal(h.data('overview').attention.some((a) => a.type === 'welcome' && a.reference === 'BAB-AC3-AAA'), true);

  // notes
  assert.deepEqual(h.data('saveNote', { reference: 'BAB-AC2-AAA', note: '  Paid by transfer; call on Monday  ' }), { saved: true });
  assert.equal(h.data('enrolment', { reference: 'BAB-AC2-AAA' }).notes, 'Paid by transfer; call on Monday');
  h.data('saveNote', { reference: 'BAB-AC2-AAA', note: '=HYPERLINK("http://evil.example")' });
  assert.equal(h.cell('BAB-AC2-AAA', 'Admin notes'), "'=HYPERLINK(\"http://evil.example\")", 'a note cannot become a spreadsheet formula');
  assert.match(h.api('saveNote', { reference: 'BAB-AC2-AAA', note: 'x'.repeat(2001) }).error, /up to 2000 characters/);
  assert.equal(h.data('saveNote', { reference: 'BAB-AC2-AAA', note: '' }).saved, true);
  assert.equal(h.cell('BAB-AC2-AAA', 'Admin notes'), '');
}

/* ── An existing workbook gains the notes column without disturbing anything ── */
{
  const h = seeded();
  h.post(enrol('BAB-MG1-AAA'));
  assert.equal(h.enrolmentSheet.rows[0].at(-1), 'Admin notes');
  assert.equal(h.enrolmentSheet.rows[0].length, 40);
}
console.log('Admin dashboard API checks passed (access, overview, list, detail, actions).');
