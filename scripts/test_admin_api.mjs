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
  for (const method of ['overview', 'enrolments', 'enrolment', 'sendReview', 'confirmPayment', 'resendWelcome', 'saveNote', 'waitlist', 'enquiries', 'setEnquiryHandled', 'sessions', 'invites', 'createInvite', 'offlineForm', 'createOffline', 'enrolmentsExport', 'system', 'installSweep', 'runSweep', 'checkReference', 'recordPayment']) {
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
  assert.match(wrongAccount, /BA_BRIDGE_ADMIN_EMAILS/, 'and how the owner adds an account');
  assert.doesNotMatch(wrongAccount, /owner@example\.test/, 'and never who the owner is');
  const scripted = seeded({ user: { active: '<script>alert(1)</script>' } }).context.doGet({ parameter: { action: 'app' } }).html;
  assert.doesNotMatch(scripted, /<script>alert/, 'an address is shown as text, never as markup');

  // If Google shows the script no address at all (for either side), an empty value must never count as a match.
  const blind = seeded({ user: { active: '', effective: '' } });
  assert.equal(blind.api('overview').ok, false);
  assert.match(blind.context.doGet({ parameter: { action: 'app' } }).html, /Not authorised/);

  // The owner may open the dashboard with another of their own addresses than the one the script runs as
  // (the two already configured as NOTIFY_EMAIL and SITE_NOTIFY_EMAIL), but nobody else's.
  for (const mine of ['ubonudonkang@gmail.com', 'UbonAnalyst@gmail.com']) {
    const own = seeded({ user: { active: mine, effective: 'someone-else@example.test' } });
    assert.equal(own.api('overview').ok, true, mine);
    assert.equal(own.api('overview').user, mine.toLowerCase());
    assert.notEqual(own.context.doGet({ parameter: {} }).file, undefined, 'the root opens the dashboard for them');
  }
  const lookalike = seeded({ user: { active: 'ubonudonkang@gmail.com.evil.test', effective: 'someone-else@example.test' } });
  assert.equal(lookalike.api('overview').ok, false, 'a look-alike address is not the owner');
  const blank = seeded({ user: { active: '', effective: 'ubonudonkang@gmail.com' } });
  assert.equal(blank.api('overview').ok, false, 'an anonymous visitor never matches, even when the script runs as the owner');

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
  // Google Sheets turns a typed or imported "February 2027" into a date; the overview must still call it February 2027.
  const cohortColumn = h.named.Waitlist.rows[0].indexOf('cohort');
  h.named.Waitlist.rows[1][cohortColumn] = new Date('2027-01-31T23:00:00Z'); // 1 February 2027, midnight in Lagos
  h.named.Waitlist.rows[3][cohortColumn] = new Date('2027-04-30T23:00:00Z'); // 1 May 2027
  assert.deepEqual(h.data('overview').waitlist, { total: 3, byCohort: { 'February 2027': 2, 'May 2027': 1 } });
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

/* ── Waitlist: counts, newest first, and signups that repeat ── */
{
  const h = seeded();
  assert.deepEqual(h.data('waitlist'), { total: 0, duplicates: 0, cohorts: [], items: [] });
  assert.equal(h.named.Waitlist, undefined, 'reading the waitlist does not create the tab');
  const wl = (email, cohort, name = 'N') => h.post({ form_name: 'ba-waitlist-x', name, email, cohort, consent: 'Yes' });
  wl('a@example.test', 'February 2027', 'Ada'); wl('b@example.test', 'February 2027', 'Bola'); wl('c@example.test', 'May 2027', 'Chi');
  const tab = h.named.Waitlist;
  const heading = (label) => tab.rows[0].indexOf(label);
  // Sheets turns the cohort into a date; a repeat of Ada was saved earlier by an older script (the form now refuses it); one cell is "=1+1"-like text from a stranger
  tab.rows.slice(1).forEach((row) => { if (row[heading('cohort')] === 'February 2027') row[heading('cohort')] = new Date('2027-01-31T23:00:00Z'); });
  tab.rows.push([new Date(), 'ba-waitlist-x', 'Ada again', 'A@Example.test ', 'February 2027', 'Yes', 'x']);
  tab.rows.push([new Date(), 'ba-waitlist-x', "'=cmd", 'd@example.test', 'May 2027', 'Yes', 'x']);

  const w = h.data('waitlist');
  assert.equal(w.total, 5);
  assert.equal(w.duplicates, 1);
  assert.deepEqual(w.cohorts, [{ name: 'May 2027', count: 2 }, { name: 'February 2027', count: 3 }], 'cohorts are counted by their words, latest first');
  assert.equal(w.items[0].name, '=cmd', "the guard quote is not shown");
  assert.deepEqual(w.items.map((i) => i.email), ['d@example.test', 'a@example.test', 'c@example.test', 'b@example.test', 'a@example.test'], 'newest first, emails tidied');
  assert.deepEqual(w.items.map((i) => i.duplicate), [false, true, false, false, false], 'the later of two signups with the same email and cohort is the duplicate');
  assert.equal(w.items[1].cohort, 'February 2027');
  assert.ok(w.items.every((i) => i.row >= 2 && typeof i.joinedMs === 'number'));
}

/* ── Enquiries: list, handled marker, and refusing a stale row ── */
{
  const h = seeded();
  assert.deepEqual(h.data('enquiries'), { counts: { all: 0, open: 0, handled: 0 }, items: [] });
  assert.equal(h.named.Contact, undefined);
  const contact = (n, extra = {}) => h.post({ form_name: 'contact', first_name: 'First' + n, last_name: 'Last' + n, email: `q${n}@example.test`, company: 'Co', type: 'Mentoring', message: 'Hello ' + n, submission_id: 'sub' + n, ...extra });
  contact(1); contact(2); contact(3);
  let e = h.data('enquiries');
  assert.deepEqual(e.counts, { all: 3, open: 3, handled: 0 });
  assert.deepEqual(e.items.map((i) => i.name), ['First3 Last3', 'First2 Last2', 'First1 Last1'], 'newest first');
  assert.equal(e.items[0].message, 'Hello 3');
  assert.equal(h.data('overview').enquiries.open, 3);

  const target = e.items[1];
  assert.equal(h.named.Contact.rows[0].includes('Handled'), false, 'the column is added only when it is first needed');
  assert.deepEqual(h.data('setEnquiryHandled', { row: target.row, email: target.email, at: target.at, handled: true }), { handled: true });
  assert.equal(h.named.Contact.rows[0].at(-1), 'Handled');
  e = h.data('enquiries');
  assert.deepEqual(e.counts, { all: 3, open: 2, handled: 1 });
  assert.equal(e.items[1].handled, true);
  assert.equal(h.data('overview').enquiries.open, 2);
  contact(4);
  assert.equal(h.named.Contact.rows.at(-1).length, h.named.Contact.rows[0].length, 'a new enquiry still fits the sheet after the column was added');
  assert.equal(h.data('enquiries').counts.open, 3);
  assert.deepEqual(h.data('setEnquiryHandled', { row: target.row, email: target.email, at: target.at, handled: false }), { handled: false });
  assert.equal(h.data('enquiries').counts.handled, 0);

  // what the page was showing must still be what is on that row
  assert.match(h.api('setEnquiryHandled', { row: target.row, email: 'someone-else@example.test', at: target.at, handled: true }).error, /changed since this page loaded/);
  assert.match(h.api('setEnquiryHandled', { row: target.row, email: target.email, at: '1999-01-01 00:00', handled: true }).error, /changed since this page loaded/);
  for (const row of [0, 1, 99, 2.5, 'abc', undefined]) assert.match(h.api('setEnquiryHandled', { row, email: target.email, at: target.at, handled: true }).error, /not found/, String(row));
  assert.equal(h.data('enquiries').counts.handled, 0, 'refused calls change nothing');
}

/* ── 1:1 sessions ── */
{
  const h = seeded();
  assert.deepEqual(h.data('sessions').counts, { all: 0, paid: 0, review: 0 });
  assert.equal(h.named.Sessions, undefined);
  h.answers['UU1-SESS0001'] = squadOk({ transaction_amount: 1500000 });
  h.answers['UU1-SESS0002'] = squadOk({ transaction_amount: 100 });
  postJson(h, webhook('UU1-SESS0001')); postJson(h, webhook('UU1-SESS0002'));
  const s = h.data('sessions');
  assert.deepEqual(s.counts, { all: 2, paid: 1, review: 1 });
  assert.equal(s.revenue, 15000);
  assert.equal(s.expectedAmount, 15000);
  assert.deepEqual(s.items.map((i) => [i.reference, i.paid, i.amount]), [['UU1-SESS0002', false, 1], ['UU1-SESS0001', true, 15000]]);
  assert.match(s.items[0].status, /review/i);
}

/* ── Invites: create, reuse, list, used ── */
{
  const h = seeded();
  assert.deepEqual(h.data('invites'), { counts: { all: 0, unused: 0, used: 0 }, items: [] });
  assert.equal(h.named['BA Bridge Invites'], undefined, 'reading invites does not create the tab');

  const made = h.data('createInvite', { name: ' Ngozi Eze ', email: ' Ngozi@Example.TEST ' });
  assert.equal(made.existing, false);
  assert.equal(made.email, 'ngozi@example.test');
  assert.match(made.link, /^https:\/\/script\.google\.com\/macros\/s\/AKfycby94krvGfIS7mXVT-szoGHHM_pCLIU11Bh_AemMxE_nsK-X_Hm1y8yaK69zNKfU20LT\/exec\?action=invite&token=[A-Za-z0-9]+$/, 'the link points at the public address the website uses, not the dashboard');
  assert.equal(made.enrolled, null);
  assert.equal(h.data('createInvite', { name: 'Someone', email: 'ngozi@example.test' }).link, made.link, 'an unused invite for the same email is reused');
  assert.equal(h.data('createInvite', { name: 'x', email: 'ngozi@example.test' }).existing, true);
  assert.equal(h.named['BA Bridge Invites'].rows.length, 2, 'reusing does not add a row');
  assert.match(h.api('createInvite', { name: '', email: 'a@example.test' }).error, /required/);
  assert.match(h.api('createInvite', { name: 'A', email: 'not-an-email' }).error, /valid email/);
  assert.match(h.api('createInvite', { name: 'x'.repeat(201), email: 'a@example.test' }).error, /too long/);

  // someone who already has an enrolment is flagged (not blocked)
  h.post(enrol('BAB-IN1-AAA', { email: 'already@example.test' }));
  const warned = h.data('createInvite', { name: 'Already Enrolled', email: 'already@example.test' });
  assert.deepEqual(warned.enrolled, { reference: 'BAB-IN1-AAA', name: 'Ada Example' });
  h.data('createInvite', { name: '=cmd|calc', email: 'evil@example.test' });
  assert.equal(h.named['BA Bridge Invites'].rows.at(-1)[2], "'=cmd|calc", 'a name cannot become a spreadsheet formula');

  let list = h.data('invites');
  assert.deepEqual(list.counts, { all: 3, unused: 3, used: 0 });
  assert.deepEqual(list.items.map((i) => i.email), ['evil@example.test', 'already@example.test', 'ngozi@example.test'], 'newest first');
  assert.equal(list.items[0].name, '=cmd|calc');
  assert.equal(list.items[2].link, made.link);

  // the invitee uses the link through the real registration page flow
  const token = made.link.split('token=')[1];
  h.post({ action: 'invite_submit', token, name: 'Ngozi Eze', whatsapp: '+234 800 000 0002', location: 'Abuja', background: 'Student or recent graduate', experience: '0 to 1', stage: 'Just exploring whether BA is right for me', want_jobready: 'yes', avail_weekday: 'yes', source: 'LinkedIn', consent: 'yes' });
  list = h.data('invites');
  assert.deepEqual(list.counts, { all: 3, unused: 2, used: 1 });
  const used = list.items.find((i) => i.email === 'ngozi@example.test');
  assert.equal(used.status, 'Used');
  assert.equal(used.link, '', 'a used invite has no link to hand out');
  assert.match(used.reference, /^BAB-/);
  assert.equal(h.data('enrolment', { reference: used.reference }).summary.email, 'ngozi@example.test', 'the enrolment it made is one click away');
}

/* ── Adding an enrolment from the dashboard ── */
{
  const h = seeded();
  const form = h.data('offlineForm');
  assert.equal(form.expectedAmount, 80000);
  assert.equal(form.maxWants, 3);
  // the choices are the ones on the older registration form
  const legacy = h.context.registrationFieldsHtml_();
  const labels = [...form.options.background, ...form.options.experience, ...form.options.stage, ...form.options.source, ...form.options.wants.map((w) => w[1]), ...form.options.availability.map((a) => a[1])];
  for (const label of labels) assert.ok(legacy.includes(label), 'the older form offers: ' + label);
  for (const [key] of [...form.options.wants, ...form.options.availability]) assert.ok(legacy.includes(`name="${key}"`), 'the older form has the box: ' + key);

  const person = { name: 'Kemi Bello', email: ' Kemi@Example.TEST ', whatsapp: '+234 800 000 0003', location: 'Ibadan, Nigeria', background: 'Banking, finance, or insurance', experience: '5 to 9', stage: 'Decided on BA, need structured training', source: 'Referral from a friend or colleague', wants: ['want_portfolio', 'want_mentor'], availability: ['avail_sat_am'], consent: true };
  const made = h.data('createOffline', person);
  assert.equal(made.created, true);
  assert.match(made.reference, /^BAB-OFF[A-Z0-9]+-[A-Z0-9]{3}$/);
  assert.equal(made.email, 'kemi@example.test');
  assert.equal(h.cell(made.reference, 'Payment status'), 'Awaiting payment');
  assert.equal(h.cell(made.reference, 'Consent given'), 'Yes');
  assert.equal(h.cell(made.reference, 'What they want most'), 'A portfolio project to show employers, Mentorship from a practising BA');
  assert.equal(h.cell(made.reference, 'Availability'), 'Saturday mornings');
  const detail = h.data('enrolment', { reference: made.reference });
  assert.equal(detail.status, 'awaiting');
  assert.equal(detail.canConfirm, true, 'it can be confirmed once paid');

  // the same email again is not added twice
  const again = h.data('createOffline', { ...person, name: 'Kemi B' });
  assert.deepEqual(again, { created: false, reference: made.reference, name: 'Kemi Bello' });
  assert.equal(h.enrolmentSheet.rows.length, 2);

  // "Other" choices carry their own text
  const other = h.data('createOffline', { ...person, email: 'other@example.test', background: 'Other', background_other: 'Teacher', source: 'Other', source_other: 'A podcast', wants: ['want_jobready'], wantOther: true, want_other_text: 'Move abroad' });
  assert.equal(h.cell(other.reference, 'Background'), 'Other: Teacher');
  assert.equal(h.cell(other.reference, 'Heard about it via'), 'Other: A podcast');
  assert.match(h.cell(other.reference, 'What they want most'), /Move abroad/);

  // the same checks as the older page, said in the same words
  const refuse = (change, pattern) => {
    const out = h.api('createOffline', { ...person, email: 'x' + Math.random().toString(36).slice(2) + '@example.test', ...change });
    assert.equal(out.ok, false, JSON.stringify(change));
    assert.match(out.error, pattern, JSON.stringify(change));
  };
  refuse({ name: '' }, /complete all required/);
  refuse({ whatsapp: '' }, /complete all required/);
  refuse({ email: 'nope' }, /valid email/);
  refuse({ consent: false }, /Consent is required/);
  refuse({ wants: [] }, /between 1 and 3/);
  refuse({ wants: ['want_jobready', 'want_portfolio', 'want_mentor', 'want_networking'] }, /between 1 and 3/);
  refuse({ wants: ['not_a_real_box'] }, /between 1 and 3/);
  refuse({ availability: [] }, /at least one live-session/);
  refuse({ background: 'Other', background_other: '' }, /Enter the Other background/);
  refuse({ source: 'Other', source_other: '' }, /how they heard/);
  refuse({ name: 'x'.repeat(5001) }, /too long/);
  assert.equal(h.enrolmentSheet.rows.length, 3, 'refused requests add nothing');
  assert.equal(h.cell(made.reference, 'Full name'), 'Kemi Bello', 'the existing record is not overwritten');
}

/* ── Export: every match, not one page, and nothing private ── */
{
  const h = seeded();
  for (let i = 1; i <= 30; i++) h.post(enrol(`BAB-EX${String(i).padStart(2, '0')}-AAA`, { name: i === 7 ? '=SUM(A1)' : `Student ${i}`, email: i % 10 === 0 ? 'shared@example.test' : `ex${i}@example.test` }));
  h.answers['BAB-EX03-AAA-1'] = squadOk(); postJson(h, webhook('BAB-EX03-AAA-1'));
  h.cell('BAB-EX01-AAA', 'Admin notes', 'private note');
  const all = h.data('enrolmentsExport', {});
  assert.equal(all.rows.length, 30, 'all of them, not the 25 that fit a page');
  assert.deepEqual(all.headers.slice(0, 3), ['Reference', 'Name', 'Email']);
  const blob = JSON.stringify(all);
  assert.ok(!blob.includes('private note') && !blob.includes(h.cell('BAB-EX03-AAA', 'Confirmation token')), 'no notes, no tokens');
  assert.ok(!all.headers.some((x) => /token|note|error/i.test(x)), 'no internal columns');
  assert.equal(all.rows[0][0], 'BAB-EX30-AAA', 'newest first, like the list');
  assert.equal(all.rows.find((r) => r[0] === 'BAB-EX07-AAA')[1], "=SUM(A1)", 'the guard quote is not part of the name (the page makes it safe for a file)');
  assert.equal(all.rows.find((r) => r[0] === 'BAB-EX03-AAA')[all.headers.indexOf('Status')], 'Needs confirmation');
  assert.equal(all.rows.find((r) => r[0] === 'BAB-EX04-AAA')[all.headers.indexOf('Status')], 'Awaiting payment');
  assert.equal(all.emails.length, 28, 'each address once (three people share one)');
  assert.equal(new Set(all.emails).size, 28);
  assert.equal(h.data('enrolmentsExport', { status: 'review' }).rows.length, 1);
  assert.equal(h.data('enrolmentsExport', { q: 'student 1' }).rows.length, 11, 'the same search as the list: Student 1 and 10 to 19');
  assert.deepEqual(h.data('enrolmentsExport', { status: 'confirmed' }), { headers: all.headers, rows: [], emails: [] });
  assert.equal(h.data('enrolmentsExport').rows.length, 30, 'no parameters at all is fine');
}

/* ── System: the facts the owner needs, the automatic check, and a manual run ── */
{
  const h = seeded();
  h.properties.BA_BRIDGE_ADMIN_EMAILS = 'extra@example.test';
  h.post(enrol('BAB-SY1-AAA'));
  let sys = h.data('system');
  assert.equal(sys.squad.mode, 'sandbox');
  assert.equal(sys.squad.sweepInstalled, false);
  assert.equal(sys.squad.sweepEveryMinutes, 30);
  assert.equal(sys.squad.webhookUrl, 'https://script.google.com/macros/s/AKfycby94krvGfIS7mXVT-szoGHHM_pCLIU11Bh_AemMxE_nsK-X_Hm1y8yaK69zNKfU20LT/exec');
  assert.equal(sys.squad.redirectUrl, 'https://ubonudonkang.com/ba-training/');
  assert.equal(sys.squad.lastWebhook, null);
  assert.equal(sys.mail.quotaLeft, 100);
  assert.equal(sys.mail.reviewTo, 'ubonanalyst@gmail.com');
  assert.deepEqual(sys.mail.welcomeCc, ['alabioluwafunmito@gmail.com', 'ubonudonkang@gmail.com']);
  assert.equal(sys.whatsappGroupUrl, 'https://chat.whatsapp.com/TestGroup123');
  assert.deepEqual(sys.prices, { cohort: 80000, session: 15000 });
  assert.match(sys.sheet.url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk\/edit$/);
  assert.deepEqual(sys.sheet.tabs.map((t) => [t.name, t.rows]), [['BA Training (enrolments)', 1], ['Waitlist', null], ['Contact', null], ['Sessions', null], ['BA Bridge Invites', null]], 'tabs that do not exist yet say so, and are not created by looking');
  assert.equal(h.named.Waitlist, undefined);
  assert.deepEqual(sys.access.accounts, ['owner@example.test', 'ubonanalyst@gmail.com', 'ubonudonkang@gmail.com', 'extra@example.test']);
  assert.equal(sys.access.timeZone, 'Africa/Lagos');

  h.post({ form_name: 'contact', first_name: 'A', last_name: 'B', email: 'a@example.test', message: 'Hi', submission_id: 's1' });
  assert.equal(h.data('system').sheet.tabs.find((t) => t.name === 'Contact').rows, 1);

  // the automatic check: turned on from the dashboard, once
  assert.deepEqual(h.data('installSweep'), { installed: true });
  assert.equal(h.data('system').squad.sweepInstalled, true);
  assert.deepEqual(h.triggers.map((t) => [t.getHandlerFunction(), t.every]), [['sweepAwaitingSquadPayments', 30]]);
  h.data('installSweep');
  assert.equal(h.triggers.length, 1, 'turning it on twice does not stack triggers');

  // running it by hand: finds a payment whose webhook never arrived
  assert.deepEqual(h.data('runSweep'), { checked: 3, paid: 0, failed: 0 }, 'three attempt references are tried for each unpaid enrolment');
  h.answers['BAB-SY1-AAA-2'] = squadOk();
  const locksBefore = h.locks.count;
  assert.deepEqual(h.data('runSweep'), { checked: 2, paid: 1, failed: 0 });
  assert.equal(h.cell('BAB-SY1-AAA', 'Payment status'), 'Paid (Squad verified)');
  assert.equal(h.locks.count - locksBefore, 2, 'the sweep takes its own lock per payment; the call is not wrapped in a second one (the lock cannot be taken twice)');
  const empty = h.locks.count;
  h.data('runSweep');
  assert.equal(h.locks.count, empty, 'nothing to check means no lock at all');

  // no key and webhook knowledge
  delete h.properties.SQUAD_SECRET_KEY;
  assert.equal(h.data('system').squad.mode, 'missing');
  postJson(h, webhook('BAB-SY1-AAA-1'));
  assert.equal(h.data('system').squad.lastWebhook.event, 'charge_successful');
}

/* ── Looking up a payment, and recording it by hand ── */
{
  const h = seeded();
  h.post(enrol('BAB-LK1-AAA', { name: 'Lookup Person' }));
  h.post(enrol('BAB-LK2-AAA', { name: 'Wrong Amount', email: 'wa@example.test' }));
  const mailsBefore = h.emails.length;
  const row = () => h.enrolmentSheet.rows.map((r) => r.slice());

  assert.match(h.api('checkReference', { reference: 'nonsense' }).error, /does not look like a BA Bridge payment reference/);
  assert.match(h.api('checkReference', { reference: '' }).error, /does not look like/);
  assert.match(h.api('checkReference', { reference: 'BAB-LK1-AAA' }).error, /does not look like/, 'a reference without its attempt number is not a payment reference');

  // not paid yet: Squad has nothing
  let c = h.data('checkReference', { reference: 'BAB-LK1-AAA-1' });
  assert.deepEqual([c.found, c.canRecord, c.kind, c.mode], [false, false, 'enrolment', 'sandbox']);
  assert.match(c.reason, /Squad has no payment with this reference/);
  assert.equal(c.record.exists, true);
  assert.equal(c.record.name, 'Lookup Person');

  // still pending
  h.answers['BAB-LK1-AAA-1'] = squadOk({ transaction_status: 'Pending' });
  c = h.data('checkReference', { reference: ' BAB-LK1-AAA-1 ' });
  assert.deepEqual([c.found, c.status, c.canRecord], [true, 'Pending', false]);
  assert.match(c.reason, /Pending/);

  // paid, not yet recorded: looking changes nothing
  h.answers['BAB-LK1-AAA-1'] = squadOk({ customer_name: 'Lookup Person', email: 'ada@example.test' });
  const snapshot = JSON.stringify(row());
  c = h.data('checkReference', { reference: 'BAB-LK1-AAA-1' });
  assert.deepEqual([c.found, c.status, c.amount, c.currency, c.expected, c.amountMatches, c.canRecord, c.reason], [true, 'Success', 80000, 'NGN', 80000, true, true, '']);
  assert.equal(c.record.alreadyRecorded, false);
  assert.equal(JSON.stringify(row()), snapshot, 'checking changes nothing');
  assert.equal(h.emails.length, mailsBefore, 'and sends nothing');

  // recording: the same as the webhook would have done
  const done = h.data('recordPayment', { reference: 'BAB-LK1-AAA-1' });
  assert.deepEqual(done, { result: 'ok', reference: 'BAB-LK1-AAA', kind: 'enrolment', by: 'owner@example.test' });
  assert.equal(h.cell('BAB-LK1-AAA', 'Payment status'), 'Paid (Squad verified)');
  assert.equal(h.cell('BAB-LK1-AAA', 'Amount paid (NGN)'), 80000);
  assert.equal(h.emails.filter((m) => /ubonanalyst@gmail\.com/.test(m.to || '')).length, 1, 'the review email goes out, as it does for a webhook');
  c = h.data('checkReference', { reference: 'BAB-LK1-AAA-1' });
  assert.deepEqual([c.record.alreadyRecorded, c.canRecord, c.reason], [true, false, 'This payment is already recorded.']);
  assert.match(h.api('recordPayment', { reference: 'BAB-LK1-AAA-1' }).error, /already recorded/);
  assert.equal(h.emails.filter((m) => /ubonanalyst@gmail\.com/.test(m.to || '')).length, 1, 'a second press sends nothing more');

  // a second payment for someone already paid is flagged, not recorded
  h.answers['BAB-LK1-AAA-2'] = squadOk();
  c = h.data('checkReference', { reference: 'BAB-LK1-AAA-2' });
  assert.equal(c.canRecord, false);
  assert.match(c.reason, /already paid with BAB-LK1-AAA-1\. This looks like a second payment/);
  assert.match(h.api('recordPayment', { reference: 'BAB-LK1-AAA-2' }).error, /second payment/);

  // an amount that is not the price is shown, and can still be recorded for review
  h.answers['BAB-LK2-AAA-1'] = squadOk({ transaction_amount: 100000 });
  c = h.data('checkReference', { reference: 'BAB-LK2-AAA-1' });
  assert.deepEqual([c.amount, c.amountMatches, c.canRecord], [1000, false, true]);
  h.data('recordPayment', { reference: 'BAB-LK2-AAA-1' });
  assert.match(h.cell('BAB-LK2-AAA', 'Payment status'), /amount needs review/i);

  // a reference with no enrolment behind it
  h.answers['BAB-NONE-AAA-1'] = squadOk();
  c = h.data('checkReference', { reference: 'BAB-NONE-AAA-1' });
  assert.equal(c.record.exists, false);
  assert.match(c.reason, /No enrolment in the sheet has the reference BAB-NONE-AAA/);

  // a 1:1 session payment
  assert.equal(h.named.Sessions, undefined);
  h.answers['UU1-SESS0009'] = squadOk({ transaction_amount: 1500000, customer_name: 'Sess Person', email: 'sess@example.test' });
  c = h.data('checkReference', { reference: 'UU1-SESS0009' });
  assert.deepEqual([c.kind, c.expected, c.amount, c.amountMatches, c.canRecord], ['session', 15000, 15000, true, true]);
  assert.equal(h.named.Sessions, undefined, 'looking up a session does not create its tab');
  const sess = h.data('recordPayment', { reference: 'UU1-SESS0009' });
  assert.deepEqual([sess.result, sess.kind, sess.reference], ['ok', 'session', 'UU1-SESS0009']);
  assert.equal(h.data('sessions').counts.paid, 1);
  assert.equal(h.data('checkReference', { reference: 'UU1-SESS0009' }).canRecord, false);
  assert.match(h.api('recordPayment', { reference: 'UU1-SESS0009' }).error, /already recorded/);

  // no secret key: a clear message, nothing changes
  delete h.properties.SQUAD_SECRET_KEY;
  assert.match(h.api('checkReference', { reference: 'BAB-LK1-AAA-1' }).error, /SQUAD_SECRET_KEY/);
}

/* ── An existing workbook gains the notes column without disturbing anything ── */
{
  const h = seeded();
  h.post(enrol('BAB-MG1-AAA'));
  assert.equal(h.enrolmentSheet.rows[0].at(-1), 'Admin notes');
  assert.equal(h.enrolmentSheet.rows[0].length, 40);
}
console.log('Admin dashboard API checks passed (access, overview, list, detail, actions).');
