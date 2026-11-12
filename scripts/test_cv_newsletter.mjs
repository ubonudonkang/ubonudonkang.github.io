import assert from 'node:assert/strict';
import { makeHarness } from './gas_harness.mjs';

/* ── CV requests: a row in "CV requests" and one email to the owner, never to the requester ── */
const h = makeHarness();
const request = {
  form_name: 'cv_request', name: 'Ada Example', email: 'ada@example.test', company: 'Example Ltd',
  role: 'https://jobs.example.test/ba-123', page: '/hire/', submission_id: 'sub-1', _elapsed: '8000', _gotcha: ''
};

assert.equal(h.result(h.post(request)), 'ok');
const cvTab = h.named['CV requests'];
assert.ok(cvTab, 'the CV requests tab is created on first use');
assert.deepEqual(cvTab.rows[0], ['Timestamp', 'Form type', 'Name', 'Email', 'Company', 'Role or job link', 'Source page', 'Submission ID']);
assert.deepEqual(cvTab.rows[1].slice(1), ['cv_request', 'Ada Example', 'ada@example.test', 'Example Ltd', 'https://jobs.example.test/ba-123', '/hire/', 'sub-1']);
assert.equal(h.emails.length, 1);
const mail = h.emails[0];
assert.equal(mail.to, 'ubonudonkang@gmail.com', 'the request goes to the owner');
assert.equal(mail.subject, 'CV request: Ada Example, Example Ltd');
assert.equal(mail.replyTo, 'ada@example.test', 'replying from Gmail answers the requester');
for (const part of ['Name: Ada Example', 'Email: ada@example.test', 'Company: Example Ltd', 'Role or job link: https://jobs.example.test/ba-123', 'Source page: /hire/', 'Timestamp: ']) {
  assert.ok(mail.body.includes(part), `the email body has "${part}"`);
}

// The browser's blind resend of the same request is not a second row or email.
assert.equal(h.result(h.post(request)), 'ok');
assert.equal(cvTab.rows.length, 2);
assert.equal(h.emails.length, 1);

// No company: the subject says so.
assert.equal(h.result(h.post({ ...request, company: '', submission_id: 'sub-2' })), 'ok');
assert.equal(h.emails[1].subject, 'CV request: Ada Example, no company');

// Spam checks: honeypot, too fast, no timer at all. Each answers ok and saves nothing.
const before = cvTab.rows.length;
assert.equal(h.result(h.post({ ...request, submission_id: 'bot-1', _gotcha: 'filled' })), 'ok');
assert.equal(h.result(h.post({ ...request, submission_id: 'bot-2', _elapsed: '900' })), 'ok');
const { _elapsed, ...noTimer } = request;
assert.equal(h.result(h.post({ ...noTimer, submission_id: 'bot-3' })), 'ok');
assert.equal(cvTab.rows.length, before, 'bots save nothing');
assert.equal(h.emails.length, 2, 'bots send nothing');

// Server-side validation: email format, required fields, lengths.
assert.equal(h.result(h.post({ ...request, submission_id: 'bad-1', email: 'not-an-email' })), 'error');
assert.equal(h.result(h.post({ ...request, submission_id: 'bad-2', name: '' })), 'error');
assert.equal(h.result(h.post({ ...request, submission_id: 'bad-3', name: 'x'.repeat(101) })), 'error');
assert.equal(h.result(h.post({ ...request, submission_id: 'bad-4', role: 'x'.repeat(501) })), 'error');
assert.equal(cvTab.rows.length, before);

// A formula typed into a field is stored as text.
assert.equal(h.result(h.post({ ...request, submission_id: 'sub-3', company: '=HYPERLINK("x")' })), 'ok');
assert.equal(cvTab.rows.at(-1)[4], '\'=HYPERLINK("x")');

/* ── BA notes signup: a row in "BA notes subscribers" and one email to the owner, never to the subscriber ── */
const n = makeHarness();
const signup = { form_name: 'newsletter', email: 'Reader@Example.test', first_name: 'Bola', page: '/notes/how-to-write-a-brd/', submission_id: 'n-1', _elapsed: '4000' };
assert.equal(n.result(n.post(signup)), 'ok');
const subs = n.named['BA notes subscribers'];
assert.deepEqual(subs.rows[0], ['Timestamp', 'Form type', 'Email', 'First name', 'Source page', 'Submission ID']);
assert.deepEqual(subs.rows[1].slice(1), ['newsletter', 'Reader@Example.test', 'Bola', '/notes/how-to-write-a-brd/', 'n-1']);
assert.equal(n.emails.length, 1, 'a new subscriber is announced');
assert.equal(n.emails[0].to, 'ubonudonkang@gmail.com', 'only the owner is emailed');
assert.equal(n.emails[0].subject, 'New BA notes subscriber: Bola (1 total)');
for (const part of ['Email: Reader@Example.test', 'First name: Bola', 'Source page: /notes/how-to-write-a-brd/', 'Total subscribers: 1']) {
  assert.ok(n.emails[0].body.includes(part), `the email body has "${part}"`);
}

// The same address from another page is one subscriber.
assert.equal(n.result(n.post({ ...signup, email: 'reader@example.test', page: '/resources/templates/', submission_id: 'n-2' })), 'ok');
assert.equal(subs.rows.length, 2);
assert.equal(n.emails.length, 1, 'a repeat signup is not announced again');

// First name is optional; email is not.
assert.equal(n.result(n.post({ ...signup, email: 'two@example.test', first_name: '', submission_id: 'n-3' })), 'ok');
assert.equal(subs.rows.length, 3);
assert.equal(n.emails.at(-1).subject, 'New BA notes subscriber: two@example.test (2 total)', 'without a first name the subject uses the email');
assert.equal(n.result(n.post({ ...signup, email: '', submission_id: 'n-4' })), 'error');
assert.equal(n.result(n.post({ ...signup, email: 'three@example.test', first_name: 'x'.repeat(61), submission_id: 'n-5' })), 'error');
assert.equal(n.result(n.post({ ...signup, email: 'four@example.test', submission_id: 'n-6', _elapsed: '10' })), 'ok');
assert.equal(subs.rows.length, 3, 'too fast saves nothing');

/* ── The forms that already existed keep working without a timer ── */
const c = makeHarness();
assert.equal(c.result(c.post({ form_name: 'contact', first_name: 'A', last_name: 'B', email: 'a@example.test', message: 'Hi', submission_id: 'c-1' })), 'ok');
assert.equal(c.emails.length, 1);

console.log('CV request and newsletter checks passed');
