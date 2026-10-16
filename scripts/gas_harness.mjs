import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/* A stand-in for Google's Apps Script runtime (sheets, mail, Squad, locks, users), used to test scripts/site_forms.gs. */

export const source = fs.readFileSync(new URL('site_forms.gs', import.meta.url), 'utf8');
export const BOOK_ID = '1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk';
export const enrolmentHeaders = [
  'Timestamp', 'Reference', 'Full name', 'Email', 'WhatsApp', 'City and country',
  'Background', 'Years experience', 'Stage of transition', 'What they want most',
  'Biggest blocker', 'Preferred format', 'Availability', 'Can start',
  'Heard about it via', 'Consent given', 'Amount', 'Payment status',
  'Sender name', 'Transfer ref', 'Declared at', 'Verified by you',
  'Squad transaction ref', 'Amount paid (NGN)', 'Paid at', 'Squad status'
];
// The live Waitlist tab, exactly as the earlier waitlist script created it.
export const liveWaitlistHeaders = ['Timestamp', 'Form', 'name', 'email', 'cohort', 'consent', 'type'];

// google.script.run can only carry plain data back to a page: a Date or a function turns into null, and NaN or undefined do not survive either.
// The tests check this on the raw answer before it is flattened to JSON, which would otherwise hide it.
export function assertPlain(value, path = 'result') {
  const kind = Object.prototype.toString.call(value);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value), `${path} is not a finite number`); return; }
  if (kind === '[object Array]') { value.forEach((item, i) => assertPlain(item, `${path}[${i}]`)); return; }
  if (kind === '[object Object]') { for (const [key, item] of Object.entries(value)) assertPlain(item, `${path}.${key}`); return; }
  assert.fail(`${path} is ${value === undefined ? 'undefined' : kind}, which a dashboard page cannot receive`);
}

export function makeSheet(name, headers) {
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

export function makeHarness({ enrolment = enrolmentHeaders, tabs = {}, squad = null, user = {} } = {}) {
  // Who the script thinks is signed in. The owner's own account by default; set active to '' for an anonymous visitor.
  const who = { active: 'owner@example.test', effective: 'owner@example.test', ...user };
  const emails = [];
  const fetches = [];
  const triggers = [];
  const cacheStore = new Map();
  const locks = { count: 0 };
  const enrolmentSheet = makeSheet('BA Training', enrolment);
  const named = { ...tabs };
  const book = {
    getSheetById(gid) { assert.equal(gid, 0); return enrolmentSheet; },
    getSheetByName: (name) => named[name] || null,
    insertSheet(name) { named[name] = makeSheet(name, null); return named[name]; }
  };
  const properties = { BA_BRIDGE_WHATSAPP_GROUP_URL: 'https://chat.whatsapp.com/TestGroup123' };
  if (squad) properties.SQUAD_SECRET_KEY = squad.key;
  let uuid = 0;
  const context = {
    SpreadsheetApp: { openById(id) { assert.equal(id, BOOK_ID); return book; }, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() { locks.count++; }, releaseLock() {} }) },
    Utilities: {
      getUuid: () => (uuid++ === 0 ? 'test-token' : `uuid-${uuid}`),
      // 'MMMM yyyy' is the month and year in words; any other pattern gets an ISO-style stamp.
      formatDate: (date, zone, pattern) => (pattern === 'MMMM yyyy'
        ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: zone }).format(date)
        : date.toISOString().slice(0, 19).replace('T', ' ')),
    },
    Session: {
      getScriptTimeZone: () => 'Africa/Lagos',
      getActiveUser: () => ({ getEmail: () => who.active }),
      getEffectiveUser: () => ({ getEmail: () => who.effective }),
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] ?? null,
      setProperty: (key, value) => { properties[key] = value; },
    }) },
    UrlFetchApp: {
      fetch(url, options) {
        fetches.push({ url, options });
        const answer = squad.respond(url);
        return { getResponseCode: () => answer.code, getContentText: () => JSON.stringify(answer.body ?? {}) };
      }
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v) => { cacheStore.set(k, v); } }) },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger(t) { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (handler) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create() { triggers.push({ getHandlerFunction: () => handler, every: n }); } }) }) }),
    },
    MailApp: {
      getRemainingDailyQuota: () => 100,
      // Supports both call styles used by the script: (to, subject, body) and ({...}).
      sendEmail(...args) {
        emails.push(args.length === 1 ? args[0] : { to: args[0], subject: args[1], body: args[2] });
      }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    HtmlService: {
      createHtmlOutput: (html) => ({ html, setTitle() { return this; } }),
      // The dashboard page is a separate HTML file in the Apps Script project.
      createHtmlOutputFromFile(name) {
        const html = fs.readFileSync(new URL(`${name}.html.txt`, import.meta.url), 'utf8');
        return { html, file: name, setTitle(title) { this.title = title; return this; }, addMetaTag(key, value) { (this.meta ??= {})[key] = value; return this; } };
      },
    },
    console: { error() {}, log() {} },
    Logger: { log() {} },
    Date, JSON, String, Number, Array, Object, Math, RegExp, Error, encodeURIComponent, isNaN
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const post = (parameter) => context.doPost({ parameter });
  const result = (output) => JSON.parse(output.text).result;
  // What the page receives from adminApi: the answer, checked for plain data, as JSON.
  const api = (method, params) => {
    const raw = context.adminApi(method, params);
    assertPlain(raw);
    return JSON.parse(JSON.stringify(raw));
  };
  return { context, post, result, emails, enrolmentSheet, named, fetches, triggers, properties, cacheStore, who, locks, api };
}
