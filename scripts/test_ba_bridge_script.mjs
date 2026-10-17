import assert from 'node:assert/strict';
import { enrolmentHeaders, liveWaitlistHeaders, makeHarness, makeSheet } from './gas_harness.mjs';

/* ── Waitlist: writes to the existing Waitlist tab, matched by heading ── */
const liveRow = [new Date('2026-10-01'), 'ba-waitlist-feb-2027', 'Earlier Person', 'earlier@example.test', 'February 2027', 'Yes', 'BA Bridge February 2027 waitlist'];
const waitlistTab = makeSheet('Waitlist', liveWaitlistHeaders);
waitlistTab.rows.push(liveRow);
const w = makeHarness({ tabs: { Waitlist: waitlistTab } });
const signup = {
  form_name: 'ba-waitlist-feb-2027', type: 'BA Bridge February 2027 waitlist', cohort: 'February 2027',
  name: 'Ada Example', email: 'Ada@Example.test', consent: 'Yes', _gotcha: ''
};
assert.equal(w.result(w.post(signup)), 'ok');
assert.deepEqual(waitlistTab.rows[0], [...liveWaitlistHeaders, 'Site'], 'existing headings and order are untouched; the site is added on the right');
assert.equal(waitlistTab.rows.length, 3);
const added = waitlistTab.rows[2];
assert.ok(added[0] instanceof Date);
assert.deepEqual(added.slice(1), ['ba-waitlist-feb-2027', 'Ada Example', 'Ada@Example.test', 'February 2027', 'Yes', 'BA Bridge February 2027 waitlist', 'ubonudonkang.com']);
assert.equal(w.emails.length, 1);
assert.equal(w.emails[0].to, 'ubonudonkang@gmail.com');
assert.match(w.emails[0].subject, /New waitlist signup: Ada Example \(2 total\)/);
// A repeat of the same email and cohort (any letter case) is skipped, not saved or announced again.
assert.equal(w.result(w.post({ ...signup, email: ' ada@example.TEST ' })), 'ok');
assert.equal(waitlistTab.rows.length, 3);
assert.equal(w.emails.length, 1);
assert.equal(w.result(w.post({ ...signup, email: 'earlier@example.test' })), 'ok', 'a signup already in the sheet is skipped');
assert.equal(waitlistTab.rows.length, 3);
// Google Sheets turns "February 2027", typed or imported, into a date. A repeat must still be recognised.
const february = new Date('2027-01-31T23:00:00Z'); // 1 February 2027, midnight in Lagos
waitlistTab.rows[1][4] = february;
waitlistTab.rows[2][4] = february;
assert.equal(w.result(w.post({ ...signup, email: 'ada@example.test' })), 'ok');
assert.equal(w.result(w.post({ ...signup, email: 'earlier@example.test' })), 'ok');
assert.equal(waitlistTab.rows.length, 3, 'a signup whose cohort the sheet turned into a date is still a repeat');
assert.equal(w.emails.length, 1, 'and is not announced again');
// The same person can join a later cohort's waitlist.
assert.equal(w.result(w.post({ ...signup, form_name: 'ba-waitlist-may-2027', cohort: 'May 2027' })), 'ok');
assert.equal(waitlistTab.rows.length, 4);
// Bots, bad input and spreadsheet formulas.
assert.equal(w.result(w.post({ ...signup, email: 'bot@example.test', _gotcha: 'filled' })), 'ok');
assert.equal(waitlistTab.rows.length, 4, 'a filled honeypot saves nothing');
assert.equal(w.result(w.post({ ...signup, email: 'not-an-email' })), 'error');
assert.equal(w.result(w.post({ ...signup, email: 'nc@example.test', consent: '' })), 'error');
assert.equal(w.result(w.post({ ...signup, email: 'nn@example.test', name: '  ' })), 'error');
assert.equal(waitlistTab.rows.length, 4);
assert.equal(w.result(w.post({ ...signup, email: 'f@example.test', name: '=2+2' })), 'ok');
assert.equal(waitlistTab.rows[4][2], "'=2+2");
// A form name that is not a known form must not reach the waitlist.
assert.equal(waitlistTab.rows.length, 5);
const stray = w.post({ form_name: 'something-else', name: 'X', email: 'x@example.test' });
assert.match(stray.text ?? stray.html, /Unsupported|Unable to continue/);

// The waitlist works even when the enrolment tab is not ready (its headers are checked separately).
const independent = makeHarness({ enrolment: ['Wrong heading'] });
assert.equal(independent.result(independent.post(signup)), 'ok');
assert.equal(independent.named.Waitlist.rows.length, 2, 'a missing Waitlist tab is created with headings');
assert.deepEqual(independent.named.Waitlist.rows[0], [...liveWaitlistHeaders, 'Site']);

/* ── Two websites, one script: each submission says where it came from ── */
{
  const both = makeHarness();
  const wl = (extra) => both.post({ form_name: 'ba-waitlist-feb-2027', cohort: 'February 2027', name: 'Pat', email: 'pat@example.test', consent: 'Yes', type: 'BA Bridge February 2027 waitlist', ...extra });
  // Practeva's form names itself in `type` (and may send `site`); the personal site sends neither
  assert.equal(both.result(wl({ email: 'a@example.test', type: 'BA Bridge February 2027 waitlist (practevahq.com)' })), 'ok');
  assert.equal(both.result(wl({ email: 'b@example.test' })), 'ok');
  assert.equal(both.result(wl({ email: 'c@example.test', site: 'https://www.PracteVAhq.com/training', type: 'x' })), 'ok');
  assert.equal(both.result(wl({ email: 'd@example.test', site: 'evil.example', type: 'y' })), 'ok');
  const rows = both.named.Waitlist.rows;
  const siteAt = rows[0].indexOf('Site');
  assert.deepEqual(rows.slice(1).map((r) => r[siteAt]), ['practevahq.com', 'ubonudonkang.com', 'practevahq.com', 'ubonudonkang.com'], 'named by type, by default, by a tidied address; an unknown site falls back');
  // the same person on both sites is one signup: the first one stays
  assert.equal(both.result(wl({ email: 'A@example.test', site: 'ubonudonkang.com' })), 'ok');
  assert.equal(rows.length, 5);
  assert.equal(rows[1][siteAt], 'practevahq.com');
  // each notification is sent under the name of the site it came from
  assert.deepEqual(both.emails.map((m) => m.name), ['practevahq.com', 'ubonudonkang.com', 'practevahq.com', 'ubonudonkang.com']);
  assert.match(both.emails[0].body, /via: practevahq\.com/);

  const contact = (extra) => both.post({ form_name: 'contact', first_name: 'Ola', last_name: 'Okoye', email: 'ola@example.test', message: 'Hi', ...extra });
  contact({ type: 'Practeva: Advisory for my organisation', submission_id: 'p1' });
  contact({ type: 'consulting', submission_id: 'u1' });
  const enquiries = both.named.Contact.rows;
  assert.deepEqual(enquiries.slice(1).map((r) => r[enquiries[0].indexOf('Site')]), ['practevahq.com', 'ubonudonkang.com']);
  const sent = both.emails.slice(-2);
  assert.deepEqual(sent.map((m) => m.name), ['practevahq.com', 'ubonudonkang.com']);
  assert.match(sent[0].body, /Via: practevahq\.com/);
}

/* ── Contact: its own tab, reply-to the sender, deduped by submission id ── */
const c = makeHarness();
const enquiry = {
  form_name: 'contact', first_name: 'Chidi', last_name: 'Okafor', email: 'chidi@example.test',
  company: 'Fintech Ltd', type: 'consulting', message: 'Need a BA for a payments project.', submission_id: 'sub-1'
};
assert.equal(c.result(c.post(enquiry)), 'ok');
const contactTab = c.named.Contact;
assert.deepEqual(contactTab.rows[0], ['Timestamp', 'First name', 'Last name', 'Email', 'Company', 'Engagement type', 'Message', 'Submission ID', 'Site']);
assert.deepEqual(contactTab.rows[1].slice(1), ['Chidi', 'Okafor', 'chidi@example.test', 'Fintech Ltd', 'consulting', 'Need a BA for a payments project.', 'sub-1', 'ubonudonkang.com']);
assert.equal(c.emails.length, 1);
assert.equal(c.emails[0].to, 'ubonudonkang@gmail.com');
assert.equal(c.emails[0].replyTo, 'chidi@example.test');
assert.match(c.emails[0].subject, /\[Contact\] consulting: Chidi Okafor/);
assert.equal(c.result(c.post(enquiry)), 'ok', 'a retry of the same submission is accepted');
assert.equal(contactTab.rows.length, 2);
assert.equal(c.emails.length, 1);
assert.equal(c.result(c.post({ ...enquiry, submission_id: 'sub-2', message: '' })), 'error');
assert.equal(c.result(c.post({ ...enquiry, submission_id: 'sub-3', email: 'nope' })), 'error');
assert.equal(c.result(c.post({ ...enquiry, submission_id: 'sub-4', message: 'x'.repeat(5001) })), 'error');
assert.equal(c.result(c.post({ ...enquiry, submission_id: 'sub-5', _gotcha: 'bot' })), 'ok');
assert.equal(contactTab.rows.length, 2);
// A second enquiry from the same person with a new submission id is a new row.
assert.equal(c.result(c.post({ ...enquiry, submission_id: 'sub-6' })), 'ok');
assert.equal(contactTab.rows.length, 3);

/* ── BA Bridge enrolment, review and manual confirmation ── */
const h = makeHarness();
const enrol = {
  action: 'signup', reference: 'BAB-TEST-123', name: 'Ada Example', email: 'ada@example.test',
  whatsapp: '+2341000000000', location: 'Lagos, Nigeria', background: 'Finance',
  experience: '3 years', stage: 'Exploring', wants: 'Portfolio project',
  availability: 'Saturday mornings', source: 'LinkedIn', consent: 'Yes', amount: '1', cohort: 'February 2027',
  payment_status: 'Paid', _gotcha: ''
};
assert.equal(h.result(h.post(enrol)), 'ok');
const sheet = h.enrolmentSheet;
assert.equal(sheet.columns, 41);
assert.equal(sheet.rows[0].length, 41);
assert.deepEqual(sheet.rows[0].slice(0, 26), enrolmentHeaders);
const row = sheet.rows[1];
assert.equal(row[1], enrol.reference);
assert.equal(row[2], enrol.name);
assert.equal(row[4], "'+2341000000000");
assert.equal(row[16], 80000, 'the amount and status come from the script, not the browser');
assert.equal(row[17], 'Awaiting payment');
assert.equal(row[21], 'No');
assert.equal(row[27], 'test-token');
assert.equal(JSON.parse(h.post(enrol).text).duplicate, true, 'a retried request is not saved twice');
assert.equal(sheet.rows.length, 2);
assert.match(h.post({ ...enrol, reference: '=2+2' }).html, /Invalid enrolment reference/);
assert.equal(sheet.rows.length, 2);
assert.equal(h.result(h.post({ ...enrol, reference: 'BAB-BOT-123', _gotcha: 'filled' })), 'ok');
assert.equal(sheet.rows.length, 2, 'the honeypot also protects the enrolment');

const review = h.context.doGet({ parameter: { action: 'review', reference: enrol.reference, token: 'test-token' } });
assert.match(review.html, /Confirm payment/);
assert.equal(row[17], 'Awaiting payment', 'opening the review link changes nothing');
assert.match(h.context.doPost({ parameter: { action: 'confirm', intent: 'confirm', reference: enrol.reference, token: 'wrong' } }).html, /invalid/);
assert.equal(row[17], 'Awaiting payment');
const confirmed = h.context.doPost({ parameter: {
  action: 'confirm', intent: 'confirm', reference: enrol.reference, token: 'test-token',
  selar_sale_reference: 'SELAR-456', amount_paid: '80000'
} });
assert.match(confirmed.html, /Payment confirmed/);
assert.equal(row[17], 'Paid — manually confirmed');
assert.equal(row[21], 'Yes');
assert.equal(row[23], 80000);
assert.equal(row[26], 'SELAR-456');
assert.equal(row[29], 'ubonanalyst@gmail.com');
const welcome = h.emails.find((mail) => mail.to === 'ada@example.test');
assert.ok(welcome, 'the student gets the welcome email');
assert.equal(welcome.cc, 'alabioluwafunmito@gmail.com,ubonudonkang@gmail.com');
assert.match(welcome.body, /chat\.whatsapp\.com\/TestGroup123/);
assert.match(h.context.doPost({ parameter: { action: 'confirm', intent: 'confirm', reference: enrol.reference, token: 'test-token' } }).html, /already marked as paid/);


/* ── Squad payments: webhook, browser path, verification, sweep ── */
const SANDBOX_KEY = 'sandbox_sk_testkey123';
const squadOk = (extra = {}) => ({
  code: 200,
  body: { status: 200, success: true, data: { transaction_status: 'Success', transaction_amount: 8000000, transaction_currency_id: 'NGN', transaction_type: 'Card', ...extra } },
});
const webhook = (ref, event = 'charge_successful') => ({
  Event: event, TransactionRef: ref,
  Body: { transaction_ref: ref, merchant_ref: ref, amount: 8000000, transaction_status: 'Success', currency: 'NGN' },
});
// Apps Script gives doPost the parsed JSON body as postData, not as parameters.
const postJson = (h, payload) => h.context.doPost({ parameter: {}, postData: { type: 'application/json', contents: JSON.stringify(payload) } });
const enrolment = (reference) => ({
  action: 'signup', reference, name: 'Ada Example', email: 'ada@example.test', whatsapp: '+2341',
  location: 'Lagos', background: 'Finance', experience: '3', stage: 'x', wants: 'y', availability: 'z', source: 'LinkedIn', consent: 'Yes',
});
const paidRow = (h, n = 1) => h.enrolmentSheet.rows[n];
const COLS = { payment: 17, verified: 21, squadRef: 22, amountPaid: 23, paidAt: 24, squadStatus: 25, reviewSent: 32 };

{
  const answers = {};
  const h = makeHarness({ squad: { key: SANDBOX_KEY, respond: (url) => answers[url.split('/verify/')[1]] || { code: 400, body: { data: null } } } });
  const REF = 'BAB-SQ1-ABC';
  assert.equal(h.result(h.post(enrolment(REF))), 'ok');
  const reviewCount = () => h.emails.filter((m) => /Review payment/.test(m.subject)).length;

  // Forged or irrelevant webhooks never reach Squad's API.
  assert.equal(JSON.parse(postJson(h, webhook('BAB-NOPE-XYZ-1')).text).result, 'unmatched');
  assert.equal(JSON.parse(postJson(h, webhook('SQ-OTHER-PRODUCT')).text).result, 'ignored');
  assert.equal(JSON.parse(postJson(h, webhook(REF + '-1', 'transfer_refund')).text).result, 'ignored');
  assert.equal(h.fetches.length, 0, 'nothing is verified for references that are not awaiting payment here');
  assert.equal(paidRow(h)[COLS.payment], 'Awaiting payment');

  // A webhook for a reference Squad does not know changes nothing.
  assert.equal(JSON.parse(postJson(h, webhook(REF + '-1')).text).result, 'not_paid');
  assert.equal(h.fetches.length, 1);
  assert.equal(paidRow(h)[COLS.payment], 'Awaiting payment');
  assert.equal(reviewCount(), 0);

  // The sandbox key goes to the sandbox API as a bearer token.
  assert.equal(h.fetches[0].url, 'https://sandbox-api-d.squadco.com/transaction/verify/BAB-SQ1-ABC-1');
  assert.equal(h.fetches[0].options.headers.Authorization, 'Bearer ' + SANDBOX_KEY);

  // Squad says an attempt is still pending (bank transfer): recorded, no email yet.
  answers[REF + '-1'] = squadOk({ transaction_status: 'Pending' });
  assert.equal(JSON.parse(postJson(h, webhook(REF + '-1')).text).result, 'pending');
  assert.equal(paidRow(h)[COLS.squadStatus], 'Pending');
  assert.equal(paidRow(h)[COLS.payment], 'Awaiting payment');
  assert.equal(reviewCount(), 0);

  // The real payment arrives (attempt 2) by webhook.
  answers[REF + '-2'] = squadOk();
  const paid = JSON.parse(postJson(h, webhook(REF + '-2')).text);
  assert.equal(paid.result, 'ok');
  assert.equal(paid.amount_matches, true);
  assert.equal(paid.review_email_sent, true);
  const row = paidRow(h);
  assert.equal(row[COLS.payment], 'Paid (Squad verified)');
  assert.equal(row[COLS.squadRef], REF + '-2');
  assert.equal(row[COLS.squadStatus], 'Success');
  assert.equal(row[COLS.amountPaid], 80000);
  assert.equal(row[COLS.verified], 'No', 'the owner still confirms before the welcome email');
  assert.equal(reviewCount(), 1, 'the review email is sent automatically');
  const review = h.emails.find((m) => /Review payment/.test(m.subject));
  assert.equal(review.to, 'ubonanalyst@gmail.com');
  assert.match(review.body, /Squad reference: BAB-SQ1-ABC-2/);
  assert.match(review.body, /review&reference=BAB-SQ1-ABC&token=test-token|review&reference=BAB-SQ1-ABC&token=/);
  assert.equal(h.emails.some((m) => m.to === 'ada@example.test'), false, 'no welcome email until the owner confirms');

  // Retries and the browser report of the same payment do nothing more.
  const fetchesBefore = h.fetches.length;
  assert.equal(JSON.parse(postJson(h, webhook(REF + '-2')).text).already_processed, true);
  assert.equal(JSON.parse(h.post({ action: 'payment', reference: REF, squad_ref: REF + '-2' }).text).already_processed, true);
  assert.equal(h.fetches.length, fetchesBefore, 'a processed payment is not verified again');
  assert.equal(reviewCount(), 1);

  // A second successful payment for the same enrolment warns the owner once.
  answers[REF + '-3'] = squadOk();
  assert.equal(JSON.parse(postJson(h, webhook(REF + '-3')).text).result, 'duplicate_payment');
  assert.equal(JSON.parse(postJson(h, webhook(REF + '-3')).text).result, 'duplicate_payment');
  assert.equal(h.emails.filter((m) => /Second Squad payment/.test(m.subject)).length, 1);
  assert.equal(paidRow(h)[COLS.squadRef], REF + '-2', 'the first payment stays on the record');

  // The review link now shows the Squad details, and confirming sends the welcome email.
  const page = h.context.doGet({ parameter: { action: 'review', reference: REF, token: 'test-token' } });
  assert.match(page.html, /<dt>Squad reference<\/dt><dd>BAB-SQ1-ABC-2<\/dd>/);
  assert.doesNotMatch(page.html, /Selar/);
  const confirm = h.context.doPost({ parameter: { action: 'confirm', intent: 'confirm', reference: REF, token: 'test-token', amount_paid: '80000' } });
  assert.match(confirm.html, /Payment confirmed/);
  assert.ok(h.emails.find((m) => m.to === 'ada@example.test'));
}

{
  // The browser path verifies the same way, and ignores any reference the browser claims.
  const h = makeHarness({ squad: { key: 'sk_livekey456', respond: () => squadOk() } });
  h.post(enrolment('BAB-SQ2-ABC'));
  h.post(enrolment('BAB-SQ2-DEF'));
  const out = JSON.parse(h.post({ action: 'payment', reference: 'BAB-SQ2-DEF', squad_ref: 'BAB-SQ2-ABC-1' }).text);
  assert.equal(out.reference, 'BAB-SQ2-ABC');
  assert.equal(h.enrolmentSheet.rows[1][COLS.payment], 'Paid (Squad verified)');
  assert.equal(h.enrolmentSheet.rows[2][COLS.payment], 'Awaiting payment');
  assert.equal(h.fetches[0].url, 'https://api-d.squadco.com/transaction/verify/BAB-SQ2-ABC-1', 'a live key uses the live API');
  assert.equal(JSON.parse(h.post({ action: 'payment', squad_ref: 'junk' }).text).result, 'ignored');
  assert.equal(h.fetches.length, 1);
}

{
  // A payment of the wrong amount is recorded but not treated as settled.
  const h = makeHarness({ squad: { key: SANDBOX_KEY, respond: () => squadOk({ transaction_amount: 100000 }) } });
  h.post(enrolment('BAB-SQ3-ABC'));
  const out = JSON.parse(postJson(h, webhook('BAB-SQ3-ABC-1')).text);
  assert.equal(out.amount_matches, false);
  assert.equal(h.enrolmentSheet.rows[1][COLS.payment], 'Squad payment: amount needs review');
  assert.equal(h.enrolmentSheet.rows[1][COLS.amountPaid], 1000);
  assert.match(h.emails.find((m) => /Review payment/.test(m.subject)).body, /not the expected NGN 80000/);
  // A different currency is also held for review.
  const usd = makeHarness({ squad: { key: SANDBOX_KEY, respond: () => squadOk({ transaction_currency_id: 'USD' }) } });
  usd.post(enrolment('BAB-SQ3-DEF'));
  assert.equal(JSON.parse(postJson(usd, webhook('BAB-SQ3-DEF-1')).text).amount_matches, false);
}

{
  // Squad problems never mark anything paid, and say what is wrong.
  const bad = makeHarness({ squad: { key: SANDBOX_KEY, respond: () => ({ code: 401, body: {} }) } });
  bad.post(enrolment('BAB-SQ4-ABC'));
  const rejected = JSON.parse(postJson(bad, webhook('BAB-SQ4-ABC-1')).text);
  assert.equal(rejected.result, 'error');
  assert.match(rejected.message, /rejected the secret key/);
  assert.equal(bad.enrolmentSheet.rows[1][COLS.payment], 'Awaiting payment');
  const down = makeHarness({ squad: { key: SANDBOX_KEY, respond: () => ({ code: 503, body: {} }) } });
  down.post(enrolment('BAB-SQ4-DEF'));
  assert.match(JSON.parse(postJson(down, webhook('BAB-SQ4-DEF-1')).text).message, /HTTP 503/);
  const unset = makeHarness({ squad: { key: 'not-a-key', respond: () => squadOk() } });
  unset.post(enrolment('BAB-SQ4-GHI'));
  assert.match(JSON.parse(postJson(unset, webhook('BAB-SQ4-GHI-1')).text).message, /Set SQUAD_SECRET_KEY/);
  assert.equal(unset.enrolmentSheet.rows[1][COLS.payment], 'Awaiting payment');
}

{
  // The sweep picks up a payment whose webhook was missed, and only looks at awaiting enrolments.
  const paidRefs = new Set(['BAB-SQ5-ABC-2']);
  const h = makeHarness({ squad: { key: SANDBOX_KEY, respond: (url) => (paidRefs.has(url.split('/verify/')[1]) ? squadOk() : { code: 400, body: {} }) } });
  h.post(enrolment('BAB-SQ5-ABC'));
  h.post(enrolment('BAB-SQ5-DEF'));
  const summary = h.context.sweepAwaitingSquadPayments();
  assert.match(summary, /Newly paid: 1 Errors: 0/);
  assert.equal(h.enrolmentSheet.rows[1][COLS.payment], 'Paid (Squad verified)');
  assert.equal(h.enrolmentSheet.rows[2][COLS.payment], 'Awaiting payment');
  const calls = h.fetches.length;
  h.context.sweepAwaitingSquadPayments();
  assert.equal(h.fetches.length, calls + 3, 'a paid enrolment is not checked again; the unpaid one is tried for 3 attempts');
  assert.equal(h.emails.filter((m) => /Review payment/.test(m.subject)).length, 1);
  h.context.installSquadSweepTrigger();
  h.context.installSquadSweepTrigger();
  assert.equal(h.triggers.length, 1, 'installing twice leaves one trigger');
  assert.equal(h.triggers[0].every, 30);
  h.context.removeSquadSweepTrigger();
  assert.equal(h.triggers.length, 0);
}

/* ── 1:1 session payments (UU1- references) ── */
{
  const answers = {};
  const respond = (url) => answers[url.split('/verify/')[1]] || { code: 400, body: { data: null } };
  const h = makeHarness({ squad: { key: SANDBOX_KEY, respond } });
  const sessionEmails = () => h.emails.filter((m) => /\[1:1 Session\]/.test(m.subject));
  const rows = () => (h.named.Sessions ? h.named.Sessions.rows : []);

  // Unknown or unpaid references record nothing.
  assert.equal(JSON.parse(postJson(h, webhook('UU1-NOSUCH1')).text).result, 'not_paid');
  assert.equal(rows().length <= 1, true);
  answers['UU1-PEND001'] = squadOk({ transaction_amount: 1500000, transaction_status: 'Pending' });
  assert.equal(JSON.parse(postJson(h, webhook('UU1-PEND001')).text).result, 'pending');
  assert.equal(sessionEmails().length, 0);

  // A paid session is logged once, announced once, and the amount is checked.
  answers['UU1-PAID0001'] = squadOk({ transaction_amount: 1500000, email: 'ada@example.test', customer_name: 'Ada Example' });
  const first = JSON.parse(postJson(h, webhook('UU1-PAID0001')).text);
  assert.equal(first.result, 'ok');
  assert.equal(first.amount_matches, true);
  assert.deepEqual(rows()[0], ['Timestamp', 'Squad reference', 'Name', 'Email', 'Amount paid (NGN)', 'Status', 'Reported by']);
  assert.deepEqual(rows()[1].slice(1), ['UU1-PAID0001', 'Ada Example', 'ada@example.test', 15000, 'Paid', 'webhook']);
  assert.equal(sessionEmails().length, 1);
  assert.equal(sessionEmails()[0].to, 'ubonudonkang@gmail.com');
  assert.match(sessionEmails()[0].subject, /\[1:1 Session\] Paid: Ada Example \(UU1-PAID0001\)/);
  assert.match(sessionEmails()[0].body, /quote this reference/);

  // The browser's report of the same payment, and webhook retries, change nothing and cost no Squad call.
  const fetchesBefore = h.fetches.length;
  assert.equal(JSON.parse(h.post({ action: 'payment', squad_ref: 'UU1-PAID0001' }).text).already_processed, true);
  assert.equal(JSON.parse(postJson(h, webhook('UU1-PAID0001')).text).already_processed, true);
  assert.equal(h.fetches.length, fetchesBefore);
  assert.equal(rows().length, 2);
  assert.equal(sessionEmails().length, 1);

  // A different amount is recorded but flagged.
  answers['UU1-LOW00001'] = squadOk({ transaction_amount: 10000 });
  assert.equal(JSON.parse(h.post({ action: 'payment', squad_ref: 'UU1-LOW00001' }).text).amount_matches, false);
  assert.equal(rows()[2][5], 'Amount needs review');
  assert.match(sessionEmails()[1].subject, /CHECK AMOUNT/);
  assert.match(sessionEmails()[1].body, /not of the expected NGN 15000/);

  // The cohort flow is untouched by the session path.
  assert.equal(JSON.parse(postJson(h, webhook('BAB-NOPE-XYZ-1')).text).result, 'unmatched');
  assert.equal(JSON.parse(postJson(h, webhook('UU1-lowercase')).text).result, 'ignored');
}
{
  // Strangers cannot use up the script's Squad calls by sending made-up session references.
  const h = makeHarness({ squad: { key: SANDBOX_KEY, respond: () => ({ code: 400, body: { data: null } }) } });
  for (let i = 0; i < 70; i++) postJson(h, webhook('UU1-JUNK' + String(i).padStart(4, '0')));
  assert.equal(h.fetches.length, 60, 'only 60 unknown references are looked up per hour');
  assert.equal(JSON.parse(postJson(h, webhook('UU1-JUNK9999')).text).result, 'ignored');
  // Cohort payments are not affected, because their references are checked against the sheet first.
  h.post(enrolment('BAB-SQ9-ABC'));
  assert.notEqual(JSON.parse(postJson(h, webhook('BAB-SQ9-ABC-1')).text).result, 'ignored');
  assert.equal(h.fetches.length, 61);
}

const mismatched = makeHarness({ enrolment: [...enrolmentHeaders.slice(0, 17), 'Wrong status heading', ...enrolmentHeaders.slice(18)] });
assert.match(mismatched.post(enrol).html, /header mismatch/);
assert.equal(mismatched.enrolmentSheet.rows.length, 1);

console.log('Site forms script checks passed (waitlist, contact, enrolment, Squad payments, payment confirmation).');
