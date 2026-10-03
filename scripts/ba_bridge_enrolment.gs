/**
 * BA Bridge enrolment endpoint and manual Selar confirmation screen.
 *
 * Deploy this as a Google Apps Script web app. It accepts the website's
 * action=signup requests, records every enrolment as Awaiting payment, and
 * emails the owner a review link. The review link only displays a record; a
 * separate POST button is required to mark a payment as confirmed.
 */
var SHEET_NAME = 'BA Bridge enrolments';
var NOTIFY_EMAIL = 'ubonanalyst@gmail.com';
var FIELDS = [
  ['submitted_at', 'Submitted at'], ['reference', 'Reference'], ['name', 'Name'],
  ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['background', 'Background'],
  ['wants', 'What they want'], ['availability', 'Availability'], ['budget', 'Budget'],
  ['source', 'Source'], ['consent', 'Consent'], ['amount', 'Amount'],
  ['payment_status', 'Payment status'], ['sender_name', 'Sender name'],
  ['payment_ref', 'Payment reference'], ['declared_at', 'Declared at'],
  ['verified', 'Verified'], ['confirm_token', 'Confirmation token'],
  ['confirmed_at', 'Confirmed at'], ['confirmed_by', 'Confirmed by']
];

function doPost(e) {
  var data = (e && e.parameter) || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_();
    if (data.action === 'signup') return createSignup_(sheet, data);
    if (data.action === 'confirm') return confirmPayment_(sheet, data);
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  ensureHeader_(sheet);
  return sheet;
}

function ensureHeader_(sheet) {
  var labels = FIELDS.map(function(field) { return field[1]; });
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
    sheet.setFrozenRows(1);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = existing.length; i < labels.length; i++) sheet.getRange(1, i + 1).setValue(labels[i]);
  sheet.setFrozenRows(1);
}

function createSignup_(sheet, data) {
  if (!data.reference || !data.name || !data.email) throw new Error('Missing required enrolment details.');
  var token = Utilities.getUuid();
  var now = stamp_();
  var row = FIELDS.map(function(field) {
    var key = field[0];
    if (key === 'submitted_at') return now;
    if (key === 'payment_status') return 'Awaiting payment';
    if (key === 'verified') return 'No';
    if (key === 'confirm_token') return token;
    return data[key] || '';
  });
  sheet.appendRow(row);
  sendReviewEmail_(data, token);
  return json_({ result: 'ok', reference: data.reference });
}

function reviewPage_(sheet, data) {
  var found = findByReference_(sheet, data.reference);
  if (!found || found.values[17] !== data.token) throw new Error('Invalid confirmation link.');
  var values = found.values;
  var details = '<dl>' +
    detail_('Reference', values[1]) + detail_('Name', values[2]) + detail_('Email', values[3]) +
    detail_('WhatsApp', values[4]) + detail_('Amount', values[11]) + detail_('Status', values[12]) +
    '</dl>';
  if (values[16] === 'Yes') return page_('Payment already confirmed', details + '<p>This enrolment was confirmed on ' + esc_(values[18]) + '.</p>');
  var action = escAttr_(webAppUrl_());
  var form = '<p>Check the Selar sale and the enrolment reference before continuing.</p>' +
    '<form method="post" action="' + action + '">' +
    hidden_('action', 'confirm') + hidden_('intent', 'confirm') + hidden_('reference', data.reference) + hidden_('token', data.token) +
    '<button type="submit">Confirm payment</button></form>' +
    '<p class="note">Opening this review link does not change the payment status.</p>';
  return page_('Review Selar payment', details + form);
}

function confirmPayment_(sheet, data) {
  if (data.intent !== 'confirm') return page_('Confirmation not completed', '<p>Please use the confirmation button from the review page.</p>');
  var found = findByReference_(sheet, data.reference);
  if (!found || found.values[17] !== data.token) return page_('Confirmation not completed', '<p>This confirmation link is invalid.</p>');
  if (found.values[16] === 'Yes') return page_('Payment already confirmed', '<p>' + esc_(data.reference) + ' is already marked as paid.</p>');
  sheet.getRange(found.row, 13).setValue('Paid — manually confirmed');
  sheet.getRange(found.row, 17).setValue('Yes');
  sheet.getRange(found.row, 19).setValue(stamp_());
  sheet.getRange(found.row, 20).setValue(NOTIFY_EMAIL);
  return page_('Payment confirmed', '<p>' + esc_(data.reference) + ' is now marked as paid in the enrolment sheet.</p>');
}

function findByReference_(sheet, reference) {
  if (!reference || sheet.getLastRow() < 2) return null;
  var matches = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).createTextFinder(reference).matchEntireCell(true).findAll();
  if (!matches.length) return null;
  var row = matches[matches.length - 1].getRow();
  return { row: row, values: sheet.getRange(row, 1, 1, FIELDS.length).getValues()[0] };
}

function sendReviewEmail_(data, token) {
  var reviewUrl = webAppUrl_() + '?action=review&reference=' + encodeURIComponent(data.reference) + '&token=' + encodeURIComponent(token);
  var subject = '[BA Bridge] Review Selar payment: ' + data.name + ' (' + data.reference + ')';
  var html = '<p>A BA Bridge enrolment is awaiting payment review.</p>' +
    '<p><strong>' + esc_(data.name) + '</strong><br>' + esc_(data.email) + '<br>Reference: ' + esc_(data.reference) + '<br>Amount: ₦80,000</p>' +
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
function page_(title, body) { return HtmlService.createHtmlOutput('<!doctype html><html><head><base target="_top"><style>body{max-width:640px;margin:48px auto;padding:0 20px;font:16px Arial;color:#111}dl{display:grid;grid-template-columns:130px 1fr;gap:8px;border-top:1px solid #ddd;padding-top:16px}dt{font-weight:bold}dd{margin:0}button{padding:12px 18px;border:0;border-radius:6px;background:#1F3BD6;color:#fff;font:inherit;cursor:pointer}.note{color:#555}</style></head><body><h1>' + esc_(title) + '</h1>' + body + '</body></html>').setTitle(title); }