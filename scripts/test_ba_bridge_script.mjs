import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('site_forms.gs', import.meta.url), 'utf8');
const BOOK_ID = '1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk';
const enrolmentHeaders = [
  'Timestamp', 'Reference', 'Full name', 'Email', 'WhatsApp', 'City and country',
  'Background', 'Years experience', 'Stage of transition', 'What they want most',
  'Biggest blocker', 'Preferred format', 'Availability', 'Can start',
  'Heard about it via', 'Consent given', 'Amount', 'Payment status',
  'Sender name', 'Transfer ref', 'Declared at', 'Verified by you',
  'Squad transaction ref', 'Amount paid (NGN)', 'Paid at', 'Squad status'
];
// The live Waitlist tab, exactly as the earlier waitlist script created it.
const liveWaitlistHeaders = ['Timestamp', 'Form', 'name', 'email', 'cohort', 'consent', 'type'];

function makeSheet(name, headers) {
  const rows = headers ? [headers.slice()] : [];
  let columns = Math.max(26, headers ? headers.length : 0);
  return {
    name, rows,
    get columns() { return columns; },
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0] ? rows[0].length : 0),
    getMaxColumns: () => columns,
    insertColumnsAfter(position, count) { assert.equal(position, columns); columns += count; },
    setFrozenRows() {},
    appendRow(row) { rows.push(row.slice()); },
    getRange(row, column, height = 1, width = 1) {
      assert.ok(column + width - 1 <= columns, 'write must fit available columns');
      return {
        getValues: () => Array.from({ length: height }, (_, r) =>
          Array.from({ length: width }, (_, c) => rows[row + r - 1]?.[column + c - 1] ?? '')),
        setValue(value) { rows[row - 1] ??= []; rows[row - 1][column - 1] = value; },
        setValues(values) {
          values.forEach((valuesRow, r) => {
            rows[row + r - 1] ??= [];
            valuesRow.forEach((value, c) => { rows[row + r - 1][column + c - 1] = value; });
          });
        }
      };
    }
  };
}

function makeHarness({ enrolment = enrolmentHeaders, tabs = {} } = {}) {
  const emails = [];
  const enrolmentSheet = makeSheet('BA Training', enrolment);
  const named = { ...tabs };
  const book = {
    getSheetById(gid) { assert.equal(gid, 0); return enrolmentSheet; },
    getSheetByName: (name) => named[name] || null,
    insertSheet(name) { named[name] = makeSheet(name, null); return named[name]; }
  };
  const properties = { BA_BRIDGE_WHATSAPP_GROUP_URL: 'https://chat.whatsapp.com/TestGroup123' };
  let uuid = 0;
  const context = {
    SpreadsheetApp: { openById(id) { assert.equal(id, BOOK_ID); return book; }, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => (uuid++ === 0 ? 'test-token' : `uuid-${uuid}`), formatDate: () => '2026-10-08 09:00:00' },
    Session: { getScriptTimeZone: () => 'Africa/Lagos' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] ?? null }) },
    MailApp: {
      getRemainingDailyQuota: () => 100,
      // Supports both call styles used by the script: (to, subject, body) and ({...}).
      sendEmail(...args) {
        emails.push(args.length === 1 ? args[0] : { to: args[0], subject: args[1], body: args[2] });
      }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: (html) => ({ html, setTitle() { return this; } }) },
    console: { error() {}, log() {} },
    Logger: { log() {} },
    Date, JSON, String, Number, Array, Object, Math, RegExp, Error, encodeURIComponent, isNaN
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const post = (parameter) => context.doPost({ parameter });
  const result = (output) => JSON.parse(output.text).result;
  return { context, post, result, emails, enrolmentSheet, named };
}

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
assert.deepEqual(waitlistTab.rows[0], liveWaitlistHeaders, 'existing headings and order are untouched');
assert.equal(waitlistTab.rows.length, 3);
const added = waitlistTab.rows[2];
assert.ok(added[0] instanceof Date);
assert.deepEqual(added.slice(1), ['ba-waitlist-feb-2027', 'Ada Example', 'Ada@Example.test', 'February 2027', 'Yes', 'BA Bridge February 2027 waitlist']);
assert.equal(w.emails.length, 1);
assert.equal(w.emails[0].to, 'ubonudonkang@gmail.com');
assert.match(w.emails[0].subject, /New waitlist signup: Ada Example \(2 total\)/);
// A repeat of the same email and cohort (any letter case) is skipped, not saved or announced again.
assert.equal(w.result(w.post({ ...signup, email: ' ada@example.TEST ' })), 'ok');
assert.equal(waitlistTab.rows.length, 3);
assert.equal(w.emails.length, 1);
assert.equal(w.result(w.post({ ...signup, email: 'earlier@example.test' })), 'ok', 'a signup already in the sheet is skipped');
assert.equal(waitlistTab.rows.length, 3);
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
assert.deepEqual(independent.named.Waitlist.rows[0], liveWaitlistHeaders);

/* ── Contact: its own tab, reply-to the sender, deduped by submission id ── */
const c = makeHarness();
const enquiry = {
  form_name: 'contact', first_name: 'Chidi', last_name: 'Okafor', email: 'chidi@example.test',
  company: 'Fintech Ltd', type: 'consulting', message: 'Need a BA for a payments project.', submission_id: 'sub-1'
};
assert.equal(c.result(c.post(enquiry)), 'ok');
const contactTab = c.named.Contact;
assert.deepEqual(contactTab.rows[0], ['Timestamp', 'First name', 'Last name', 'Email', 'Company', 'Engagement type', 'Message', 'Submission ID']);
assert.deepEqual(contactTab.rows[1].slice(1), ['Chidi', 'Okafor', 'chidi@example.test', 'Fintech Ltd', 'consulting', 'Need a BA for a payments project.', 'sub-1']);
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
assert.equal(sheet.columns, 39);
assert.equal(sheet.rows[0].length, 39);
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

const mismatched = makeHarness({ enrolment: [...enrolmentHeaders.slice(0, 17), 'Wrong status heading', ...enrolmentHeaders.slice(18)] });
assert.match(mismatched.post(enrol).html, /header mismatch/);
assert.equal(mismatched.enrolmentSheet.rows.length, 1);

console.log('Site forms script checks passed (waitlist, contact, enrolment, payment confirmation).');
