import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, chromePath, axeSource, seeded, populate, populateMore, serve, open, until, axeViolations, overflow, rowsOf } from './admin_ui_helpers.mjs';

/* The dashboard's other pages in a real browser: waitlist, enquiries, 1:1 sessions, invites, and adding an enrolment, plus the phone navigation.
   (Overview, enrolments and the shell are in test_admin_ui.mjs.) */

if (!chromium) { console.log('Playwright is not installed here; skipping the dashboard page tests.'); process.exit(0); }

const full = () => populateMore(populate(seeded()));
const shared = full();
const html = shared.context.doGet({ parameter: {} }).html;
const { server, url } = await serve(html);
const browser = await chromium.launch({ executablePath: chromePath });
// Records what the page puts on the clipboard (the real clipboard is not available to a test).
const spyClipboard = (page) => page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = (text) => { window.__copied.push(text); return Promise.resolve(); }; });
const copied = (page) => page.evaluate(() => window.__copied);
const visit = async (backend, hash, options = {}) => {
  const session = await open(browser, backend, { url, ...options });
  await session.page.evaluate((x) => { location.hash = x; }, hash);
  await spyClipboard(session.page);
  return session;
};
let failed = null;
try {
  /* ── Navigation: a sidebar of six on a laptop, four tabs and a More menu on a phone ── */
  {
    const wide = await open(browser, shared, { url });
    await wide.page.waitForSelector('.kpi');
    assert.deepEqual(await wide.page.locator('#nav a').allTextContents().then((t) => t.map((x) => x.replace(/\d+$/, ''))), ['Overview', 'Enrolments', 'Waitlist', 'Enquiries', '1:1 sessions', 'Invites']);
    assert.equal(await wide.page.locator('#nav a[href="#/enquiries"] .nav__count').textContent(), '3', 'the sidebar says how many enquiries are waiting');
    assert.deepEqual(await wide.page.locator('.quick a').allTextContents(), ['Add enrolment', 'Create invite']);
    assert.equal(await wide.page.locator('a.kpi', { hasText: 'Waitlist' }).getAttribute('href'), '#/waitlist');
    assert.equal(await wide.page.locator('a.kpi', { hasText: '1:1 sessions' }).getAttribute('href'), '#/sessions');
    assert.match(await wide.page.locator('a.kpi', { hasText: 'Enquiries' }).textContent(), /3 not handled/);
    assert.equal(await wide.page.locator('a.kpi', { hasText: 'Enquiries' }).getAttribute('href'), '#/enquiries?f=open');
    await wide.context.close();

    const phone = await open(browser, shared, { url, width: 390, height: 800 });
    await phone.page.waitForSelector('.kpi');
    assert.equal(await phone.page.locator('#tabbar a').count(), 4);
    assert.equal(await phone.page.locator('#more-btn').isVisible(), true);
    assert.equal(await phone.page.locator('#more-btn').getAttribute('aria-current'), null);
    await phone.page.locator('#more-btn').click();
    await phone.page.waitForSelector('.sheet');
    assert.deepEqual(await phone.page.locator('.sheet a').allTextContents(), ['1:1 sessions', 'Invites', 'Add enrolment']);
    assert.equal(await phone.page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)), true, 'focus moves into the menu');
    for (let i = 0; i < 8; i++) { await phone.page.keyboard.press('Tab'); assert.equal(await phone.page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)), true, 'Tab stays in the menu'); }
    await phone.page.keyboard.press('Escape');
    await phone.page.waitForSelector('.sheet', { state: 'detached' });
    assert.equal(await phone.page.evaluate(() => document.activeElement.id), 'more-btn', 'focus goes back to the button');
    await phone.page.locator('#more-btn').click();
    await phone.page.locator('.sheet a', { hasText: 'Invites' }).click();
    await phone.page.waitForSelector('.sheet', { state: 'detached' });
    await phone.page.waitForFunction(() => document.getElementById('title').textContent === 'Invites');
    assert.equal(await phone.page.locator('#more-btn').getAttribute('aria-current'), 'true', 'More is marked when the page is one of its pages');
    await phone.page.locator('#tabbar a', { hasText: 'Waitlist' }).click();
    await phone.page.waitForFunction(() => document.getElementById('title').textContent === 'Waitlist');
    assert.equal(await phone.page.locator('#more-btn').getAttribute('aria-current'), null);
    await phone.context.close();
  }

  /* ── Waitlist ── */
  {
    const h = full();
    const { page, errors } = await visit(h, '#/waitlist');
    await page.waitForSelector('tbody tr');
    assert.equal(await rowsOf(page).count(), 6);
    assert.deepEqual(await page.locator('.seg button').allTextContents(), ['All6', 'May 20273', 'February 20273', 'Repeats1']);
    assert.match(await page.locator('.callout').textContent(), /1 signup repeats an earlier one/);
    assert.equal(await page.locator('.badge', { hasText: 'Repeat signup' }).count(), 1);
    assert.equal(await page.locator('tbody img').count(), 0, 'a name that looks like markup is shown as text');
    assert.match(await page.locator('tbody').textContent(), /<img src=x onerror="window.__xss=3"> Mallory/);
    assert.equal(await page.evaluate(() => window.__xss), undefined);

    await page.locator('.seg button', { hasText: 'February 2027' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
    assert.match(page.url(), /f=February/);
    await page.locator('.seg button', { hasText: 'Repeats' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    assert.match(await page.locator('tbody').textContent(), /Ada Waits again/);
    await page.locator('.seg button', { hasText: 'All' }).click();
    await page.locator('#list-search').fill('bayo');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    await page.locator('#list-search').fill('nobody-here');
    await page.waitForSelector('.empty');
    assert.match(await page.locator('.empty').textContent(), /Nothing matches/);
    await page.locator('#list-search').fill('');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 6);

    // copying addresses: each once, in the order shown (newest first)
    await page.getByRole('button', { name: 'Copy 5 emails' }).click();
    assert.deepEqual(await copied(page), ['ada.w@example.test, formula.w@example.test, mal.w@example.test, chi.w@example.test, bayo.w@example.test']);
    await page.locator('.seg button', { hasText: 'May 2027' }).click();
    await page.getByRole('button', { name: 'Copy 3 emails' }).waitFor();

    // the CSV: a header, every row shown, a BOM for spreadsheet programs, and nothing that a spreadsheet would run as a formula
    await page.locator('.seg button', { hasText: 'All' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
    assert.match(download.suggestedFilename(), /^waitlist-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    const lines = csv.slice(1).trim().split('\r\n');
    assert.equal(lines[0], 'Name,Email,Cohort,Signed up,Repeat');
    assert.equal(lines.length, 7);
    assert.ok(csv.includes('"\'=HYPERLINK(""http://evil.example"",""click"")"'), 'a name starting with = is made plain, and quoted');
    assert.ok(!lines.some((l) => /^[=+\-@]/.test(l)), 'no line starts like a formula');
    assert.ok(lines.some((l) => /Ada Waits again,ada\.w@example\.test,February 2027,.*,Yes$/.test(l)), 'the repeat is marked');
    assert.deepEqual(errors, []);
    await page.context().close();

    // an empty waitlist and a failing server
    const empty = await visit(seeded(), '#/waitlist');
    await empty.page.waitForSelector('.empty');
    assert.match(await empty.page.locator('.empty').textContent(), /No one is on the waitlist yet/);
    assert.equal(await empty.page.getByRole('button', { name: 'Download CSV' }).isDisabled(), true);
    await empty.context.close();
    const broken = await visit(h, '#/waitlist', { failures: { waitlist: 'The sheet is busy' } });
    await broken.page.waitForSelector('.banner');
    assert.match(await broken.page.locator('.banner').textContent(), /The sheet is busy/);
    await broken.context.close();
  }

  /* ── Enquiries: the panel, replying, and the handled marker ── */
  {
    const h = full();
    const { page, errors } = await visit(h, '#/enquiries');
    await page.waitForSelector('tbody tr');
    assert.equal(await rowsOf(page).count(), 3);
    assert.deepEqual(await page.locator('.seg button').allTextContents(), ['All3', 'Not handled3', 'Handled0']);
    assert.equal(await page.locator('.badge', { hasText: 'New' }).count(), 3);
    assert.equal(await page.locator('tbody img').count(), 0);
    const hostile = page.locator('.rowlink', { hasText: 'onerror' });
    assert.equal(await hostile.count(), 1);
    await hostile.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.drawer h2');
    assert.match(page.url(), /#\/enquiries\/3/);
    assert.match(await page.locator('.drawer h2').textContent(), /<img src=x onerror="window.__xss=2">/);
    assert.equal(await page.locator('.drawer img, .drawer script').count(), 0, 'the message and the name are text');
    assert.match(await page.locator('.drawer .msg').textContent(), /<script>window.__xss=4<\/script> text/);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('.drawer a[href^="mailto:enq2@example.test"]').count(), 1, 'one click to reply');
    assert.equal(await page.locator('.drawer .kv').textContent().then((t) => /enq2@example.test/.test(t)), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.drawer .msg')).whiteSpace), 'pre-wrap');

    await page.getByRole('button', { name: 'Mark as handled' }).click();
    await page.getByText('Marked as handled').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Mark as not handled' }).count(), 1);
    assert.match(await page.locator('.drawer .badge').textContent(), /Handled/);
    assert.deepEqual(await page.locator('.seg button').allTextContents(), ['All3', 'Not handled2', 'Handled1'], 'the list behind the panel caught up');
    assert.equal(await page.locator('#nav a[href="#/enquiries"] .nav__count').textContent(), '2');
    const sheet = h.named.Contact;
    assert.equal(sheet.rows[0].at(-1), 'Handled');
    assert.equal(sheet.rows[2][sheet.rows[0].indexOf('Handled')], 'Yes', 'sheet row 3 is the one marked');
    await page.getByRole('button', { name: 'Mark as not handled' }).click();
    await page.getByText('Marked as not handled').waitFor();
    assert.deepEqual(await page.locator('.seg button').allTextContents(), ['All3', 'Not handled3', 'Handled0']);
    await page.getByRole('button', { name: 'Mark as handled' }).click();
    await page.getByText('Marked as handled').waitFor();

    await page.keyboard.press('Escape');
    await page.waitForSelector('.drawer', { state: 'detached' });
    assert.match(await page.evaluate(() => document.activeElement.textContent), /onerror/, 'focus goes back to the row');
    await page.locator('.seg button', { hasText: 'Not handled' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
    await page.locator('.seg button', { hasText: /^Handled/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    await page.locator('.seg button', { hasText: 'All' }).click();
    await page.locator('#list-search').fill('second line 1');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1, null, { timeout: 5000 });
    assert.equal(await page.locator('.rowlink').textContent(), 'Ola1 Okoye', 'the message text is searchable');
    assert.deepEqual(errors, []);

    // a link straight to one enquiry opens its panel; a row that is gone says so
    await page.evaluate(() => { location.hash = '#/enquiries/2'; });
    await page.waitForSelector('.drawer h2');
    assert.equal(await page.locator('.drawer h2').textContent(), 'Ola1 Okoye');
    await page.evaluate(() => { location.hash = '#/enquiries/99'; });
    await page.waitForSelector('.drawer .banner');
    assert.match(await page.locator('.drawer .banner').textContent(), /not found/);
    await page.context().close();

    // opening the link in a new session works before the list has loaded
    const cold = await open(browser, h, { url });
    await cold.page.evaluate(() => { location.hash = '#/enquiries/4'; });
    await cold.page.waitForSelector('.drawer h2');
    assert.equal(await cold.page.locator('.drawer h2').textContent(), 'Ola3 Okoye');
    await cold.context.close();

    // a failed save is reported and nothing changes on screen
    const failing = await visit(h, '#/enquiries/2', { failures: { setEnquiryHandled: 'The sheet has changed since this page loaded.' } });
    await failing.page.waitForSelector('.drawer h2');
    await failing.page.getByRole('button', { name: 'Mark as handled' }).click();
    await failing.page.locator('.toast--bad').waitFor();
    assert.match(await failing.page.locator('.toast--bad').textContent(), /has changed/);
    assert.equal(await failing.page.getByRole('button', { name: 'Mark as handled' }).isEnabled(), true);
    await failing.context.close();
  }

  /* ── 1:1 sessions ── */
  {
    const { page, errors } = await visit(full(), '#/sessions');
    await page.waitForSelector('tbody tr');
    assert.equal(await rowsOf(page).count(), 2);
    assert.match(await page.locator('.summary').textContent(), /1 paid \(₦15,000\)\. Honour a booking only if its notes quote a reference listed here as Paid\. A session is ₦15,000\./);
    assert.deepEqual(await page.locator('.seg button').allTextContents(), ['All2', 'Paid1', 'Needs a check1']);
    assert.deepEqual(await page.locator('tbody .badge').allTextContents(), ['Check the amount', 'Paid'], 'newest first');
    assert.match(await page.locator('tbody').textContent(), /UU1-SESS0001/);
    await page.locator('.seg button', { hasText: 'Needs a check' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    assert.match(await page.locator('tbody').textContent(), /UU1-SESS0002/);
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Invites ── */
  {
    const h = full();
    const { page, errors, calls } = await visit(h, '#/invites');
    await page.waitForSelector('tbody tr');
    assert.equal(await rowsOf(page).count(), 2);
    assert.deepEqual(await page.locator('.seg button').allTextContents(), ['All2', 'Not used yet1', 'Used1']);
    assert.equal(await page.getByRole('link', { name: 'Open the enrolment for Used Person' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Copy invite link for Used Person' }).count(), 0, 'a used invite has no link to copy');

    // copy a link from the list
    await page.getByRole('button', { name: 'Copy invite link for Ngozi Eze' }).click();
    const listed = h.api('invites').data.items.find((i) => i.email === 'ngozi@example.test').link;
    assert.deepEqual(await copied(page), [listed]);

    // making one
    const before = calls.length;
    await page.getByRole('button', { name: 'Create invite' }).click();
    assert.equal(calls.length, before, 'an empty form sends nothing');
    await page.getByLabel('Name', { exact: true }).fill('Tunde Ade');
    await page.getByLabel('Email', { exact: true }).fill('tunde@example.test');
    await page.getByRole('button', { name: 'Create invite' }).click();
    await page.locator('.callout--ok').waitFor();
    const link = await page.getByLabel('Invite link', { exact: true }).inputValue();
    assert.match(link, /^https:\/\/script\.google\.com\/macros\/s\/AKfycby94krvGfIS7mXVT-szoGHHM_pCLIU11Bh_AemMxE_nsK-X_Hm1y8yaK69zNKfU20LT\/exec\?action=invite&token=/, 'the public address, which opens for the invitee');
    assert.match(await page.locator('.callout--ok').textContent(), /Invite ready for Tunde Ade\./);
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
    assert.deepEqual(await page.locator('.seg button').allTextContents(), ['All3', 'Not used yet2', 'Used1'], 'the list caught up');
    assert.equal(await page.locator('.callout--ok').count(), 1, 'the link stays on screen after the list refreshes');
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), '', 'the form is ready for the next one');
    await page.locator('.callout--ok').getByRole('button', { name: 'Copy' }).click();
    assert.equal((await copied(page)).at(-1), link);
    assert.equal(h.named['BA Bridge Invites'].rows.length, 4);

    // the same address again gives the same link; someone already enrolled is mentioned
    await page.getByLabel('Name', { exact: true }).fill('Tunde A');
    await page.getByLabel('Email', { exact: true }).fill('TUNDE@example.test');
    await page.getByRole('button', { name: 'Create invite' }).click();
    await page.getByText('already had an unused invite').waitFor();
    assert.equal(await page.getByLabel('Invite link', { exact: true }).inputValue(), link);
    assert.equal(h.named['BA Bridge Invites'].rows.length, 4, 'nothing was added');
    await page.getByLabel('Name', { exact: true }).fill('Chidi');
    await page.getByLabel('Email', { exact: true }).fill('chidi@example.test');
    await page.getByRole('button', { name: 'Create invite' }).click();
    await page.getByText('Chidi Paid already has an enrolment (BAB-UI3-AAA).').waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open it' }).getAttribute('href'), '#/enrolments/BAB-UI3-AAA');

    // from the list to the enrolment an invite produced
    await page.getByRole('link', { name: 'Open the enrolment for Used Person' }).click();
    await page.waitForSelector('.drawer h2');
    assert.equal(await page.locator('.drawer h2').textContent(), 'Chidi Paid');
    assert.deepEqual(errors, []);
    await page.context().close();

    // a refused request says why
    const refused = await visit(h, '#/invites', { failures: { createInvite: 'Enter a valid email address.' } });
    await refused.page.waitForSelector('tbody tr');
    await refused.page.getByLabel('Name', { exact: true }).fill('A');
    await refused.page.getByLabel('Email', { exact: true }).fill('a@example.test');
    await refused.page.getByRole('button', { name: 'Create invite' }).click();
    await refused.page.getByRole('alert').filter({ hasText: 'valid email' }).waitFor();
    await refused.context.close();
  }

  /* ── Adding an enrolment ── */
  {
    const h = full();
    const { page, errors, calls } = await visit(h, '#/new');
    await page.getByLabel('Full name *').waitFor();
    assert.equal(await page.locator('h1#title').textContent(), 'Add enrolment');
    assert.match(await page.locator('.summary').textContent(), /awaiting payment at ₦80,000/);
    const fill = async (extra = {}) => {
      await page.getByLabel('Full name *').fill(extra.name || 'Kemi Bello');
      await page.getByLabel('Email address *').fill(extra.email || 'kemi@example.test');
      await page.getByLabel('WhatsApp number *').fill('+234 800 000 0003');
      await page.getByLabel('City and country *').fill('Ibadan, Nigeria');
      await page.getByLabel('Current background *').selectOption(extra.background || 'Banking, finance, or insurance');
      await page.getByLabel('Years of work experience *').selectOption('5 to 9');
      await page.getByLabel('Stage of transition *').selectOption('Decided on BA, need structured training');
      await page.getByLabel('Heard about the training via *').selectOption(extra.source || 'LinkedIn');
    };
    await fill();

    // the "Other" boxes appear only when needed
    assert.equal(await page.getByLabel('Other background *').isVisible(), false);
    await page.getByLabel('Current background *').selectOption('Other');
    assert.equal(await page.getByLabel('Other background *').isVisible(), true);
    await page.getByLabel('Current background *').selectOption('Banking, finance, or insurance');
    assert.equal(await page.getByLabel('Other background *').isVisible(), false);

    // at most three wishes: the fourth box is switched off
    for (const label of ['Practical, job-ready skills', 'A portfolio project to show employers', 'Mentorship from a practising BA']) await page.getByLabel(label, { exact: true }).check();
    assert.equal(await page.getByLabel('Networking and job leads', { exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel('Other', { exact: true }).isDisabled(), true);
    await page.getByLabel('Practical, job-ready skills', { exact: true }).uncheck();
    assert.equal(await page.getByLabel('Networking and job leads', { exact: true }).isDisabled(), false);

    // the checks the form cannot do by itself
    const before = calls.length;
    await page.getByLabel('They agreed to their details', { exact: false }).check();
    await page.getByRole('button', { name: 'Add enrolment' }).click();
    assert.match(await page.getByRole('alert').filter({ hasText: 'availability' }).textContent(), /Choose at least one live-session availability option\./);
    assert.equal(calls.length, before, 'nothing is sent until the form is complete');
    await page.getByLabel('Saturday mornings', { exact: true }).check();
    for (const label of ['Practical, job-ready skills']) await page.getByLabel(label, { exact: true }).check();
    await page.getByLabel('Mentorship from a practising BA', { exact: true }).uncheck();
    await page.getByLabel('A portfolio project to show employers', { exact: true }).uncheck();
    await page.getByLabel('Practical, job-ready skills', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Add enrolment' }).click();
    assert.match(await page.getByRole('alert').filter({ hasText: 'most want' }).textContent(), /Choose between 1 and 3 things they most want\./);
    await page.getByLabel('A portfolio project to show employers', { exact: true }).check();
    await page.getByLabel('Mentorship from a practising BA', { exact: true }).check();

    // saving: it opens the new enrolment, ready to be paid for
    await page.getByRole('button', { name: 'Add enrolment' }).click();
    await page.waitForSelector('.drawer h2');
    assert.equal(await page.locator('.drawer h2').textContent(), 'Kemi Bello');
    assert.match(page.url(), /#\/enrolments\/BAB-OFF/);
    assert.match(await page.locator('.drawer').textContent(), /Awaiting payment/);
    assert.equal(await page.getByRole('button', { name: 'Confirm payment' }).count(), 1);
    assert.equal(h.enrolmentSheet.rows.length, 32);
    const reference = h.enrolmentSheet.rows.at(-1)[1];
    assert.match(reference, /^BAB-OFF/);
    assert.equal(h.cell(reference, 'What they want most'), 'A portfolio project to show employers, Mentorship from a practising BA');
    await page.getByText('Added Kemi Bello').waitFor();

    // the same email again is not added twice
    await page.evaluate(() => { location.hash = '#/new'; });
    await page.getByLabel('Full name *').waitFor();
    await fill({ name: 'Kemi B' });
    await page.getByLabel('A portfolio project to show employers', { exact: true }).check();
    await page.getByLabel('Saturday mornings', { exact: true }).check();
    await page.getByLabel('They agreed to their details', { exact: false }).check();
    await page.getByRole('button', { name: 'Add enrolment' }).click();
    await page.getByText('Kemi Bello already has a registration (' + reference + '). Nothing was added.').waitFor();
    assert.equal(h.enrolmentSheet.rows.length, 32);
    assert.equal(await page.getByRole('link', { name: 'Open it' }).getAttribute('href'), '#/enrolments/' + reference);
    assert.deepEqual(errors, []);
    await page.context().close();

    // a server refusal is shown in the form
    const refused = await visit(h, '#/new', { failures: { createOffline: 'Enter a valid email address.' } });
    await refused.page.getByLabel('Full name *').waitFor();
    await refused.page.getByLabel('Full name *').fill('A');
    await refused.page.getByLabel('Email address *').fill('a@example.test');
    await refused.page.getByLabel('WhatsApp number *').fill('1');
    await refused.page.getByLabel('City and country *').fill('x');
    await refused.page.getByLabel('Current background *').selectOption('Other');
    await refused.page.getByLabel('Other background *').fill('Teacher');
    await refused.page.getByLabel('Years of work experience *').selectOption('0 to 1');
    await refused.page.getByLabel('Stage of transition *').selectOption('Currently a BA, want to get stronger');
    await refused.page.getByLabel('Heard about the training via *').selectOption('Other');
    await refused.page.getByLabel('Other source *').fill('A podcast');
    await refused.page.getByLabel('Other', { exact: true }).check();
    await refused.page.getByLabel('Other goal *').fill('Move abroad');
    await refused.page.getByLabel('Weekday evenings', { exact: true }).check();
    await refused.page.getByLabel('They agreed to their details', { exact: false }).check();
    await refused.page.getByRole('button', { name: 'Add enrolment' }).click();
    await refused.page.getByRole('alert').filter({ hasText: 'valid email' }).waitFor();
    await refused.context.close();
  }

  /* ── Layouts: nothing scrolls sideways, tables turn into cards on phones ── */
  for (const width of [360, 390, 768, 1280]) {
    const { page, errors } = await visit(shared, '#/waitlist', { width, height: 800 });
    for (const hash of ['#/waitlist', '#/enquiries', '#/enquiries/3', '#/sessions', '#/invites', '#/new']) {
      await page.evaluate((x) => { location.hash = x; }, hash);
      await page.waitForSelector(hash === '#/new' ? 'main form' : hash.includes('/3') ? '.drawer h2' : 'tbody tr, .empty');
      assert.equal(await overflow(page), 0, `${hash} at ${width}px scrolls sideways`);
      if (hash === '#/enquiries/3') {
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // let the slide-in finish
        const box = await page.locator('.drawer').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'the panel fits');
      } else if (hash !== '#/new') {
        assert.equal(await page.locator('tbody tr').first().evaluate((tr) => getComputedStyle(tr).display), width >= 720 ? 'table-row' : 'grid', `${hash} rows at ${width}px`);
      }
    }
    // no page shows a stray "null" or "undefined" (an empty slot once printed as text)
    for (const hash of ['#/overview', '#/enrolments', '#/waitlist', '#/enquiries', '#/sessions', '#/invites', '#/new']) {
      await page.evaluate((x) => { location.hash = x; }, hash);
      await page.waitForSelector(hash === '#/new' ? 'main form' : hash === '#/overview' ? '.kpi' : 'tbody tr, .empty');
      assert.doesNotMatch(await page.locator('main').innerText(), /\bnull\b|\bundefined\b|\[object|NaN/, hash + ' shows stray text');
    }
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Accessibility ── */
  if (axeSource) {
    for (const scheme of ['light', 'dark']) {
      for (const width of [390, 1280]) {
        const session = await open(browser, shared, { url, scheme, width });
        const { page } = session;
        for (const [hash, ready] of [['#/waitlist', 'tbody tr'], ['#/enquiries', 'tbody tr'], ['#/enquiries/3', '.drawer h2'], ['#/sessions', 'tbody tr'], ['#/invites', 'tbody tr'], ['#/new', 'main form']]) {
          await page.evaluate((x) => { location.hash = x; }, hash);
          await page.waitForSelector(ready);
          assert.deepEqual(await axeViolations(page), [], `${hash} ${scheme}/${width}`);
        }
        if (width === 390) {
          await page.evaluate(() => { location.hash = '#/overview'; });
          await page.waitForSelector('.kpi');
          await page.locator('#more-btn').click();
          await page.waitForSelector('.sheet');
          assert.deepEqual(await axeViolations(page), [], `More menu ${scheme}/${width}`);
        }
        await session.context.close();
      }
    }
  } else {
    console.log('axe-core is not installed here; skipping the accessibility checks.');
  }
} catch (error) {
  failed = error;
} finally {
  await browser.close();
  server.close();
}
if (failed) throw failed;
console.log('Dashboard pages tests passed (waitlist, enquiries, sessions, invites, add enrolment, phone navigation).');
