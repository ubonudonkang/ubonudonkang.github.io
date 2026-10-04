/**
 * BA Bridge enrolment endpoint and manual Selar confirmation screen.
 *
 * Deploy this as a Google Apps Script web app. It accepts the website's
 * action=signup requests, records every enrolment as Awaiting payment, and
 * emails the owner a review link. The review link only displays a record; a
 * separate POST button is required to mark a payment as confirmed.
 */
var SPREADSHEET_ID = '1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk';
var SHEET_GID = 0;
var NOTIFY_EMAIL = 'ubonanalyst@gmail.com';
var COHORT_NAME = 'November 2026';
var EXPECTED_AMOUNT_NGN = 80000;
var FIELDS = [
  ['timestamp', 'Timestamp'], ['reference', 'Reference'], ['name', 'Full name'],
  ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['location', 'City and country'],
  ['background', 'Background'], ['experience', 'Years experience'],
  ['stage', 'Stage of transition'], ['wants', 'What they want most'],
  ['blocker', 'Biggest blocker'], ['format', 'Preferred format'],
  ['availability', 'Availability'], ['can_start', 'Can start'],
  ['source', 'Heard about it via'], ['consent', 'Consent given'],
  ['amount', 'Amount'], ['payment_status', 'Payment status'],
  ['sender_name', 'Sender name'], ['payment_ref', 'Transfer ref'],
  ['declared_at', 'Declared at'], ['verified', 'Verified by you'],
  ['squad_ref', 'Squad transaction ref'], ['amount_paid', 'Amount paid (NGN)'],
  ['paid_at', 'Paid at'], ['squad_status', 'Squad status'],
  ['selar_sale_reference', 'Selar sale reference'],
  ['confirm_token', 'Confirmation token'],
  ['confirmed_at', 'Confirmed at'], ['confirmed_by', 'Confirmed by'],
  ['cohort', 'Cohort']
];
var COL = {};
FIELDS.forEach(function(field, index) { COL[field[0]] = index + 1; });

function doPost(e) {
  var data = (e && e.parameter) || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_();
    if (data.action === 'confirm') return confirmPayment_(sheet, data);
    if (data.action === 'signup') {
      if (data.company) return json_({ result: 'ok' });
      return createSignup_(sheet, data);
    }
    return json_({ result: 'error', message: 'Unsupported action.' });
  } catch (err) {
    return json_({ result: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var data = (e && e.parameter) || {};
  if (data.action !== 'review') return json_({ result: 'ok', message: 'BA Bridge endpoint is online.' });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return reviewPage_(getSheet_(), data);
  } catch (err) {
    return page_('Unable to review payment', '<p>This review link is invalid or has expired.</p>');
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetById(SHEET_GID);
  if (!sheet) throw new Error('BA Training tab not found.');
  ensureHeader_(sheet);
  return sheet;
}

function ensureHeader_(sheet) {
  var labels = FIELDS.map(function(field) { return field[1]; });
  if (sheet.getLastRow() === 0) {
    ensureColumns_(sheet, labels.length);
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
    sheet.setFrozenRows(1);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var check = 0; check < 26; check++) {
    if (String(existing[check]).trim() !== labels[check]) {
      throw new Error('BA Training header mismatch at column ' + (check + 1) + ': expected ' + labels[check]);
    }
  }
  ensureColumns_(sheet, labels.length);
  for (var extra = 26; extra < Math.min(existing.length, labels.length); extra++) {
    if (existing[extra] && existing[extra] !== labels[extra]) {
      throw new Error('Unexpected extra column at ' + (extra + 1) + '. Review the sheet before deployment.');
    }
    if (!existing[extra]) {
      if (columnHasData_(sheet, extra + 1)) throw new Error('Unlabelled data in column ' + (extra + 1) + '. Review the sheet before deployment.');
      sheet.getRange(1, extra + 1).setValue(labels[extra]);
    }
  }
  for (var i = existing.length; i < labels.length; i++) {
    if (columnHasData_(sheet, i + 1)) throw new Error('Unlabelled data in column ' + (i + 1) + '. Review the sheet before deployment.');
    sheet.getRange(1, i + 1).setValue(labels[i]);
  }
  sheet.setFrozenRows(1);
}

function ensureColumns_(sheet, needed) {
  var available = sheet.getMaxColumns();
  if (available < needed) sheet.insertColumnsAfter(available, needed - available);
}

function columnHasData_(sheet, column) {
  if (sheet.getLastRow() < 2) return false;
  return sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getValues().some(function(row) { return row[0] !== ''; });
}

function createSignup_(sheet, data) {
  if (!data.reference || !data.name || !data.email) throw new Error('Missing required enrolment details.');
  if (data.cohort !== COHORT_NAME) throw new Error('This cohort is not accepting enrolments.');
  if (!/^BAB-[A-Z0-9]+-[A-Z0-9]{3}$/.test(String(data.reference))) throw new Error('Invalid enrolment reference.');
  if (findByReference_(sheet, data.reference)) {
    // A browser CORS retry can send the same request twice.
    return json_({ result: 'ok', reference: data.reference });
  }
  var token = Utilities.getUuid();
  var now = stamp_();
  var row = FIELDS.map(function(field) {
    var key = field[0];
    if (key === 'timestamp') return now;
    if (key === 'amount') return EXPECTED_AMOUNT_NGN;
    if (key === 'cohort') return COHORT_NAME;
    if (key === 'payment_status') return 'Awaiting payment';
    if (key === 'verified') return 'No';
    if (key === 'confirm_token') return token;
    return safeCellText_(data[key]);
  });
  sheet.appendRow(row);
  try { sendReviewEmail_(data, token); } catch (ignore) { /* saved enrolment remains in the sheet */ }
  return json_({ result: 'ok', reference: data.reference });
}

function safeCellText_(value) {
  var text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function reviewPage_(sheet, data) {
  var found = findByReference_(sheet, data.reference);
  if (!found || !data.token || found.values[COL.confirm_token - 1] !== data.token) throw new Error('Invalid confirmation link.');
  var values = found.values;
  var details = '<dl>' +
    detail_('Reference', values[COL.reference - 1]) + detail_('Name', values[COL.name - 1]) +
    detail_('Email', values[COL.email - 1]) + detail_('WhatsApp', values[COL.whatsapp - 1]) +
    detail_('Cohort', values[COL.cohort - 1]) +
    detail_('Amount expected (NGN)', values[COL.amount - 1]) +
    detail_('Status', values[COL.payment_status - 1]) +
    '</dl>';
  if (values[COL.verified - 1] === 'Yes') return page_('Payment already confirmed', details + '<p>This enrolment was confirmed on ' + esc_(values[COL.confirmed_at - 1]) + '.</p>');
  var action = escAttr_(webAppUrl_());
  var form = '<p>Check the completed sale in Selar and match its buyer to this enrolment before continuing.</p>' +
    '<form method="post" action="' + action + '" target="_blank">' +
    hidden_('action', 'confirm') + hidden_('intent', 'confirm') + hidden_('reference', data.reference) + hidden_('token', data.token) +
    '<label>Selar sale reference (if shown)<input name="selar_sale_reference" autocomplete="off"></label>' +
    '<label>Amount paid in NGN (if shown)<input name="amount_paid" inputmode="decimal" autocomplete="off"></label>' +
    '<button type="submit">Confirm payment</button></form>' +
    '<p class="note">Opening this review link does not change the payment status.</p>';
  return page_('Review Selar payment', details + form);
}

function confirmPayment_(sheet, data) {
  if (data.intent !== 'confirm') return page_('Confirmation not completed', '<p>Please use the confirmation button from the review page.</p>');
  var found = findByReference_(sheet, data.reference);
  if (!found || !data.token || found.values[COL.confirm_token - 1] !== data.token) return page_('Confirmation not completed', '<p>This confirmation link is invalid.</p>');
  if (found.values[COL.verified - 1] === 'Yes') return page_('Payment already confirmed', '<p>' + esc_(data.reference) + ' is already marked as paid.</p>');
  var amountPaid = String(data.amount_paid || '').trim();
  if (amountPaid && !/^\d+(?:\.\d{1,2})?$/.test(amountPaid)) {
    return page_('Confirmation not completed', '<p>Enter the amount paid as a number, then reopen the review link.</p>');
  }
  sheet.getRange(found.row, COL.payment_status).setValue('Paid — manually confirmed');
  sheet.getRange(found.row, COL.verified).setValue('Yes');
  sheet.getRange(found.row, COL.selar_sale_reference).setValue(safeCellText_(String(data.selar_sale_reference || '').trim()));
  if (amountPaid) sheet.getRange(found.row, COL.amount_paid).setValue(Number(amountPaid));
  sheet.getRange(found.row, COL.confirmed_at).setValue(stamp_());
  sheet.getRange(found.row, COL.confirmed_by).setValue(NOTIFY_EMAIL);
  return page_('Payment confirmed', '<p>' + esc_(data.reference) + ' is now marked as paid in the enrolment sheet.</p>');
}

function findByReference_(sheet, reference) {
  if (!reference || sheet.getLastRow() < 2) return null;
  var refs = sheet.getRange(2, COL.reference, sheet.getLastRow() - 1, 1).getValues();
  for (var i = refs.length - 1; i >= 0; i--) {
    if (String(refs[i][0]).trim() === String(reference).trim()) {
      var row = i + 2;
      return { row: row, values: sheet.getRange(row, 1, 1, FIELDS.length).getValues()[0] };
    }
  }
  return null;
}

function sendReviewEmail_(data, token) {
  var reviewUrl = webAppUrl_() + '?action=review&reference=' + encodeURIComponent(data.reference) + '&token=' + encodeURIComponent(token);
  var subject = '[BA Bridge] Review Selar payment: ' + data.name + ' (' + data.reference + ')';
  var html = '<p>A BA Bridge enrolment is awaiting payment review.</p>' +
    '<p><strong>' + esc_(data.name) + '</strong><br>' + esc_(data.email) + '<br>Cohort: ' + esc_(COHORT_NAME) + '<br>Reference: ' + esc_(data.reference) + '<br>Amount: ₦' + EXPECTED_AMOUNT_NGN.toLocaleString('en-NG') + '</p>' +
    '<p><a class="button" href="' + escAttr_(reviewUrl) + '">Review &amp; confirm payment</a></p>' +
    '<p>This link only opens a review screen. It does not confirm a payment by itself.</p>';
  MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: subject, body: 'Review payment: ' + reviewUrl, htmlBody: emailHtml_(html) });
}

function webAppUrl_() {
  var url = ScriptApp.getService().getUrl();
  if (!url) throw new Error('Deploy this script as a web app before accepting enrolments.');
  return url;
}
function stamp_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function hidden_(name, value) { return '<input type="hidden" name="' + escAttr_(name) + '" value="' + escAttr_(value) + '">'; }
function detail_(name, value) { return '<dt>' + esc_(name) + '</dt><dd>' + esc_(value) + '</dd>'; }
function esc_(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escAttr_(value) { return esc_(value); }
function emailHtml_(body) { return '<!doctype html><html><head><style>body{font:16px Arial;color:#111}.button{display:inline-block;padding:12px 18px;background:#1F3BD6;color:#fff;text-decoration:none;border-radius:6px}</style></head><body>' + body + '</body></html>'; }
function page_(title, body) { return HtmlService.createHtmlOutput('<!doctype html><html><head><base target="_top"><style>body{max-width:640px;margin:48px auto;padding:0 20px;font:16px Arial;color:#111}dl{display:grid;grid-template-columns:160px 1fr;gap:8px;border-top:1px solid #ddd;padding-top:16px}dt{font-weight:bold}dd{margin:0}label{display:block;margin:16px 0}input{display:block;padding:8px;width:100%;max-width:320px}button{padding:12px 18px;border:0;border-radius:6px;background:#1F3BD6;color:#fff;font:inherit;cursor:pointer}.note{color:#555}</style></head><body><h1>' + esc_(title) + '</h1>' + body + '</body></html>').setTitle(title); }
