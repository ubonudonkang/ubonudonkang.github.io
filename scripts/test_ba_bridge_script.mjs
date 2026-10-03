import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('ba_bridge_enrolment.gs', import.meta.url), 'utf8');
const existingHeaders = [
  'Timestamp', 'Reference', 'Full name', 'Email', 'WhatsApp', 'City and country',
  'Background', 'Years experience', 'Stage of transition', 'What they want most',
  'Biggest blocker', 'Preferred format', 'Availability', 'Can start',
  'Heard about it via', 'Consent given', 'Amount', 'Payment status',
  'Sender name', 'Transfer ref', 'Declared at', 'Verified by you',
  'Squad transaction ref', 'Amount paid (NGN)', 'Paid at', 'Squad status'
];

function makeHarness(headers = existingHeaders) {
  const rows = [headers.slice()];
  const emails = [];
  let columns = Math.max(26, headers.length);
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getMaxColumns: () => columns,
    insertColumnsAfter(position, count) { assert.equal(position, columns); columns += count; },
    setFrozenRows() {},
    appendRow(row) { rows.push(row.slice()); },
    getRange(row, column, height = 1, width = 1) {
      assert.ok(column + width - 1 <= columns, 'write must fit available columns');
      return {
        getValues: () => Array.from({ length: height }, (_, r) =>
          Array.from({ length: width }, (_, c) => rows[row + r - 1]?.[column + c - 1] ?? '')),
        setValue(value) {
          rows[row - 1] ??= [];
          rows[row - 1][column - 1] = value;
        },
        setValues(values) {
          values.forEach((valuesRow, r) => {
            rows[row + r - 1] ??= [];
            valuesRow.forEach((value, c) => { rows[row + r - 1][column + c - 1] = value; });
          });
        }
      };
    }
  };
  const context = {
    SpreadsheetApp: { openById(id) {
      assert.equal(id, '1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk');
      return { getSheetById(gid) { assert.equal(gid, 0); return sheet; } };
    } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => 'test-token', formatDate: () => '2026-10-03 09:00:00' },
    Session: { getScriptTimeZone: () => 'Africa/Lagos' },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.test/exec' }) },
    MailApp: { sendEmail: (mail) => emails.push(mail) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: (html) => ({ html, setTitle() { return this; } }) },
    Date, JSON, String, Number, Array, Object, encodeURIComponent
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, rows, emails, sheet, get columns() { return columns; } };
}

const h = makeHarness();
const signup = {
  action: 'signup', reference: 'BAB-TEST-123', name: 'Ada Example', email: 'ada@example.test',
  whatsapp: '+2341000000000', location: 'Lagos, Nigeria', background: 'Finance',
  experience: '3 years', stage: 'Exploring', wants: 'Portfolio project',
  availability: 'Saturday mornings', source: 'LinkedIn', consent: 'Yes', amount: '80000'
};
assert.equal(JSON.parse(h.context.doPost({ parameter: signup }).text).result, 'ok');
assert.equal(h.columns, 30);
assert.deepEqual(h.rows[0].slice(0, 26), existingHeaders);
assert.deepEqual(h.rows[0].slice(26), ['Selar sale reference', 'Confirmation token', 'Confirmed at', 'Confirmed by']);
const row = h.rows[1];
assert.equal(row[1], signup.reference);
assert.equal(row[2], signup.name);
assert.equal(row[5], signup.location);
assert.equal(row[7], signup.experience);
assert.equal(row[9], signup.wants);
assert.equal(row[10], ''); // No site field for biggest blocker.
assert.equal(row[11], ''); // No site field for preferred format.
assert.equal(row[13], ''); // No site field for can start.
assert.equal(row[17], 'Awaiting payment');
assert.equal(row[21], 'No');
assert.equal(row[22], ''); // Historical transaction column is untouched.
assert.equal(row[27], 'test-token');
assert.equal(h.emails.length, 1);
assert.match(h.emails[0].htmlBody, /Review &amp; confirm payment/);

// A duplicate request must not create another enrolment or email.
assert.equal(JSON.parse(h.context.doPost({ parameter: signup }).text).result, 'ok');
assert.equal(h.rows.length, 2);
assert.equal(h.emails.length, 1);

const review = h.context.doGet({ parameter: { action: 'review', reference: signup.reference, token: 'test-token' } });
assert.match(review.html, /Confirm payment/);
assert.match(review.html, /target="_blank"/);
assert.equal(row[17], 'Awaiting payment');
const bad = h.context.doPost({ parameter: { action: 'confirm', intent: 'confirm', reference: signup.reference, token: 'wrong' } });
assert.match(bad.html, /invalid/);
assert.equal(row[17], 'Awaiting payment');

const confirmed = h.context.doPost({ parameter: {
  action: 'confirm', intent: 'confirm', reference: signup.reference, token: 'test-token',
  selar_sale_reference: 'SELAR-456', amount_paid: '80000'
} });
assert.match(confirmed.html, /Payment confirmed/);
assert.equal(row[17], 'Paid — manually confirmed');
assert.equal(row[21], 'Yes');
assert.equal(row[22], '');
assert.equal(row[23], 80000);
assert.equal(row[25], '');
assert.equal(row[26], 'SELAR-456');
assert.equal(row[28], '2026-10-03 09:00:00');
assert.equal(row[29], 'ubonanalyst@gmail.com');
assert.match(h.context.doPost({ parameter: { action: 'confirm', intent: 'confirm', reference: signup.reference, token: 'test-token' } }).html, /already confirmed/);

const mismatched = makeHarness([...existingHeaders.slice(0, 17), 'Wrong status heading', ...existingHeaders.slice(18)]);
assert.equal(JSON.parse(mismatched.context.doPost({ parameter: signup }).text).result, 'error');
assert.equal(mismatched.rows.length, 1);
const readyHeaders = existingHeaders.concat(['Selar sale reference', 'Confirmation token', 'Confirmed at', 'Confirmed by']);
const ready = makeHarness(readyHeaders);
assert.equal(JSON.parse(ready.context.doPost({ parameter: { ...signup, reference: 'BAB-READY-123' } }).text).result, 'ok');
assert.deepEqual(ready.rows[0], readyHeaders);
assert.equal(ready.columns, 30);
const occupied = makeHarness();
const occupiedRow = new Array(27).fill('');
occupiedRow[26] = 'Existing unlabelled value';
occupied.rows.push(occupiedRow);
assert.equal(JSON.parse(occupied.context.doPost({ parameter: signup }).text).result, 'error');
assert.equal(occupied.rows.length, 2);
console.log('BA Training sheet and manual confirmation checks passed.');
