/**
 * ubonudonkang.com forms: one Apps Script web app for every website form.
 * All data lives in tabs of the same workbook (SPREADSHEET_ID):
 *
 *   BA Training (gid 0)  action=signup               BA Bridge enrolment, payment review, Selar, welcome emails
 *   BA Bridge Invites    admin panel                 private one-time registration links
 *   Waitlist             form_name=ba-waitlist-*     cohort waitlist signups
 *   Contact              form_name=contact           contact page enquiries
 *
 * Keep this as the ONLY file in the Apps Script project. A second file that
 * declares the same top-level names (for example NOTIFY_EMAIL) stops the whole
 * project compiling, and every form then fails silently.
 *
 * Registration, private invites, offline enrolment, payment review,
 * Selar detection and welcome-email workflow.
 */

// ==================== CONFIG ====================

const SPREADSHEET_ID = '1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk';
const SHEET_GID = 0;
const INVITE_SHEET_NAME = 'BA Bridge Invites';

const NOTIFY_EMAIL = 'ubonanalyst@gmail.com';
// Waitlist signups and contact enquiries are announced here.
const SITE_NOTIFY_EMAIL = 'ubonudonkang@gmail.com';
const WELCOME_EMAIL_CC = 'alabioluwafunmito@gmail.com,ubonudonkang@gmail.com';
const EXPECTED_AMOUNT = 80000;

const BA_GROUP_PROPERTY = 'BA_BRIDGE_WHATSAPP_GROUP_URL';
const ADMIN_KEY_PROPERTY = 'BA_BRIDGE_ADMIN_KEY';
const SELAR_KEY_PROPERTY = 'BA_BRIDGE_SELAR_WEBHOOK_KEY';
const SELAR_PRODUCT_PROPERTY = 'BA_BRIDGE_SELAR_PRODUCT_MATCH';

const COHORT_REMINDER_CC = 'alabioluwafunmito@gmail.com';
const COHORT_REMINDER_LOG_PROPERTY = 'BA_BRIDGE_COHORT_WELCOME_REMINDER_SENT';

const WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycby94krvGfIS7mXVT-szoGHHM_pCLIU11Bh_AemMxE_nsK-X_Hm1y8yaK69zNKfU20LT/exec';

const FIELDS = [
  ['timestamp', 'Timestamp'],
  ['reference', 'Reference'],
  ['name', 'Full name'],
  ['email', 'Email'],
  ['whatsapp', 'WhatsApp'],
  ['location', 'City and country'],
  ['background', 'Background'],
  ['experience', 'Years experience'],
  ['stage', 'Stage of transition'],
  ['wants', 'What they want most'],
  ['blocker', 'Biggest blocker'],
  ['format', 'Preferred format'],
  ['availability', 'Availability'],
  ['can_start', 'Can start'],
  ['source', 'Heard about it via'],
  ['consent', 'Consent given'],
  ['amount', 'Amount'],
  ['payment_status', 'Payment status'],
  ['sender_name', 'Sender name'],
  ['payment_ref', 'Transfer ref'],
  ['declared_at', 'Declared at'],
  ['verified', 'Verified by you'],
  ['squad_ref', 'Squad transaction ref'],
  ['amount_paid', 'Amount paid (NGN)'],
  ['paid_at', 'Paid at'],
  ['squad_status', 'Squad status'],
  ['selar_sale_reference', 'Selar sale reference'],
  ['confirm_token', 'Confirmation token'],
  ['confirmed_at', 'Confirmed at'],
  ['confirmed_by', 'Confirmed by'],
  ['welcome_email_sent_at', 'Welcome email sent at'],
  ['welcome_email_error', 'Welcome email error'],
  ['review_email_sent_at', 'Review email sent at'],
  ['review_email_error', 'Review email error'],
  ['selar_amount', 'Selar amount'],
  ['selar_currency', 'Selar currency'],
  ['selar_status', 'Selar status'],
  ['selar_product', 'Selar product'],
  ['selar_webhook_received_at', 'Selar webhook received at']
];

const INVITE_HEADERS = [
  'Created at',
  'Token',
  'Name',
  'Email',
  'Status',
  'Used at',
  'Enrolment reference'
];

const COL = {};
FIELDS.forEach((f, i) => COL[f[0]] = i + 1);

/*
 * Simple form tabs. Columns are matched by heading, so an existing tab keeps
 * its own column order, and a missing heading is added on the right.
 * The Waitlist headings are the ones already in the live sheet.
 */
const FORM_TABS = {
  waitlist: {
    tab: 'Waitlist',
    fields: [
      ['timestamp', 'Timestamp'], ['form_name', 'Form'], ['name', 'name'],
      ['email', 'email'], ['cohort', 'cohort'], ['consent', 'consent'], ['type', 'type']
    ],
    required: ['name', 'email', 'cohort'],
    dedupeFields: ['email', 'cohort'],
    dedupeKey: values => normalizeEmail_(values.email) + '|' + String(values.cohort || '').trim().toLowerCase()
  },
  contact: {
    tab: 'Contact',
    fields: [
      ['timestamp', 'Timestamp'], ['first_name', 'First name'], ['last_name', 'Last name'],
      ['email', 'Email'], ['company', 'Company'], ['type', 'Engagement type'],
      ['message', 'Message'], ['submission_id', 'Submission ID']
    ],
    required: ['first_name', 'last_name', 'email', 'message'],
    dedupeFields: ['submission_id'],
    dedupeKey: values => String(values.submission_id || '').trim()
  }
};
const MAX_FIELD_LENGTH = 5000;

// ==================== ROUTES ====================

function doPost(e) {
  const data = parseRequest_(e);

  // Website forms that only add a row to their own tab.
  const formKind = formKindFor_(data);
  if (formKind) return handleFormPost_(formKind, data);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();

    switch (data.action) {
      case 'signup':
        if (data.company || data._gotcha) return json_({ result: 'ok' });
        return createSignup_(sheet, data);

      case 'admin_create_offline':
        return createOfflineSignup_(sheet, data);

      case 'admin_create_invite':
        return createInvite_(data);

      case 'invite_submit':
        return submitInviteRegistration_(sheet, data);

      case 'confirm':
        return confirmPayment_(sheet, data);

      case 'send_welcome':
        return retryWelcomeEmail_(sheet, data);

      case 'admin_send_review':
        return adminSendReview_(sheet, data);

      case 'selar_sale':
        return handleSelarSale_(sheet, data);

      default:
        return json_({ result: 'error', message: 'Unsupported action.' });
    }
  } catch (err) {
    console.error('BA Bridge POST error:', err);
    return page_('Unable to continue', '<p>' + esc_(String(err)) + '</p>');
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const data = (e && e.parameter) || {};
  const action = String(data.action || '').trim();

  if (!action) {
    return json_({ result: 'ok', message: 'BA Bridge endpoint is online.' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();

    switch (action) {
      case 'review':
        return reviewPage_(sheet, data);

      case 'admin':
        return adminPage_(sheet, data);

      case 'admin_offline_new':
        return offlineRegistrationPage_(data);

      case 'invite':
        return inviteRegistrationPage_(data);

      default:
        return json_({ result: 'error', message: 'Unsupported action.' });
    }
  } catch (err) {
    console.error('BA Bridge GET error:', err);
    return page_('Unable to continue', '<p>' + esc_(String(err)) + '</p>');
  } finally {
    lock.releaseLock();
  }
}

// ==================== REQUEST PARSING ====================

function parseRequest_(e) {
  const out = Object.assign({}, (e && e.parameter) || {});

  if (!e || !e.postData || !e.postData.contents) return out;

  const raw = String(e.postData.contents || '').trim();
  const type = String(e.postData.type || '').toLowerCase();

  if (!raw || (type.indexOf('application/json') === -1 && raw[0] !== '{')) {
    return out;
  }

  try {
    const parsed = JSON.parse(raw);
    mergeObject_(out, parsed);

    if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
      mergeObject_(out, parsed.data);
    }
  } catch (ignore) {}

  return out;
}

function mergeObject_(target, source) {
  if (!source || typeof source !== 'object') return target;

  Object.keys(source).forEach(key => {
    if (typeof target[key] === 'undefined' || target[key] === '') {
      target[key] = source[key];
    }
  });

  return target;
}

// ==================== WEBSITE FORMS: WAITLIST AND CONTACT ====================

function formKindFor_(data) {
  const name = String(data.form_name || '');
  if (name === 'contact') return 'contact';
  if (/^ba-waitlist-/.test(name)) return 'waitlist';
  return '';
}

function handleFormPost_(kind, data) {
  // Honeypot: bots fill the hidden field. Answer ok so they do not retry.
  if (data._gotcha) return json_({ result: 'ok' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    return saveFormRow_(kind, data);
  } catch (err) {
    console.error('Website form error (' + kind + '):', err);
    return json_({ result: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function saveFormRow_(kind, data) {
  const def = FORM_TABS[kind];
  const values = {};

  def.fields.forEach(field => {
    const key = field[0];
    const text = String(data[key] == null ? '' : data[key]).trim();
    if (text.length > MAX_FIELD_LENGTH) throw new Error('A field is too long.');
    values[key] = text;
  });

  def.required.forEach(key => {
    if (!values[key]) throw new Error('Missing required field: ' + key);
  });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    throw new Error('Enter a valid email address.');
  }

  if (kind === 'waitlist' && values.consent !== 'Yes') {
    throw new Error('Consent is required.');
  }

  const tab = getFormTab_(def);
  const key = def.dedupeKey(values);

  // A repeat signup, or a browser retry of the same request, is not saved twice.
  if (key && formRowExists_(tab, def, key)) return json_({ result: 'ok', duplicate: true });

  const cells = tab.header.map(label => {
    const field = def.fields.filter(f => f[1] === label)[0];
    if (!field) return '';
    if (field[0] === 'timestamp') return new Date();
    return safeCellText_(values[field[0]]);
  });

  tab.sheet.appendRow(cells);

  try {
    sendFormEmail_(kind, values, tab.sheet.getLastRow() - 1);
  } catch (ignore) {
    // The saved row is the record; a mail failure must not lose the submission.
  }

  return json_({ result: 'ok' });
}

function getFormTab_(def) {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = book.getSheetByName(def.tab) || book.insertSheet(def.tab);
  const labels = def.fields.map(f => f[1]);

  if (sheet.getLastRow() === 0) {
    ensureColumns_(sheet, labels.length);
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
    sheet.setFrozenRows(1);
  }

  const header = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(v => String(v).trim());

  labels.forEach(label => {
    if (header.indexOf(label) === -1) {
      ensureColumns_(sheet, header.length + 1);
      sheet.getRange(1, header.length + 1).setValue(label);
      header.push(label);
    }
  });

  return { sheet, header };
}

function formRowExists_(tab, def, key) {
  if (tab.sheet.getLastRow() < 2) return false;

  const index = {};
  def.dedupeFields.forEach(name => {
    const label = def.fields.filter(f => f[0] === name)[0][1];
    index[name] = tab.header.indexOf(label);
  });

  return tab.sheet
    .getRange(2, 1, tab.sheet.getLastRow() - 1, tab.header.length)
    .getValues()
    .some(row => {
      const probe = {};
      def.dedupeFields.forEach(name => {
        probe[name] = String(row[index[name]] == null ? '' : row[index[name]]).replace(/^'/, '');
      });
      return def.dedupeKey(probe) === key;
    });
}

function sendFormEmail_(kind, values, total) {
  if (kind === 'waitlist') {
    MailApp.sendEmail(
      SITE_NOTIFY_EMAIL,
      'New waitlist signup: ' + (values.name || values.email) + ' (' + total + ' total)',
      'name: ' + values.name + '\nemail: ' + values.email + '\ncohort: ' + values.cohort +
      '\nconsent: ' + values.consent + '\ntype: ' + values.type +
      '\n\nTotal on waitlist: ' + total
    );
    return;
  }

  const who = values.first_name + ' ' + values.last_name;

  MailApp.sendEmail({
    to: SITE_NOTIFY_EMAIL,
    subject: '[Contact] ' + (values.type || 'Enquiry') + ': ' + who,
    body: who + ' <' + values.email + '>\n' +
      (values.company ? values.company + '\n' : '') +
      'Type: ' + (values.type || 'not given') + '\n\n' + values.message,
    replyTo: values.email,
    name: 'ubonudonkang.com'
  });
}

// ==================== PUBLIC SIGNUP ====================

function createSignup_(sheet, data) {
  if (!data.reference || !data.name || !data.email) {
    throw new Error('Missing required enrolment details.');
  }

  if (!/^BAB-[A-Z0-9]+-[A-Z0-9]{3}$/.test(String(data.reference))) {
    throw new Error('Invalid enrolment reference.');
  }

  if (findByReference_(sheet, data.reference)) {
    return json_({
      result: 'ok',
      reference: data.reference,
      duplicate: true
    });
  }

  const values = Object.assign({}, data, {
    timestamp: stamp_(),
    amount: EXPECTED_AMOUNT,
    payment_status: 'Awaiting payment',
    verified: 'No',
    confirm_token: Utilities.getUuid()
  });

  appendMappedRow_(sheet, values);
  SpreadsheetApp.flush();

  return json_({
    result: 'ok',
    reference: data.reference
  });
}

// ==================== ADMIN PANEL ====================

function adminPage_(sheet, data) {
  requireAdminKey_(data.key);

  const query = String(data.q || '').trim().toLowerCase();
  const rows = [];

  for (let row = sheet.getLastRow(); row >= 2 && rows.length < 100; row--) {
    const values = getRow_(sheet, row);
    const reference = cell_(values, 'reference');
    const name = cell_(values, 'name');
    const email = cell_(values, 'email');

    if (!reference) continue;

    const searchable = (reference + ' ' + name + ' ' + email).toLowerCase();
    if (query && searchable.indexOf(query) === -1) continue;

    rows.push({ row, values });
  }

  const inviteSheet = getInviteSheet_();
  const inviteRows = [];

  for (
    let row = inviteSheet.getLastRow();
    row >= 2 && inviteRows.length < 50;
    row--
  ) {
    inviteRows.push(inviteRowObject_(inviteSheet, row));
  }

  const addOffline = `
    <form method="get" action="${escAttr_(webAppUrl_())}" style="margin:0">
      ${hidden_('action', 'admin_offline_new')}
      ${hidden_('key', data.key)}
      <button type="submit">+ Add Offline Enrollee</button>
    </form>`;

  const createInvite = `
    <div class="card">
      <h2>Create Registration Invite</h2>
      <p class="note">Generate a private one-time registration link for an intended participant.</p>

      <form method="post" action="${escAttr_(webAppUrl_())}">
        ${hidden_('action', 'admin_create_invite')}
        ${hidden_('key', data.key)}

        <div class="grid2">
          <label>
            Full name
            <input name="name" required>
          </label>

          <label>
            Email address
            <input type="email" name="email" required>
          </label>
        </div>

        <button type="submit">Create invite link</button>
      </form>
    </div>`;

  let invites = `
    <div class="card">
      <h2>Registration Invites</h2>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th>Reference</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>`;

  inviteRows.forEach((invite, i) => {
    const link = inviteUrl_(invite.token);

    invites += `
      <tr>
        <td>${esc_(invite.name)}</td>
        <td>${esc_(invite.email)}</td>
        <td>${esc_(invite.status)}</td>
        <td>${esc_(invite.createdAt)}</td>
        <td>${esc_(invite.reference)}</td>
        <td>
          ${
            invite.status === 'Unused'
              ? `<button type="button" onclick="copyInvite('invite${i}')">Copy invite link</button>
                 <input id="invite${i}" type="text" value="${escAttr_(link)}" style="position:absolute;left:-9999px">`
              : 'Used'
          }
        </td>
      </tr>`;
  });

  invites += `
          </tbody>
        </table>
      </div>
    </div>`;

  if (!inviteRows.length) {
    invites = `
      <div class="card">
        <h2>Registration Invites</h2>
        <p>No private invites created yet.</p>
      </div>`;
  }

  const search = `
    <form method="get" action="${escAttr_(webAppUrl_())}" class="search">
      ${hidden_('action', 'admin')}
      ${hidden_('key', data.key)}
      <input name="q" value="${escAttr_(data.q || '')}" placeholder="Search name, email or reference">
      <button type="submit">Search</button>
    </form>`;

  let table = `
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Reference</th>
            <th>Payment</th>
            <th>Selar</th>
            <th>Verified</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>`;

  rows.forEach(found => {
    const v = found.values;
    const reference = cell_(v, 'reference');

    table += `
      <tr>
        <td>${esc_(cell_(v, 'name'))}</td>
        <td>${esc_(cell_(v, 'email'))}</td>
        <td>${esc_(reference)}</td>
        <td>${esc_(cell_(v, 'payment_status'))}</td>
        <td>${esc_(cell_(v, 'selar_status'))}</td>
        <td>${esc_(cell_(v, 'verified'))}</td>
        <td>
          <form method="post" action="${escAttr_(webAppUrl_())}">
            ${hidden_('action', 'admin_send_review')}
            ${hidden_('key', data.key)}
            ${hidden_('reference', reference)}
            <button type="submit">Send review email</button>
          </form>
        </td>
      </tr>`;
  });

  table += '</tbody></table></div>';

  if (!rows.length) table = '<p>No matching enrolments found.</p>';

  const script = `
    <script>
      function copyInvite(id){
        var input=document.getElementById(id);
        navigator.clipboard.writeText(input.value).then(function(){
          alert('Invite link copied');
        });
      }
    </script>`;

  return page_(
    'BA Bridge Admin',
    `
      <div class="toolbar">${addOffline}</div>
      ${createInvite}
      ${invites}

      <div class="card">
        <h2>Enrolments</h2>
        ${search}
        ${table}
      </div>

      <p class="note">Keep this Admin URL private.</p>
      ${script}
    `
  );
}

// ==================== CREATE PRIVATE INVITE ====================

function createInvite_(data) {
  requireAdminKey_(data.key);

  const name = String(data.name || '').trim();
  const email = normalizeEmail_(data.email);

  if (!name || !email) {
    throw new Error('Name and email are required.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }

  const inviteSheet = getInviteSheet_();
  const existing = findUnusedInviteByEmail_(inviteSheet, email);

  let token;
  let link;

  if (existing) {
    token = existing.token;
    link = inviteUrl_(token);
  } else {
    token = randomKey_();
    inviteSheet.appendRow([
      stamp_(),
      token,
      safeCellText_(name),
      safeCellText_(email),
      'Unused',
      '',
      ''
    ]);

    link = inviteUrl_(token);
  }

  const body = `
    <p>The private registration link for <strong>${esc_(name)}</strong> is ready.</p>

    <label>
      Registration link
      <input id="inviteLink" value="${escAttr_(link)}" readonly>
    </label>

    <button type="button" onclick="copyInvite()">Copy invite link</button>

    <p class="note">
      The link is tied to ${esc_(email)} and can only be used once.
    </p>

    <p>
      <a href="${escAttr_(adminUrl_(data.key))}">Back to Admin panel</a>
    </p>

    <script>
      function copyInvite(){
        var input=document.getElementById('inviteLink');
        navigator.clipboard.writeText(input.value).then(function(){
          alert('Invite link copied');
        });
      }
    </script>`;

  return page_('Registration invite created', body);
}

// ==================== INVITEE REGISTRATION PAGE ====================

function inviteRegistrationPage_(data) {
  const token = String(data.token || '').trim();
  const inviteSheet = getInviteSheet_();
  const invite = findInviteByToken_(inviteSheet, token);

  if (!invite) {
    return page_(
      'Invalid invitation',
      '<p>This registration invitation is invalid.</p>'
    );
  }

  if (invite.status === 'Used') {
    return page_(
      'Invitation already used',
      `
        <p>This registration invitation has already been used.</p>
        ${
          invite.reference
            ? `<p>Enrolment reference: <strong>${esc_(invite.reference)}</strong></p>`
            : ''
        }
      `
    );
  }

  const questions = registrationFieldsHtml_({
    name: invite.name,
    email: invite.email,
    lockEmail: true
  });

  return page_(
    'BA Bridge Registration',
    `
      <p>
        Complete your details below to secure your private BA Bridge registration.
      </p>

      <form id="registrationForm" method="post" action="${escAttr_(webAppUrl_())}">
        ${hidden_('action', 'invite_submit')}
        ${hidden_('token', token)}
        ${questions}
        <div id="formError" class="error"></div>
        <button type="submit">Submit registration</button>
      </form>

      ${registrationFormScript_()}
    `
  );
}

// ==================== SUBMIT PRIVATE INVITE ====================

function submitInviteRegistration_(sheet, data) {
  const token = String(data.token || '').trim();
  const inviteSheet = getInviteSheet_();
  const invite = findInviteByToken_(inviteSheet, token);

  if (!invite) {
    throw new Error('Invalid registration invitation.');
  }

  if (invite.status === 'Used') {
    return page_(
      'Invitation already used',
      '<p>This registration invitation has already been used.</p>'
    );
  }

  data.email = invite.email;

  if (!String(data.name || '').trim()) {
    data.name = invite.name;
  }

  const reg = normalizeRegistration_(data);

  const existing = findByEmail_(sheet, reg.email, false);

  if (existing) {
    return page_(
      'Registration already exists',
      `
        <p>A BA Bridge registration already exists for <strong>${esc_(reg.email)}</strong>.</p>
        <p>Reference: <strong>${esc_(cell_(existing.values, 'reference'))}</strong></p>
      `
    );
  }

  const reference = generateEnrolmentReference_(sheet, 'INV');
  createEnrolment_(sheet, reg, reference);

  markInviteUsed_(inviteSheet, invite.row, reference);

  return page_(
    'Registration complete',
    `
      <p>Thank you, <strong>${esc_(reg.name)}</strong>.</p>
      <p>Your BA Bridge registration has been received successfully.</p>

      <dl>
        ${detail_('Reference', reference)}
        ${detail_('Email', reg.email)}
        ${detail_('Amount', '₦' + Number(EXPECTED_AMOUNT).toLocaleString())}
        ${detail_('Status', 'Awaiting payment')}
      </dl>

      <p>Please keep your enrolment reference for your records.</p>
    `
  );
}

// ==================== OFFLINE REGISTRATION ====================

function offlineRegistrationPage_(data) {
  requireAdminKey_(data.key);

  return page_(
    'Add Offline Enrollee',
    `
      <p>Use this form if you want to enter the participant's details yourself.</p>

      <form id="registrationForm" method="post" action="${escAttr_(webAppUrl_())}">
        ${hidden_('action', 'admin_create_offline')}
        ${hidden_('key', data.key)}
        ${registrationFieldsHtml_({})}
        <div id="formError" class="error"></div>
        <button type="submit">Create offline enrolment</button>
      </form>

      <p style="margin-top:24px;">
        <a href="${escAttr_(adminUrl_(data.key))}">Back to Admin panel</a>
      </p>

      ${registrationFormScript_()}
    `
  );
}

function createOfflineSignup_(sheet, data) {
  requireAdminKey_(data.key);

  const reg = normalizeRegistration_(data);

  const existing = findByEmail_(sheet, reg.email, false);

  if (existing) {
    return page_(
      'Enrolment already exists',
      `
        <p><strong>${esc_(cell_(existing.values, 'name'))}</strong> already has a BA Bridge registration.</p>
        <p>Email: <strong>${esc_(reg.email)}</strong></p>
        <p>Reference: <strong>${esc_(cell_(existing.values, 'reference'))}</strong></p>
        <p><a href="${escAttr_(adminUrl_(data.key))}">Back to Admin panel</a></p>
      `
    );
  }

  const reference = generateEnrolmentReference_(sheet, 'OFF');
  createEnrolment_(sheet, reg, reference);

  return page_(
    'Offline enrolment created',
    `
      <p><strong>${esc_(reg.name)}</strong> has been added to BA Bridge.</p>

      <dl>
        ${detail_('Reference', reference)}
        ${detail_('Email', reg.email)}
        ${detail_('Amount', '₦' + Number(EXPECTED_AMOUNT).toLocaleString())}
        ${detail_('Payment status', 'Awaiting payment')}
      </dl>

      <h2>Payment review</h2>
      <p>If the enrollee has already paid, click below.</p>

      <form method="post" action="${escAttr_(webAppUrl_())}">
        ${hidden_('action', 'admin_send_review')}
        ${hidden_('key', data.key)}
        ${hidden_('reference', reference)}
        <button type="submit">Send payment review email</button>
      </form>

      <p style="margin-top:24px;">
        <a href="${escAttr_(adminUrl_(data.key))}">Back to Admin panel</a>
      </p>
    `
  );
}

// ==================== SHARED REGISTRATION FORM ====================

function registrationFieldsHtml_(defaults) {
  defaults = defaults || {};

  const name = defaults.name || '';
  const email = defaults.email || '';
  const emailLock = defaults.lockEmail ? 'readonly' : '';

  return `
    <label>
      Full name *
      <input name="name" value="${escAttr_(name)}" required autocomplete="name">
    </label>

    <label>
      Email address *
      <input type="email" name="email" value="${escAttr_(email)}" ${emailLock} required autocomplete="email">
    </label>

    <label>
      WhatsApp number *
      <input name="whatsapp" required placeholder="Include country code where applicable">
    </label>

    <label>
      City and country *
      <input name="location" required placeholder="e.g. Lagos, Nigeria">
    </label>

    <label>
      Current background *
      <select name="background" id="background" required onchange="toggleOther('background')">
        <option value="">Select</option>
        ${option_('Student or recent graduate')}
        ${option_('Academic or market research')}
        ${option_('Banking, finance, or insurance')}
        ${option_('Operations, admin, or customer service')}
        ${option_('Tech, but not in a BA role')}
        ${option_('Working BA looking to level up')}
        ${option_('Other')}
      </select>
    </label>

    <div id="background_other_wrap" style="display:none">
      <label>
        Other background *
        <input name="background_other" id="background_other">
      </label>
    </div>

    <label>
      Years of work experience *
      <select name="experience" required>
        <option value="">Select</option>
        ${option_('0 to 1')}
        ${option_('2 to 4')}
        ${option_('5 to 9')}
        ${option_('10+')}
      </select>
    </label>

    <label>
      Stage of transition *
      <select name="stage" required>
        <option value="">Select</option>
        ${option_('Just exploring whether BA is right for me')}
        ${option_('Decided on BA, need structured training')}
        ${option_('Already doing some BA-type work informally')}
        ${option_('Currently a BA, want to get stronger')}
      </select>
    </label>

    <fieldset>
      <legend>What they most want *</legend>
      <p class="note">Pick 1 to 3.</p>

      ${wantCheckbox_('want_jobready', 'Practical, job-ready skills')}
      ${wantCheckbox_('want_portfolio', 'A portfolio project to show employers')}
      ${wantCheckbox_('want_certification', 'Certification prep (ECBA / CCBA)')}
      ${wantCheckbox_('want_careerprep', 'CV, LinkedIn, and interview prep')}
      ${wantCheckbox_('want_mentor', 'Mentorship from a practising BA')}
      ${wantCheckbox_('want_networking', 'Networking and job leads')}
      ${wantCheckbox_('want_other', 'Other', true)}

      <div id="want_other_wrap" style="display:none">
        <label>
          Other goal *
          <input name="want_other_text" id="want_other_text">
        </label>
      </div>
    </fieldset>

    <fieldset>
      <legend>Live-session availability *</legend>
      <p class="note">Pick at least one.</p>

      ${availabilityCheckbox_('avail_weekday', 'Weekday evenings')}
      ${availabilityCheckbox_('avail_sat_am', 'Saturday mornings')}
      ${availabilityCheckbox_('avail_sat_pm', 'Saturday afternoons')}
      ${availabilityCheckbox_('avail_sun_pm', 'Sunday afternoons')}
    </fieldset>

    <label>
      Heard about the training via *
      <select name="source" id="source" required onchange="toggleOther('source')">
        <option value="">Select</option>
        ${option_('LinkedIn')}
        ${option_('X (Twitter)')}
        ${option_('WhatsApp')}
        ${option_('Referral from a friend or colleague')}
        ${option_('Other')}
      </select>
    </label>

    <div id="source_other_wrap" style="display:none">
      <label>
        Other source *
        <input name="source_other" id="source_other">
      </label>
    </div>

    <label class="checkboxLabel">
      <input type="checkbox" name="consent" value="yes" required>
      I consent to my details being used for BA Bridge registration, training communication and cohort administration.
    </label>
  `;
}

function registrationFormScript_() {
  return `
    <script>
      function toggleOther(type){
        var select=document.getElementById(type);
        var wrap=document.getElementById(type+'_other_wrap');
        var input=document.getElementById(type+'_other');
        var show=select.value==='Other';
        wrap.style.display=show?'block':'none';
        input.required=show;
        if(!show) input.value='';
      }

      function toggleWantOther(){
        var box=document.getElementById('want_other');
        var wrap=document.getElementById('want_other_wrap');
        var input=document.getElementById('want_other_text');
        wrap.style.display=box.checked?'block':'none';
        input.required=box.checked;
        if(!box.checked) input.value='';
      }

      document.getElementById('registrationForm').addEventListener('submit',function(e){
        var error=document.getElementById('formError');
        var wants=document.querySelectorAll('.wantOption:checked');
        var availability=document.querySelectorAll('.availabilityOption:checked');

        error.textContent='';

        if(wants.length<1||wants.length>3){
          e.preventDefault();
          error.textContent='Select between 1 and 3 options under What they most want.';
          return;
        }

        if(availability.length<1){
          e.preventDefault();
          error.textContent='Select at least one live-session availability option.';
        }
      });
    </script>
  `;
}

// ==================== NORMALISE REGISTRATION ====================

function normalizeRegistration_(data) {
  const required = [
    'name',
    'email',
    'whatsapp',
    'location',
    'background',
    'experience',
    'stage',
    'source'
  ];

  required.forEach(key => {
    if (!String(data[key] || '').trim()) {
      throw new Error('Please complete all required registration fields.');
    }
  });

  const email = normalizeEmail_(data.email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }

  if (data.consent !== 'yes') {
    throw new Error('Consent is required.');
  }

  let background = String(data.background).trim();

  if (background === 'Other') {
    const other = String(data.background_other || '').trim();
    if (!other) throw new Error('Enter the Other background.');
    background = 'Other: ' + other;
  }

  const wants = [];

  if (data.want_jobready) wants.push('Practical, job-ready skills');
  if (data.want_portfolio) wants.push('A portfolio project to show employers');
  if (data.want_certification) wants.push('Certification prep (ECBA / CCBA)');
  if (data.want_careerprep) wants.push('CV, LinkedIn, and interview prep');
  if (data.want_mentor) wants.push('Mentorship from a practising BA');
  if (data.want_networking) wants.push('Networking and job leads');

  if (data.want_other) {
    const other = String(data.want_other_text || '').trim();
    if (!other) throw new Error('Enter the Other goal.');
    wants.push('Other: ' + other);
  }

  if (wants.length < 1 || wants.length > 3) {
    throw new Error('Select between 1 and 3 options under What they most want.');
  }

  const availability = [];

  if (data.avail_weekday) availability.push('Weekday evenings');
  if (data.avail_sat_am) availability.push('Saturday mornings');
  if (data.avail_sat_pm) availability.push('Saturday afternoons');
  if (data.avail_sun_pm) availability.push('Sunday afternoons');

  if (!availability.length) {
    throw new Error('Select at least one live-session availability option.');
  }

  let source = String(data.source).trim();

  if (source === 'Other') {
    const other = String(data.source_other || '').trim();
    if (!other) throw new Error('Enter how they heard about the training.');
    source = 'Other: ' + other;
  }

  return {
    name: String(data.name).trim(),
    email,
    whatsapp: String(data.whatsapp).trim(),
    location: String(data.location).trim(),
    background,
    experience: String(data.experience).trim(),
    stage: String(data.stage).trim(),
    wants: wants.join(', '),
    availability: availability.join(', '),
    source
  };
}

function createEnrolment_(sheet, reg, reference) {
  const values = {
    timestamp: stamp_(),
    reference,
    name: reg.name,
    email: reg.email,
    whatsapp: reg.whatsapp,
    location: reg.location,
    background: reg.background,
    experience: reg.experience,
    stage: reg.stage,
    wants: reg.wants,
    blocker: '',
    format: '',
    availability: reg.availability,
    can_start: '',
    source: reg.source,
    consent: 'Yes',
    amount: EXPECTED_AMOUNT,
    payment_status: 'Awaiting payment',
    verified: 'No',
    confirm_token: Utilities.getUuid()
  };

  appendMappedRow_(sheet, values);
  SpreadsheetApp.flush();

  const found = findByReference_(sheet, reference);

  if (!found) {
    throw new Error('Registration was created but could not be retrieved.');
  }

  return found;
}

function generateEnrolmentReference_(sheet, type) {
  for (let i = 0; i < 20; i++) {
    const time = Date.now().toString(36).toUpperCase().slice(-6);
    const random = Utilities.getUuid().replace(/-/g, '').slice(0, 3).toUpperCase();
    const reference = `BAB-${type}${time}-${random}`;

    if (!findByReference_(sheet, reference)) return reference;
  }

  throw new Error('Unable to generate a unique enrolment reference.');
}

// ==================== ADMIN REVIEW EMAIL ====================

function adminSendReview_(sheet, data) {
  requireAdminKey_(data.key);

  let found = findByReference_(sheet, data.reference);

  if (!found) {
    return page_('Not found', '<p>The enrolment could not be found.</p>');
  }

  found = ensureConfirmToken_(sheet, found);

  const delivery = sendReviewEmail_(sheet, found, {
    force: true,
    reason: 'Manual review requested from the BA Bridge Admin panel.'
  });

  const back = `<p><a href="${escAttr_(adminUrl_(data.key))}">Back to Admin panel</a></p>`;

  if (delivery.sent) {
    return page_(
      'Review email sent',
      `<p>The review email was sent to ${esc_(NOTIFY_EMAIL)} for <strong>${esc_(data.reference)}</strong>.</p>` +
      back
    );
  }

  return page_(
    'Email not sent',
    '<p>' + esc_(delivery.error || 'Unable to send the review email.') + '</p>' +
    back
  );
}

function sendReviewEmail_(sheet, found, options) {
  options = options || {};

  if (!found) {
    return { sent: false, error: 'Enrolment record was not found.' };
  }

  const v = found.values;

  if (!options.force && v[COL.review_email_sent_at - 1]) {
    return { alreadySent: true };
  }

  const reference = cell_(v, 'reference');
  const name = cell_(v, 'name');
  const email = cell_(v, 'email');
  const token = cell_(v, 'confirm_token');
  const amount = v[COL.amount - 1] || EXPECTED_AMOUNT;
  const paymentStatus = cell_(v, 'payment_status') || 'Not recorded';
  const squadStatus = cell_(v, 'squad_status') || 'Not recorded';
  const selarStatus = cell_(v, 'selar_status') || 'Not recorded';

  const reason =
    options.reason ||
    'Review this enrolment and confirm payment only after checking the payment platform.';

  try {
    if (!reference) throw new Error('Missing enrolment reference.');
    if (!token) throw new Error('Missing confirmation token.');

    if (MailApp.getRemainingDailyQuota() <= 0) {
      throw new Error('Google Apps Script email quota has been exhausted.');
    }

    const reviewUrl =
      `${webAppUrl_()}?action=review&reference=${encodeURIComponent(reference)}&token=${encodeURIComponent(token)}`;

    const subject =
      `[BA Bridge] Review payment: ${name} (${reference})`;

    const body =
      `A BA Bridge payment requires your review.\n\n` +
      `Name: ${name}\n` +
      `Email: ${email}\n` +
      `Reference: ${reference}\n` +
      `Expected amount: NGN ${amount}\n` +
      `Payment status: ${paymentStatus}\n` +
      `Squad status: ${squadStatus}\n` +
      `Selar status: ${selarStatus}\n\n` +
      `${reason}\n\n` +
      `Review & confirm payment:\n${reviewUrl}`;

    const html = `
      <p>A BA Bridge payment requires your review.</p>
      <p>
        <strong>${esc_(name)}</strong><br>
        ${esc_(email)}<br>
        Reference: ${esc_(reference)}<br>
        Expected amount: ₦${esc_(amount)}<br>
        Payment status: ${esc_(paymentStatus)}<br>
        Squad status: ${esc_(squadStatus)}<br>
        Selar status: ${esc_(selarStatus)}
      </p>
      <p>${esc_(reason)}</p>
      <p><a class="button" href="${escAttr_(reviewUrl)}">Review &amp; confirm payment</a></p>
      <p class="note">Opening this link does not confirm payment.</p>`;

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject,
      body,
      htmlBody: emailHtml_(html),
      name: 'BA Bridge'
    });

    setRowValue_(sheet, found.row, 'review_email_sent_at', stamp_());
    setRowValue_(sheet, found.row, 'review_email_error', '');

    return { sent: true };

  } catch (err) {
    const message = String(err).slice(0, 500);

    try {
      setRowValue_(sheet, found.row, 'review_email_error', message);
    } catch (ignore) {}

    return { sent: false, error: message };
  }
}

// ==================== PAYMENT REVIEW ====================

function reviewPage_(sheet, data) {
  const found = findByReference_(sheet, data.reference);

  if (
    !found ||
    !data.token ||
    cell_(found.values, 'confirm_token') !== String(data.token)
  ) {
    throw new Error('Invalid confirmation link.');
  }

  const v = found.values;

  const details = `
    <dl>
      ${detail_('Reference', cell_(v, 'reference'))}
      ${detail_('Name', cell_(v, 'name'))}
      ${detail_('Email', cell_(v, 'email'))}
      ${detail_('WhatsApp', cell_(v, 'whatsapp'))}
      ${detail_('Expected amount (NGN)', v[COL.amount - 1])}
      ${detail_('Payment status', cell_(v, 'payment_status'))}
      ${detail_('Squad status', cell_(v, 'squad_status'))}
      ${detail_('Selar status', cell_(v, 'selar_status'))}
      ${detail_('Selar sale reference', cell_(v, 'selar_sale_reference'))}
    </dl>`;

  if (cell_(v, 'verified') === 'Yes') {
    const sentAt = v[COL.welcome_email_sent_at - 1];

    const status = sentAt
      ? `<p>The welcome email was sent on ${esc_(sentAt)}.</p>`
      : `<p>The payment is confirmed, but the welcome email has not been recorded as sent.</p>
         ${retryWelcomeForm_(data.reference, data.token)}`;

    return page_(
      'Payment already confirmed',
      details +
      `<p>This enrolment was confirmed on ${esc_(v[COL.confirmed_at - 1])}.</p>` +
      status
    );
  }

  const amount = v[COL.amount_paid - 1] || EXPECTED_AMOUNT;

  return page_(
    'Review BA Bridge payment',
    details + `
      <p>Check the completed payment in Selar, Squad or your bank before confirming.</p>

      <form method="post" action="${escAttr_(webAppUrl_())}">
        ${hidden_('action', 'confirm')}
        ${hidden_('intent', 'confirm')}
        ${hidden_('reference', data.reference)}
        ${hidden_('token', data.token)}

        <label>
          Selar sale reference (optional)
          <input name="selar_sale_reference" value="${escAttr_(cell_(v, 'selar_sale_reference'))}">
        </label>

        <label>
          Amount paid in NGN
          <input name="amount_paid" inputmode="decimal" value="${escAttr_(amount)}">
        </label>

        <button type="submit">Confirm payment</button>
      </form>

      <p class="note">Only confirm after independently verifying the transaction.</p>
    `
  );
}

function confirmPayment_(sheet, data) {
  if (data.intent !== 'confirm') {
    return page_(
      'Confirmation not completed',
      '<p>Please use the confirmation button from the review page.</p>'
    );
  }

  const found = findByReference_(sheet, data.reference);

  if (
    !found ||
    !data.token ||
    cell_(found.values, 'confirm_token') !== String(data.token)
  ) {
    return page_(
      'Confirmation not completed',
      '<p>This confirmation link is invalid.</p>'
    );
  }

  if (cell_(found.values, 'verified') === 'Yes') {
    return page_(
      'Payment already confirmed',
      `<p>${esc_(data.reference)} is already marked as paid.</p>`
    );
  }

  const amountPaid = String(data.amount_paid || '').trim();

  if (
    amountPaid &&
    !/^\d+(?:\.\d{1,2})?$/.test(amountPaid)
  ) {
    return page_(
      'Confirmation not completed',
      '<p>Enter the amount paid as a valid number.</p>'
    );
  }

  setRowValue_(sheet, found.row, 'payment_status', 'Paid — manually confirmed');
  setRowValue_(sheet, found.row, 'verified', 'Yes');
  setRowValue_(sheet, found.row, 'confirmed_at', stamp_());
  setRowValue_(sheet, found.row, 'confirmed_by', NOTIFY_EMAIL);

  const selarRef = String(data.selar_sale_reference || '').trim();

  if (selarRef) {
    setRowValue_(sheet, found.row, 'selar_sale_reference', safeCellText_(selarRef));
  }

  if (amountPaid) {
    setRowValue_(sheet, found.row, 'amount_paid', Number(amountPaid));
  }

  SpreadsheetApp.flush();

  const refreshed = findByReference_(sheet, data.reference);
  const delivery = sendWelcomeEmail_(sheet, refreshed);

  let message =
    `<p>${esc_(data.reference)} is now marked as paid.</p>`;

  if (delivery.sent) {
    message +=
      `<p>The welcome email was sent to ${esc_(cell_(refreshed.values, 'email'))} ` +
      `and copied to ${esc_(WELCOME_EMAIL_CC)}.</p>`;
  } else if (delivery.alreadySent) {
    message += '<p>The welcome email had already been sent.</p>';
  } else {
    message +=
      '<p>The payment remains confirmed, but the welcome email could not be sent.</p>' +
      retryWelcomeForm_(data.reference, data.token);
  }

  return page_('Payment confirmed', message);
}

// ==================== WELCOME EMAIL ====================

function sendWelcomeEmail_(sheet, found) {
  if (!found) return { sent: false, error: 'Enrolment not found.' };

  if (found.values[COL.welcome_email_sent_at - 1]) {
    return { alreadySent: true };
  }

  const recipient = cell_(found.values, 'email');
  const name = cell_(found.values, 'name');
  const reference = cell_(found.values, 'reference');

  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new Error('Invalid student email address.');
    }

    const mail = welcomeEmail_(
      name,
      reference,
      configuredGroupUrl_()
    );

    mail.to = recipient;
    mail.cc = WELCOME_EMAIL_CC;

    MailApp.sendEmail(mail);

    setRowValue_(sheet, found.row, 'welcome_email_sent_at', stamp_());
    setRowValue_(sheet, found.row, 'welcome_email_error', '');

    return { sent: true };

  } catch (err) {
    const message = String(err).slice(0, 500);

    setRowValue_(sheet, found.row, 'welcome_email_error', message);

    return { sent: false, error: message };
  }
}

function retryWelcomeEmail_(sheet, data) {
  if (data.intent !== 'send_welcome') {
    return page_(
      'Email not sent',
      '<p>Please use the retry button from the review page.</p>'
    );
  }

  const found = findByReference_(sheet, data.reference);

  if (
    !found ||
    !data.token ||
    cell_(found.values, 'confirm_token') !== String(data.token)
  ) {
    return page_(
      'Email not sent',
      '<p>This confirmation link is invalid.</p>'
    );
  }

  if (cell_(found.values, 'verified') !== 'Yes') {
    return page_(
      'Email not sent',
      '<p>Confirm the payment before sending the welcome email.</p>'
    );
  }

  const delivery = sendWelcomeEmail_(sheet, found);

  if (delivery.alreadySent) {
    return page_('Email already sent', '<p>The welcome email was already sent.</p>');
  }

  if (delivery.sent) {
    return page_(
      'Welcome email sent',
      `<p>The welcome email was sent successfully and copied to ${esc_(WELCOME_EMAIL_CC)}.</p>`
    );
  }

  return page_(
    'Email not sent',
    '<p>The payment remains confirmed, but the welcome email could not be sent.</p>' +
    retryWelcomeForm_(data.reference, data.token)
  );
}

function retryWelcomeForm_(reference, token) {
  return `
    <form method="post" action="${escAttr_(webAppUrl_())}">
      ${hidden_('action', 'send_welcome')}
      ${hidden_('intent', 'send_welcome')}
      ${hidden_('reference', reference)}
      ${hidden_('token', token)}
      <button type="submit">Retry welcome email</button>
    </form>`;
}

function welcomeEmail_(name, reference, groupUrl) {
  const subject =
    'Welcome to BA Bridge Cohort — your payment is confirmed';

  const body =
    `Hi ${name},\n\n` +
    `Thank you for registering for the BA Bridge Cohort. ` +
    `I have confirmed your payment and your place is secured.\n\n` +
    `Join the cohort WhatsApp group for updates and next steps:\n` +
    `${groupUrl}\n\n` +
    `Your enrolment reference: ${reference}\n\n` +
    `If you have any questions, reply to this email.\n\nUbon`;

  const html = `
    <p>Hi ${esc_(name)},</p>
    <p>Thank you for registering for the BA Bridge Cohort. I have confirmed your payment and your place is secured.</p>
    <p>Join the cohort WhatsApp group for updates and next steps:</p>
    <p><a class="button" href="${escAttr_(groupUrl)}">Join the WhatsApp group</a></p>
    <p>Or use this link: <a href="${escAttr_(groupUrl)}">${esc_(groupUrl)}</a></p>
    <p>Your enrolment reference: <strong>${esc_(reference)}</strong></p>
    <p>If you have any questions, reply to this email.</p>
    <p>Ubon</p>`;

  return {
    subject,
    body,
    htmlBody: emailHtml_(html),
    name: 'BA Bridge',
    replyTo: NOTIFY_EMAIL
  };
}

// ==================== SELAR ====================

function handleSelarSale_(sheet, data) {
  requireSelarKey_(data.key);

  const sale = normalizeSelarSale_(data);
  const productMatch = configuredSelarProductMatch_();

  if (!isSuccessfulSaleStatus_(sale.status)) {
    return json_({
      result: 'ignored',
      reason: 'Sale status is not successful.',
      status: sale.status
    });
  }

  if (!selarProductMatches_(sale, productMatch)) {
    return json_({
      result: 'ignored',
      reason: 'Sale is not the configured BA Bridge product.',
      product: sale.product
    });
  }

  if (!sale.email && !sale.enrolment_reference) {
    return json_({
      result: 'error',
      message: 'Selar sale contains neither customer email nor enrolment reference.'
    });
  }

  if (sale.sale_reference) {
    const duplicate = findBySelarSaleReference_(sheet, sale.sale_reference);

    if (duplicate) {
      return json_({
        result: 'ok',
        already_processed: true,
        reference: cell_(duplicate.values, 'reference')
      });
    }
  }

  let found = null;

  if (sale.enrolment_reference) {
    found = findByReference_(sheet, sale.enrolment_reference);
  }

  if (!found && sale.email) {
    const matches = findUnverifiedByEmail_(sheet, sale.email);

    if (matches.length > 1) {
      return json_({
        result: 'ambiguous',
        message: 'More than one unverified BA Bridge enrolment uses this email address.',
        email: sale.email
      });
    }

    if (matches.length === 1) found = matches[0];
  }

  if (!found) {
    return json_({
      result: 'unmatched',
      email: sale.email,
      sale_reference: sale.sale_reference
    });
  }

  found = ensureConfirmToken_(sheet, found);

  const row = found.row;

  setRowValue_(sheet, row, 'payment_status', 'Paid — Selar detected');

  if (sale.sale_reference) {
    setRowValue_(sheet, row, 'selar_sale_reference', safeCellText_(sale.sale_reference));
  }

  if (sale.amount !== '') setRowValue_(sheet, row, 'selar_amount', sale.amount);
  if (sale.currency) setRowValue_(sheet, row, 'selar_currency', safeCellText_(sale.currency));
  if (sale.status) setRowValue_(sheet, row, 'selar_status', safeCellText_(sale.status));
  if (sale.product) setRowValue_(sheet, row, 'selar_product', safeCellText_(sale.product));

  setRowValue_(sheet, row, 'selar_webhook_received_at', stamp_());
  setRowValue_(sheet, row, 'paid_at', sale.paid_at || stamp_());

  if (
    (!sale.currency || sale.currency.toUpperCase() === 'NGN') &&
    sale.amount !== '' &&
    !isNaN(Number(sale.amount))
  ) {
    setRowValue_(sheet, row, 'amount_paid', Number(sale.amount));
  }

  SpreadsheetApp.flush();

  found = findByReference_(sheet, cell_(found.values, 'reference'));

  const review = sendReviewEmail_(sheet, found, {
    force: true,
    reason:
      'Selar detected a successful BA Bridge payment. Verify the transaction and then confirm it.'
  });

  return json_({
    result: 'ok',
    reference: cell_(found.values, 'reference'),
    review_email_sent: !!review.sent,
    review_email_error: review.error || ''
  });
}

function normalizeSelarSale_(data) {
  return {
    email: normalizeEmail_(
      pick_(data, [
        'email',
        'customer_email',
        'buyer_email',
        'customer.email',
        'buyer.email'
      ])
    ),
    amount: normalizeAmount_(
      pick_(data, ['amount', 'sale_amount', 'total', 'price', 'amount_paid'])
    ),
    currency: String(
      pick_(data, ['currency', 'currency_code', 'sale_currency']) || ''
    ).trim(),
    status: String(
      pick_(data, ['status', 'payment_status', 'sale_status']) || ''
    ).trim(),
    sale_reference: String(
      pick_(data, [
        'sale_reference',
        'sale_ref',
        'transaction_reference',
        'transaction_id',
        'order_id',
        'id'
      ]) || ''
    ).trim(),
    product: String(
      pick_(data, ['product_name', 'product_title', 'item_name', 'product.name']) || ''
    ).trim(),
    product_id: String(
      pick_(data, ['product_id', 'item_id', 'product.id']) || ''
    ).trim(),
    enrolment_reference: String(
      pick_(data, [
        'enrolment_reference',
        'enrollment_reference',
        'ba_reference',
        'reference_code'
      ]) || ''
    ).trim(),
    paid_at: String(
      pick_(data, ['paid_at', 'created_at', 'sale_date', 'date']) || ''
    ).trim()
  };
}

// ==================== INVITE SHEET ====================

function getInviteSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(INVITE_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(INVITE_SHEET_NAME);
    sheet.getRange(1, 1, 1, INVITE_HEADERS.length).setValues([INVITE_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const headers = sheet
    .getRange(1, 1, 1, INVITE_HEADERS.length)
    .getValues()[0];

  INVITE_HEADERS.forEach((header, i) => {
    if (String(headers[i] || '').trim() !== header) {
      throw new Error(
        `Invite sheet header mismatch at column ${i + 1}. Expected "${header}".`
      );
    }
  });

  return sheet;
}

function inviteRowObject_(sheet, row) {
  const v = sheet.getRange(row, 1, 1, INVITE_HEADERS.length).getValues()[0];

  return {
    row,
    createdAt: String(v[0] || ''),
    token: String(v[1] || ''),
    name: String(v[2] || ''),
    email: String(v[3] || ''),
    status: String(v[4] || ''),
    usedAt: String(v[5] || ''),
    reference: String(v[6] || '')
  };
}

function findInviteByToken_(sheet, token) {
  if (!token || sheet.getLastRow() < 2) return null;

  for (let row = sheet.getLastRow(); row >= 2; row--) {
    const invite = inviteRowObject_(sheet, row);
    if (invite.token === token) return invite;
  }

  return null;
}

function findUnusedInviteByEmail_(sheet, email) {
  const target = normalizeEmail_(email);

  for (let row = sheet.getLastRow(); row >= 2; row--) {
    const invite = inviteRowObject_(sheet, row);

    if (
      normalizeEmail_(invite.email) === target &&
      invite.status === 'Unused'
    ) {
      return invite;
    }
  }

  return null;
}

function markInviteUsed_(sheet, row, reference) {
  sheet.getRange(row, 5).setValue('Used');
  sheet.getRange(row, 6).setValue(stamp_());
  sheet.getRange(row, 7).setValue(reference);
}

function inviteUrl_(token) {
  return (
    webAppUrl_() +
    '?action=invite&token=' +
    encodeURIComponent(token)
  );
}

// ==================== RECOVERY ====================

function firePreviousSuccessfulPaymentConfirmations() {
  const sheet = getSheet_();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const values = getRow_(sheet, row);

    if (!cell_(values, 'reference') || cell_(values, 'verified') === 'Yes') {
      skipped++;
      continue;
    }

    const successful =
      cell_(values, 'payment_status').toLowerCase().indexOf('paid') !== -1 ||
      cell_(values, 'squad_status').toLowerCase().indexOf('success') !== -1 ||
      (
        cell_(values, 'selar_status') &&
        isSuccessfulSaleStatus_(cell_(values, 'selar_status'))
      );

    if (!successful) {
      skipped++;
      continue;
    }

    const found = ensureConfirmToken_(sheet, { row, values });

    const result = sendReviewEmail_(sheet, found, {
      force: false,
      reason:
        'A previous successful payment was detected. Verify it, then confirm the payment.'
    });

    if (result.sent) sent++;
    else if (result.alreadySent) skipped++;
    else failed++;
  }

  const summary =
    `Previous successful payment confirmation run complete. ` +
    `Sent: ${sent} Skipped: ${skipped} Failed: ${failed}`;

  Logger.log(summary);
  return summary;
}

function retryMissingReviewEmails() {
  const sheet = getSheet_();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const values = getRow_(sheet, row);

    if (
      !cell_(values, 'reference') ||
      cell_(values, 'verified') === 'Yes' ||
      values[COL.review_email_sent_at - 1]
    ) {
      skipped++;
      continue;
    }

    const found = ensureConfirmToken_(sheet, { row, values });

    const result = sendReviewEmail_(sheet, found, {
      force: false,
      reason: 'Manual recovery of a previously missed review email.'
    });

    if (result.sent) sent++;
    else if (result.alreadySent) skipped++;
    else failed++;
  }

  const summary =
    `Review email retry completed. ` +
    `Sent: ${sent} Skipped: ${skipped} Failed: ${failed}`;

  Logger.log(summary);
  return summary;
}

// ==================== SETUP ====================

function setupIntegrationSecrets() {
  const props = PropertiesService.getScriptProperties();

  let adminKey = props.getProperty(ADMIN_KEY_PROPERTY) || '';
  let selarKey = props.getProperty(SELAR_KEY_PROPERTY) || '';
  let product = props.getProperty(SELAR_PRODUCT_PROPERTY) || '';

  if (!adminKey) {
    adminKey = randomKey_();
    props.setProperty(ADMIN_KEY_PROPERTY, adminKey);
  }

  if (!selarKey) {
    selarKey = randomKey_();
    props.setProperty(SELAR_KEY_PROPERTY, selarKey);
  }

  if (!product) {
    product = 'BA Bridge';
    props.setProperty(SELAR_PRODUCT_PROPERTY, product);
  }

  getInviteSheet_();

  const result =
    `Setup complete.\n\n` +
    `ADMIN PANEL URL:\n${adminUrl_(adminKey)}\n\n` +
    `SELAR CALLBACK URL:\n` +
    `${webAppUrl_()}?action=selar_sale&key=${encodeURIComponent(selarKey)}\n\n` +
    `Keep both URLs private.`;

  Logger.log(result);
  return result;
}

function getIntegrationUrls() {
  const props = PropertiesService.getScriptProperties();

  const adminKey = props.getProperty(ADMIN_KEY_PROPERTY) || '';
  const selarKey = props.getProperty(SELAR_KEY_PROPERTY) || '';

  if (!adminKey || !selarKey) {
    throw new Error('Run setupIntegrationSecrets() first.');
  }

  const result =
    `ADMIN PANEL URL:\n${adminUrl_(adminKey)}\n\n` +
    `SELAR CALLBACK URL:\n` +
    `${webAppUrl_()}?action=selar_sale&key=${encodeURIComponent(selarKey)}`;

  Logger.log(result);
  return result;
}

function checkSetup() {
  const sheet = getSheet_();
  const inviteSheet = getInviteSheet_();
  const props = PropertiesService.getScriptProperties();

  configuredGroupUrl_();

  const result =
    `Setup OK.\n` +
    `Enrolment sheet: ${sheet.getName()}\n` +
    `Invite sheet: ${inviteSheet.getName()}\n` +
    `Waitlist sheet: ${getFormTab_(FORM_TABS.waitlist).sheet.getName()}\n` +
    `Contact sheet: ${getFormTab_(FORM_TABS.contact).sheet.getName()}\n` +
    `Notification email: ${NOTIFY_EMAIL}\n` +
    `Waitlist and contact email: ${SITE_NOTIFY_EMAIL}\n` +
    `Welcome email CC: ${WELCOME_EMAIL_CC}\n` +
    `Remaining email quota: ${MailApp.getRemainingDailyQuota()}\n` +
    `Web app URL: ${webAppUrl_()}\n` +
    `Admin key configured: ${!!props.getProperty(ADMIN_KEY_PROPERTY)}\n` +
    `Selar callback key configured: ${!!props.getProperty(SELAR_KEY_PROPERTY)}\n` +
    `Selar product match: ${configuredSelarProductMatch_()}`;

  Logger.log(result);
  return result;
}

function testReviewEmail() {
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: '[BA Bridge] Review email test',
    body: 'If you received this email, MailApp is working correctly.',
    name: 'BA Bridge'
  });
}

function testWelcomeEmailCC() {
  const mail = welcomeEmail_(
    'Test Student',
    'BAB-TEST-001',
    configuredGroupUrl_()
  );

  mail.to = NOTIFY_EMAIL;
  mail.cc = WELCOME_EMAIL_CC;

  MailApp.sendEmail(mail);
}

// ==================== SHEET HELPERS ====================

function getSheet_() {
  const sheet =
    SpreadsheetApp
      .openById(SPREADSHEET_ID)
      .getSheetById(SHEET_GID);

  if (!sheet) {
    throw new Error('BA Training sheet was not found.');
  }

  ensureHeader_(sheet);
  return sheet;
}

function ensureHeader_(sheet) {
  const labels = FIELDS.map(f => f[1]);

  if (sheet.getLastRow() === 0) {
    ensureColumns_(sheet, labels.length);
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
    sheet.setFrozenRows(1);
    return;
  }

  const existing =
    sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0];

  for (let i = 0; i < 26; i++) {
    if (String(existing[i] || '').trim() !== labels[i]) {
      throw new Error(
        `BA Training header mismatch at column ${i + 1}. Expected "${labels[i]}".`
      );
    }
  }

  ensureColumns_(sheet, labels.length);

  for (let i = 26; i < labels.length; i++) {
    const current =
      i < existing.length
        ? String(existing[i] || '').trim()
        : '';

    if (current && current !== labels[i]) {
      throw new Error(
        `Unexpected column header at column ${i + 1}. ` +
        `Expected "${labels[i]}" but found "${current}".`
      );
    }

    if (!current) {
      if (columnHasData_(sheet, i + 1)) {
        throw new Error(
          `Column ${i + 1} contains data but has no expected header.`
        );
      }

      sheet.getRange(1, i + 1).setValue(labels[i]);
    }
  }

  sheet.setFrozenRows(1);
}

function ensureColumns_(sheet, required) {
  const available = sheet.getMaxColumns();

  if (available < required) {
    sheet.insertColumnsAfter(
      available,
      required - available
    );
  }
}

function columnHasData_(sheet, column) {
  if (sheet.getLastRow() < 2) return false;

  return sheet
    .getRange(2, column, sheet.getLastRow() - 1, 1)
    .getValues()
    .some(row => row[0] !== '');
}

function getRow_(sheet, row) {
  return sheet
    .getRange(row, 1, 1, FIELDS.length)
    .getValues()[0];
}

function appendMappedRow_(sheet, values) {
  const row = FIELDS.map(field => {
    const key = field[0];

    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return '';
    }

    return typeof values[key] === 'string'
      ? safeCellText_(values[key])
      : values[key];
  });

  sheet.appendRow(row);
}

function setRowValue_(sheet, row, field, value) {
  sheet.getRange(row, COL[field]).setValue(value);
}

function cell_(values, key) {
  return String(values[COL[key] - 1] || '').trim();
}

function findByReference_(sheet, reference) {
  if (!reference || sheet.getLastRow() < 2) return null;

  const refs =
    sheet
      .getRange(2, COL.reference, sheet.getLastRow() - 1, 1)
      .getValues();

  for (let i = refs.length - 1; i >= 0; i--) {
    if (String(refs[i][0]).trim() === String(reference).trim()) {
      const row = i + 2;

      return {
        row,
        values: getRow_(sheet, row)
      };
    }
  }

  return null;
}

function findByEmail_(sheet, email, preferUnverified) {
  const target = normalizeEmail_(email);

  if (!target || sheet.getLastRow() < 2) return null;

  const values =
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, FIELDS.length)
      .getValues();

  let fallback = null;

  for (let i = values.length - 1; i >= 0; i--) {
    if (normalizeEmail_(values[i][COL.email - 1]) !== target) continue;

    const found = {
      row: i + 2,
      values: values[i]
    };

    if (!fallback) fallback = found;

    if (
      !preferUnverified ||
      String(values[i][COL.verified - 1] || '') !== 'Yes'
    ) {
      return found;
    }
  }

  return fallback;
}

function findUnverifiedByEmail_(sheet, email) {
  const target = normalizeEmail_(email);
  const matches = [];

  if (!target || sheet.getLastRow() < 2) return matches;

  const values =
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, FIELDS.length)
      .getValues();

  for (let i = values.length - 1; i >= 0; i--) {
    if (normalizeEmail_(values[i][COL.email - 1]) !== target) continue;
    if (String(values[i][COL.verified - 1] || '') === 'Yes') continue;

    matches.push({
      row: i + 2,
      values: values[i]
    });
  }

  return matches;
}

function findBySelarSaleReference_(sheet, ref) {
  if (!ref || sheet.getLastRow() < 2) return null;

  const values =
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, FIELDS.length)
      .getValues();

  for (let i = values.length - 1; i >= 0; i--) {
    if (
      String(values[i][COL.selar_sale_reference - 1] || '').trim() ===
      String(ref).trim()
    ) {
      return {
        row: i + 2,
        values: values[i]
      };
    }
  }

  return null;
}

function ensureConfirmToken_(sheet, found) {
  if (!found) return null;

  let token = cell_(found.values, 'confirm_token');

  if (token) return found;

  token = Utilities.getUuid();

  setRowValue_(sheet, found.row, 'confirm_token', token);
  SpreadsheetApp.flush();

  return {
    row: found.row,
    values: getRow_(sheet, found.row)
  };
}

// ==================== SECURITY ====================

function requireAdminKey_(key) {
  const expected =
    String(
      PropertiesService
        .getScriptProperties()
        .getProperty(ADMIN_KEY_PROPERTY) || ''
    ).trim();

  if (!expected || !key || String(key) !== expected) {
    throw new Error('Invalid admin access key.');
  }
}

function requireSelarKey_(key) {
  const expected =
    String(
      PropertiesService
        .getScriptProperties()
        .getProperty(SELAR_KEY_PROPERTY) || ''
    ).trim();

  if (!expected || !key || String(key) !== expected) {
    throw new Error('Invalid Selar callback key.');
  }
}

function adminUrl_(key) {
  return (
    webAppUrl_() +
    '?action=admin&key=' +
    encodeURIComponent(key)
  );
}

function configuredGroupUrl_() {
  const url =
    String(
      PropertiesService
        .getScriptProperties()
        .getProperty(BA_GROUP_PROPERTY) || ''
    ).trim();

  if (!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/.test(url)) {
    throw new Error(
      'Set a valid ' +
      BA_GROUP_PROPERTY +
      ' under Apps Script → Project Settings → Script Properties.'
    );
  }

  return url;
}

function configuredSelarProductMatch_() {
  const value =
    String(
      PropertiesService
        .getScriptProperties()
        .getProperty(SELAR_PRODUCT_PROPERTY) || ''
    ).trim();

  if (!value) {
    throw new Error(
      'Set ' +
      SELAR_PRODUCT_PROPERTY +
      ' in Script Properties.'
    );
  }

  return value;
}

function webAppUrl_() {
  if (!WEB_APP_URL || WEB_APP_URL.indexOf('/exec') === -1) {
    throw new Error('WEB_APP_URL must be set to the production /exec URL.');
  }

  return WEB_APP_URL;
}

function randomKey_() {
  return (
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '')
  );
}

// ==================== SELAR HELPERS ====================

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAmount_(value) {
  if (
    value === null ||
    typeof value === 'undefined' ||
    value === ''
  ) {
    return '';
  }

  const cleaned = String(value).replace(/[^0-9.\-]/g, '');

  if (!cleaned || isNaN(Number(cleaned))) {
    return String(value).trim();
  }

  return Number(cleaned);
}

function isSuccessfulSaleStatus_(status) {
  const value = String(status || '').trim().toLowerCase();

  if (!value) return true;

  return [
    'success',
    'successful',
    'paid',
    'completed',
    'complete'
  ].indexOf(value) !== -1;
}

function selarProductMatches_(sale, match) {
  const expected = String(match || '').trim().toLowerCase();

  if (!expected) return false;

  const product = String(sale.product || '').toLowerCase();
  const productId = String(sale.product_id || '').toLowerCase();

  return (
    product.indexOf(expected) !== -1 ||
    productId === expected
  );
}

function pick_(object, paths) {
  for (let i = 0; i < paths.length; i++) {
    const value = getPath_(object, paths[i]);

    if (
      value !== null &&
      typeof value !== 'undefined' &&
      value !== '' &&
      typeof value !== 'object'
    ) {
      return value;
    }
  }

  return '';
}

function getPath_(object, path) {
  const parts = String(path).split('.');
  let current = object;

  for (let i = 0; i < parts.length; i++) {
    if (
      !current ||
      typeof current !== 'object' ||
      typeof current[parts[i]] === 'undefined'
    ) {
      return undefined;
    }

    current = current[parts[i]];
  }

  return current;
}

// ==================== FORM HELPERS ====================

function option_(value) {
  return `<option value="${escAttr_(value)}">${esc_(value)}</option>`;
}

function wantCheckbox_(name, label, other) {
  const extra =
    other
      ? 'id="want_other" onchange="toggleWantOther()"'
      : '';

  return `
    <label class="checkboxLabel">
      <input type="checkbox" class="wantOption" name="${escAttr_(name)}" value="yes" ${extra}>
      ${esc_(label)}
    </label>`;
}

function availabilityCheckbox_(name, label) {
  return `
    <label class="checkboxLabel">
      <input type="checkbox" class="availabilityOption" name="${escAttr_(name)}" value="yes">
      ${esc_(label)}
    </label>`;
}

// ==================== GENERIC HELPERS ====================

function safeCellText_(value) {
  const text = String(value == null ? '' : value);

  return /^[=+\-@]/.test(text)
    ? "'" + text
    : text;
}

function stamp_() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function hidden_(name, value) {
  return (
    '<input type="hidden" name="' +
    escAttr_(name) +
    '" value="' +
    escAttr_(value) +
    '">'
  );
}

function detail_(name, value) {
  return `<dt>${esc_(name)}</dt><dd>${esc_(value)}</dd>`;
}

function esc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr_(value) {
  return esc_(value);
}

// ==================== HTML ====================

function emailHtml_(body) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body{font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#111}
          .button{display:inline-block;padding:12px 18px;background:#1F3BD6;color:#fff!important;text-decoration:none;border-radius:6px}
          .note{color:#555}
        </style>
      </head>
      <body>${body}</body>
    </html>`;
}

function page_(title, body) {
  return HtmlService
    .createHtmlOutput(`
      <!doctype html>
      <html>
        <head>
          <base target="_top">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <style>
            body{max-width:1100px;margin:42px auto;padding:0 20px;font:16px Arial,sans-serif;line-height:1.5;color:#111}
            h1{margin-bottom:12px}
            h2{margin-top:28px}
            .card{border:1px solid #ddd;border-radius:10px;padding:20px;margin:24px 0}
            .toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}
            .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
            dl{display:grid;grid-template-columns:180px 1fr;gap:8px;border-top:1px solid #ddd;padding-top:16px}
            dt{font-weight:bold}
            dd{margin:0}
            label{display:block;margin:16px 0;font-weight:600}
            input,select,textarea{box-sizing:border-box;padding:10px;width:100%;max-width:520px;margin-top:6px;font:inherit;border:1px solid #ccc;border-radius:5px}
            fieldset{border:1px solid #ddd;border-radius:7px;padding:14px 18px;margin:22px 0;max-width:520px}
            legend{font-weight:bold;padding:0 6px}
            .checkboxLabel{font-weight:normal;display:flex;align-items:flex-start;gap:9px;margin:10px 0;max-width:600px}
            .checkboxLabel input{width:auto;margin:4px 0 0;padding:0}
            button{padding:11px 16px;border:0;border-radius:6px;background:#1F3BD6;color:#fff;font:inherit;font-weight:600;cursor:pointer}
            button:hover{opacity:.92}
            .note{color:#666;font-size:14px}
            .error{color:#b00020;margin:16px 0;font-weight:bold}
            .search{display:flex;gap:8px;align-items:end;margin:20px 0}
            .search input{margin:0}
            .tablewrap{overflow:auto}
            table{border-collapse:collapse;width:100%;min-width:900px}
            th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;vertical-align:top}
            th{background:#f6f6f6}
            td form{margin:0}
            a{color:#1F3BD6}
            @media(max-width:700px){
              body{margin:24px auto}
              dl,.grid2{grid-template-columns:1fr}
              dd{margin-bottom:8px}
              .search{display:block}
              .search button{margin-top:8px}
              fieldset{padding:12px}
            }
          </style>
        </head>
        <body>
          <h1>${esc_(title)}</h1>
          ${body}
        </body>
      </html>`
    )
    .setTitle(title);
}

// ==================== PAID COHORT WELCOME REMINDER ====================

function previewPaidCohortWelcomeReminder() {
  const sheet = getSheet_();
  const recipients = [];
  const seen = {};

  for (let row = sheet.getLastRow(); row >= 2; row--) {
    const values = getRow_(sheet, row);

    const paymentStatus = cell_(values, 'payment_status');
    const email = normalizeEmail_(cell_(values, 'email'));

    if (paymentStatus !== 'Paid — manually confirmed') continue;
    if (!email || seen[email]) continue;

    seen[email] = true;

    recipients.push({
      name: cell_(values, 'name'),
      email: email,
      reference: cell_(values, 'reference')
    });
  }

  Logger.log(
    'Eligible recipients: ' +
    recipients.length +
    '\n\n' +
    recipients
      .map((r, i) =>
        (i + 1) +
        '. ' +
        r.name +
        ' — ' +
        r.email +
        ' — ' +
        r.reference
      )
      .join('\n')
  );

  return recipients;
}


function sendPaidCohortWelcomeReminder() {
  const sheet = getSheet_();
  const groupUrl = configuredGroupUrl_();

  const props = PropertiesService.getScriptProperties();

  let previousSends = [];

  try {
    previousSends = JSON.parse(
      props.getProperty(
        COHORT_REMINDER_LOG_PROPERTY
      ) || '[]'
    );
  } catch (ignore) {
    previousSends = [];
  }

  const alreadySent = {};

  previousSends.forEach(email => {
    alreadySent[
      normalizeEmail_(email)
    ] = true;
  });

  const processedThisRun = {};

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const failures = [];


  // Newest registrations first.
  for (
    let row = sheet.getLastRow();
    row >= 2;
    row--
  ) {

    const values = getRow_(sheet, row);

    const paymentStatus =
      cell_(
        values,
        'payment_status'
      );

    // EXACT STATUS REQUESTED
    if (
      paymentStatus !==
      'Paid — manually confirmed'
    ) {
      continue;
    }


    const name =
      cell_(
        values,
        'name'
      );

    const email =
      normalizeEmail_(
        cell_(
          values,
          'email'
        )
      );

    const reference =
      cell_(
        values,
        'reference'
      );


    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
      )
    ) {
      failed++;

      failures.push(
        name +
        ' — invalid email: ' +
        email
      );

      continue;
    }


    // Prevent duplicates where same person
    // has multiple registration rows.
    if (
      processedThisRun[email]
    ) {
      skipped++;
      continue;
    }


    processedThisRun[email] =
      true;


    // Prevent rerunning campaign against
    // someone who already received it.
    if (
      alreadySent[email]
    ) {
      skipped++;
      continue;
    }


    /*
     * Each message has:
     * 1 student
     * 1 CC
     *
     * = 2 recipients against MailApp quota.
     */
    if (
      MailApp
        .getRemainingDailyQuota() < 2
    ) {

      Logger.log(
        'Stopped because the remaining email quota is below 2 recipients.'
      );

      break;
    }


    const firstName =
      name
        .split(/\s+/)[0] ||
      name ||
      'there';


    const subject =
      'Welcome again to BA Bridge — Important Next Step';


    const body =
      'Hi ' +
      firstName +
      ',\n\n' +

      'Welcome once again to BA Bridge. I’m glad to have you in the cohort.\n\n' +

      'As we prepare to begin, please make sure you have joined the official BA Bridge WhatsApp group. This is where we will share important announcements, session reminders, materials, updates and other cohort information.\n\n' +

      'If you have not joined yet, use the link below:\n' +

      groupUrl +
      '\n\n' +

      'If you are already in the group, no further action is required.\n\n' +

      'Your enrolment reference: ' +
      reference +
      '\n\n' +

      'I’m looking forward to working with you over the course of the programme.\n\n' +

      'Ubon';


    const html = `
      <p>Hi ${esc_(firstName)},</p>

      <p>
        Welcome once again to <strong>BA Bridge</strong>.
        I’m glad to have you in the cohort.
      </p>

      <p>
        As we prepare to begin, please make sure you have joined
        the official BA Bridge WhatsApp group.
      </p>

      <p>
        This is where we will share important announcements,
        session reminders, materials, updates and other cohort
        information.
      </p>

      <p>
        If you have not joined yet, use the button below:
      </p>

      <p>
        <a
          class="button"
          href="${escAttr_(groupUrl)}"
        >
          Join the BA Bridge WhatsApp Group
        </a>
      </p>

      <p>
        Or use this link:<br>
        <a href="${escAttr_(groupUrl)}">
          ${esc_(groupUrl)}
        </a>
      </p>

      <p>
        If you are already in the group,
        no further action is required.
      </p>

      <p>
        Your enrolment reference:
        <strong>${esc_(reference)}</strong>
      </p>

      <p>
        I’m looking forward to working with you over
        the course of the programme.
      </p>

      <p>Ubon</p>
    `;


    try {

      MailApp.sendEmail({
        to: email,
        cc: COHORT_REMINDER_CC,
        subject: subject,
        body: body,
        htmlBody: emailHtml_(html),
        name: 'BA Bridge',
        replyTo: NOTIFY_EMAIL
      });


      sent++;

      alreadySent[email] =
        true;


      previousSends.push(
        email
      );


      /*
       * Save after every successful send.
       * If the script stops halfway,
       * successful recipients remain recorded.
       */
      props.setProperty(
        COHORT_REMINDER_LOG_PROPERTY,
        JSON.stringify(
          previousSends
        )
      );


      console.log(
        'Cohort reminder sent to ' +
        name +
        ' — ' +
        email
      );


    } catch (err) {

      failed++;

      const error =
        String(err)
          .slice(
            0,
            500
          );


      failures.push(
        name +
        ' — ' +
        email +
        ' — ' +
        error
      );


      console.error(
        'Reminder failed for ' +
        email +
        ': ' +
        error
      );

    }

  }


  const summary =
    'BA Bridge cohort reminder completed.\n\n' +
    'Sent: ' +
    sent +
    '\n' +
    'Skipped: ' +
    skipped +
    '\n' +
    'Failed: ' +
    failed +
    '\n' +
    'Remaining recipient quota: ' +
    MailApp
      .getRemainingDailyQuota() +
    (
      failures.length
        ? '\n\nFailures:\n' +
          failures.join('\n')
        : ''
    );


  Logger.log(
    summary
  );


  return summary;
}


// ==================== RESET REMINDER CAMPAIGN ====================

/**
 * Only run this if you intentionally want
 * to send this same reminder campaign again
 * to everyone in future.
 */
function resetPaidCohortWelcomeReminderLog() {
  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      COHORT_REMINDER_LOG_PROPERTY
    );

  Logger.log(
    'Cohort reminder send history has been reset.'
  );
}
