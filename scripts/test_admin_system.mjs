import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, chromePath, axeSource, BUILD, squadOk, seeded, populate, populateMore, serve, open, until, axeViolations, overflow } from './admin_ui_helpers.mjs';

/* The System page (payments, the automatic check, the payment lookup), the CSV and copy buttons on the Enrolments, Enquiries and Sessions pages,
   and the quiet refresh when the tab is shown again. */

if (!chromium) { console.log('Playwright is not installed here; skipping the dashboard page tests.'); process.exit(0); }

const full = () => populateMore(populate(seeded()));
const shared = full();
const html = shared.context.doGet({ parameter: {} }).html;
const { server, url } = await serve(html);
const browser = await chromium.launch({ executablePath: chromePath });
const spyClipboard = (page) => page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = (text) => { window.__copied.push(text); return Promise.resolve(); }; });
const copied = (page) => page.evaluate(() => window.__copied);
const visit = async (backend, hash, options = {}) => {
  const session = await open(browser, backend, { url, ...options });
  await session.page.evaluate((x) => { location.hash = x; }, hash);
  await spyClipboard(session.page);
  return session;
};
const row = (page, label) => page.locator('.health li').filter({ has: page.getByText(label, { exact: true }) }).first();
const csvOf = async (download) => fs.readFileSync(await download.path(), 'utf8');
let failed = null;
try {
  /* ── The System page ── */
  {
    const h = full();
    const { page, errors } = await visit(h, '#/system');
    await page.waitForSelector('#h-pay');
    assert.equal(await page.locator('h1#title').textContent(), 'System');
    assert.match(await row(page, 'Squad key').textContent(), /Sandbox/);
    assert.match(await page.locator('.hint', { hasText: 'sandbox key only recognises test payments' }).textContent(), /SQUAD_SECRET_KEY/);
    assert.match(await row(page, 'Last report from Squad').textContent(), /just now\s*charge_successful - ok/);
    assert.match(await row(page, 'Automatic payment check').textContent(), /Off/);
    assert.equal(await page.getByLabel('Webhook URL for the Squad dashboard').inputValue(), 'https://script.google.com/macros/s/AKfycby94krvGfIS7mXVT-szoGHHM_pCLIU11Bh_AemMxE_nsK-X_Hm1y8yaK69zNKfU20LT/exec');
    assert.equal(await page.getByLabel('Redirect URL for the Squad dashboard').inputValue(), 'https://ubonudonkang.com/ba-training/');
    await page.locator('.linkbox', { has: page.getByLabel('Webhook URL for the Squad dashboard') }).getByRole('button', { name: 'Copy' }).click();
    assert.match((await copied(page))[0], /^https:\/\/script\.google\.com\/macros\/s\/AKfycby94k/);
    assert.match(await row(page, 'Sends left today').textContent(), /100/);
    assert.match(await row(page, 'Payment review emails go to').textContent(), /ubonanalyst@gmail\.com/);
    assert.match(await row(page, 'Welcome emails are copied to').textContent(), /alabioluwafunmito@gmail\.com, ubonudonkang@gmail\.com/);
    assert.match(await row(page, 'Cohort').textContent(), /₦80,000/);
    assert.match(await row(page, '1:1 session').textContent(), /₦15,000/);
    assert.equal(await page.getByLabel('WhatsApp group link').inputValue(), 'https://chat.whatsapp.com/TestGroup123');
    assert.match(await row(page, 'BA Training (enrolments)').textContent(), /30 rows/);
    assert.match(await row(page, 'Waitlist').textContent(), /6 rows/);
    assert.match(await row(page, 'Contact').textContent(), /3 rows/);
    assert.match(await row(page, 'BA Bridge Invites').textContent(), /2 rows/);
    assert.equal(await page.getByRole('link', { name: 'Open the spreadsheet' }).getAttribute('href'), 'https://docs.google.com/spreadsheets/d/1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk/edit');
    assert.equal(await page.getByRole('link', { name: 'Open the spreadsheet' }).getAttribute('target'), '_blank');
    assert.match(await row(page, 'Signed in as').textContent(), /owner@example\.test/);
    assert.match(await row(page, 'Accounts allowed in').textContent(), /owner@example\.test, ubonanalyst@gmail\.com, ubonudonkang@gmail\.com/);

    // turning the automatic check on
    await page.getByRole('button', { name: 'Turn on' }).click();
    await page.getByText('The automatic payment check is on').waitFor();
    await page.waitForFunction(() => /On, every 30 min/.test(document.body.textContent));
    assert.equal(await page.getByRole('button', { name: 'Turn on' }).count(), 0);
    assert.equal(h.triggers.length, 1);

    // running it by hand finds a payment whose report never arrived
    h.answers['BAB-UI1-AAA-2'] = squadOk();
    await page.getByRole('button', { name: 'Check now' }).click();
    await page.waitForFunction(() => /newly paid 1, errors 0/.test(document.body.textContent));
    assert.match(h.cell('BAB-UI1-AAA', 'Payment status'), /Paid \(Squad verified\)/);
    assert.match(await page.locator('[role="status"]', { hasText: 'Checked' }).textContent(), /The review emails have been sent\./);
    assert.deepEqual(errors, []);
    await page.context().close();

    // a failing server, and the last report from Squad once there is one
    const broken = await visit(h, '#/system', { failures: { system: 'The sheet is busy' } });
    await broken.page.waitForSelector('.banner');
    assert.match(await broken.page.locator('.banner').textContent(), /The sheet is busy/);
    await broken.context.close();
    // before Squad has ever reported
    const fresh = await visit(seeded(), '#/system');
    await fresh.page.waitForSelector('#h-pay');
    assert.match(await row(fresh.page, 'Last report from Squad').textContent(), /None yet/);
    assert.match(await row(fresh.page, 'BA Training (enrolments)').textContent(), /0 rows/);
    assert.match(await row(fresh.page, 'Waitlist').textContent(), /not created yet/);
    await fresh.context.close();
  }

  /* ── Looking up a payment, and recording it ── */
  {
    const h = full();
    const { page, errors } = await visit(h, '#/system');
    await page.getByLabel('Payment reference').waitFor();
    const snapshot = () => JSON.stringify(h.enrolmentSheet.rows);
    const before = snapshot();
    const mails = h.emails.length;

    await page.getByLabel('Payment reference').fill('nonsense');
    await page.getByRole('button', { name: 'Check with Squad' }).click();
    await page.getByRole('alert').filter({ hasText: 'does not look like a BA Bridge payment reference' }).waitFor();

    await page.getByLabel('Payment reference').fill('BAB-UI1-AAA-1');
    await page.getByRole('button', { name: 'Check with Squad' }).click();
    await page.getByText('Not found at Squad').waitFor();
    assert.match(await page.locator('.callout--warn').textContent(), /Squad has no payment with this reference/);
    assert.equal(await page.getByRole('button', { name: 'Record this payment' }).count(), 0);

    h.answers['BAB-UI1-AAA-1'] = squadOk({ customer_name: 'Adaeze Awaiting', email: 'adaeze@example.test' });
    await page.getByLabel('Payment reference').fill(' BAB-UI1-AAA-1 ');
    await page.getByRole('button', { name: 'Check with Squad' }).click();
    await page.getByRole('button', { name: 'Record this payment' }).waitFor();
    const result = page.locator('[aria-live="polite"]', { hasText: 'Squad says' });
    assert.match(await result.textContent(), /Squad says\s*Paid/);
    assert.match(await result.textContent(), /₦80,000 \(expected ₦80,000\)\s*Matches/);
    assert.match(await result.textContent(), /Adaeze Awaiting, adaeze@example\.test/);
    assert.match(await result.textContent(), /In your sheet\s*Adaeze Awaiting \(BAB-UI1-AAA\)/);
    assert.equal(await result.getByRole('link', { name: 'the enrolment' }).getAttribute('href'), '#/enrolments/BAB-UI1-AAA');
    assert.equal(snapshot(), before, 'looking up changes nothing');
    assert.equal(h.emails.length, mails);

    // cancelling the question changes nothing; Escape too
    await page.getByRole('button', { name: 'Record this payment' }).click();
    await page.waitForSelector('.dialog');
    assert.match(await page.locator('.dialog').textContent(), /emails you the review link/);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForSelector('.dialog', { state: 'detached' });
    await page.getByRole('button', { name: 'Record this payment' }).click();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.dialog', { state: 'detached' });
    assert.equal(snapshot(), before);

    await page.getByRole('button', { name: 'Record this payment' }).click();
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.getByText('Recorded. The review email has been sent.').waitFor();
    assert.match(h.cell('BAB-UI1-AAA', 'Payment status'), /Paid \(Squad verified\)/);
    assert.equal(h.emails.filter((m) => /ubonanalyst@gmail\.com/.test(m.to || '')).length >= 1, true);
    assert.equal(await page.getByRole('link', { name: 'Open the enrolment' }).getAttribute('href'), '#/enrolments/BAB-UI1-AAA');

    // looking again says it is recorded and offers nothing
    await page.getByLabel('Payment reference').fill('BAB-UI1-AAA-1');
    await page.getByRole('button', { name: 'Check with Squad' }).click();
    await page.getByText('This payment is already recorded.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Record this payment' }).count(), 0);

    // a different amount is shown as different
    h.answers['BAB-UI2-AAA-1'] = squadOk({ transaction_amount: 100000 });
    await page.getByLabel('Payment reference').fill('BAB-UI2-AAA-1');
    await page.getByRole('button', { name: 'Check with Squad' }).click();
    await page.getByText('Different').waitFor();
    assert.match(await page.locator('[aria-live="polite"]', { hasText: 'Squad says' }).textContent(), /₦1,000 \(expected ₦80,000\)/);

    // a 1:1 session
    h.answers['UU1-SESS0009'] = squadOk({ transaction_amount: 1500000, customer_name: 'Sess Person', email: 'sess@example.test' });
    await page.getByLabel('Payment reference').fill('UU1-SESS0009');
    await page.getByRole('button', { name: 'Check with Squad' }).click();
    await page.getByText('Not recorded yet').waitFor();
    await page.getByRole('button', { name: 'Record this payment' }).click();
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.getByText('Recorded in the Sessions tab, and you were emailed.').waitFor();
    assert.equal(h.api('sessions').data.counts.paid, 2);
    assert.deepEqual(errors, []);
    await page.context().close();

    // no key set: the page says what to do
    const keyless = full();
    delete keyless.properties.SQUAD_SECRET_KEY;
    const k = await visit(keyless, '#/system');
    await k.page.getByLabel('Payment reference').waitFor();
    assert.match(await row(k.page, 'Squad key').textContent(), /Not set/);
    await k.page.getByLabel('Payment reference').fill('BAB-UI1-AAA-1');
    await k.page.getByRole('button', { name: 'Check with Squad' }).click();
    await k.page.getByRole('alert').filter({ hasText: 'SQUAD_SECRET_KEY' }).waitFor();
    await k.context.close();
  }

  /* ── Copy and download, for everything a filter matches ── */
  {
    const h = full();
    const { page, errors } = await visit(h, '#/enrolments');
    await page.waitForSelector('tbody tr');
    assert.equal(await page.locator('tbody tr').count(), 25);

    // the whole of a filter, not the page on screen
    await page.getByRole('button', { name: 'Copy emails' }).click();
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.equal((await copied(page))[0].split(', ').length, 30, 'all 30, though only 25 are on the page');
    await page.locator('.seg button', { hasText: 'Needs confirmation' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
    await page.getByRole('button', { name: 'Copy emails' }).click();
    await page.waitForFunction(() => window.__copied.length === 2);
    assert.equal((await copied(page))[1], 'dayo@example.test, chidi@example.test');

    await page.locator('.seg button', { hasText: 'All' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 25);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
    assert.match(download.suggestedFilename(), /^enrolments-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await csvOf(download);
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    const lines = csv.slice(1).trim().split('\r\n');
    assert.equal(lines.length, 31, 'a header and all 30');
    assert.match(lines[0], /^Reference,Name,Email,WhatsApp,City and country,/);
    assert.ok(!/token|note/i.test(lines[0]));
    assert.ok(lines.some((l) => l.startsWith('BAB-UI3-AAA,Chidi Paid,chidi@example.test,') && /,Needs confirmation,Paid \(Squad verified\),80000,/.test(l)));
    assert.ok(!lines.slice(1).some((l) => /^[=+\-@]/.test(l)));

    // nothing matches: it says so rather than downloading an empty file
    await page.locator('#enrol-search').fill('nobody-by-that-name');
    await page.waitForSelector('.empty');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    await page.getByText('Nothing matches, so there is nothing to download.').waitFor();
    await page.getByRole('button', { name: 'Copy emails' }).click();
    await page.getByText('No email addresses match.').waitFor();

    // enquiries and 1:1 sessions
    await page.evaluate(() => { location.hash = '#/enquiries'; });
    await page.waitForSelector('tbody tr');
    const [enq] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
    const enqLines = (await csvOf(enq)).slice(1).trim().split('\r\n');
    assert.equal(enqLines[0], 'Name,Email,Company,Topic,Message,Received,Site,Handled');
    assert.equal(enqLines.length >= 4, true);
    assert.ok((await csvOf(enq)).includes('"Hello, I would like to know more.\nSecond line 1"'), 'a message with a comma and a line break is quoted');
    await page.evaluate(() => { location.hash = '#/sessions'; });
    await page.waitForSelector('tbody tr');
    const [ses] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
    const sesLines = (await csvOf(ses)).slice(1).trim().split('\r\n');
    assert.equal(sesLines[0], 'Reference,Name,Email,Amount (NGN),Status,Reported by,Date');
    assert.equal(sesLines.length, 3);
    assert.ok(sesLines.some((l) => l.startsWith('UU1-SESS0001,') && l.includes(',15000,Paid,')));
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Overview shortcuts, and a quiet refresh when the tab is shown again ── */
  {
    const h = full();
    const { page, calls } = await open(browser, h, { url });
    await page.waitForSelector('.kpi');
    assert.match(await page.locator('.updated').textContent(), /^Updated /);
    assert.equal(await page.locator('.card', { hasText: 'System' }).getByRole('link', { name: 'Details' }).getAttribute('href'), '#/system');
    const overviews = () => calls.filter((c) => c === 'overview').length;
    const away = (minutes) => page.evaluate(async (m) => {
      const realNow = Date.now.bind(Date);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      Date.now = () => realNow() + m * 60 * 1000;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      Date.now = realNow;
    }, minutes);
    const first = overviews();
    await away(2);
    await page.waitForTimeout(300);
    assert.equal(overviews(), first, 'a short absence refreshes nothing');
    await away(6);
    await until(() => overviews() === first + 1);
    assert.equal(await page.locator('.toast').count(), 0, 'and it does so quietly');

    // other pages come up to date too, but a form being filled in is left alone
    await page.evaluate(() => { location.hash = '#/waitlist'; });
    await page.waitForSelector('tbody tr');
    const waitlistCalls = () => calls.filter((c) => c === 'waitlist').length;
    const w = waitlistCalls();
    await away(6);
    await until(() => waitlistCalls() === w + 1);
    await page.evaluate(() => { location.hash = '#/new'; });
    await page.getByLabel('Full name *').fill('Half Typed');
    const total = calls.length;
    await away(6);
    await page.waitForTimeout(300);
    assert.equal(calls.length, total, 'nothing is reloaded under a form');
    assert.equal(await page.getByLabel('Full name *').inputValue(), 'Half Typed');
    await page.context().close();
  }

  /* ── Layouts and accessibility ── */
  for (const width of [360, 390, 768, 1280]) {
    const { page, errors } = await visit(shared, '#/system', { width, height: 800 });
    await page.waitForSelector('#h-pay');
    assert.equal(await overflow(page), 0, `system at ${width}px scrolls sideways`);
    assert.doesNotMatch(await page.locator('main').innerText(), /\bnull\b|\bundefined\b|\[object|NaN/);
    await page.getByLabel('Payment reference').fill('BAB-UI3-AAA-1');
    shared.answers['BAB-UI3-AAA-1'] = shared.answers['BAB-UI3-AAA-1'] || squadOk();
    await page.getByRole('button', { name: 'Check with Squad' }).click();
    await page.getByText('Squad says').waitFor();
    assert.equal(await overflow(page), 0, `a lookup at ${width}px scrolls sideways`);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  if (axeSource) {
    for (const scheme of ['light', 'dark']) {
      for (const width of [390, 1280]) {
        const { page } = await visit(shared, '#/system', { scheme, width });
        await page.waitForSelector('#h-pay');
        assert.deepEqual(await axeViolations(page), [], `system ${scheme}/${width}`);
        await page.getByLabel('Payment reference').fill('BAB-FILL00-AAA-1');
        shared.answers['BAB-FILL00-AAA-1'] = squadOk({ transaction_amount: 100000 });
        await page.getByRole('button', { name: 'Check with Squad' }).click();
        await page.getByText('Different').waitFor();
        assert.deepEqual(await axeViolations(page), [], `lookup result ${scheme}/${width}`);
        await page.getByRole('button', { name: 'Record this payment' }).click();
        await page.waitForSelector('.dialog');
        assert.deepEqual(await axeViolations(page), [], `record dialog ${scheme}/${width}`);
        await page.context().close();
      }
    }
    for (const scheme of ['light', 'dark']) {
      const { page } = await visit(shared, '#/enrolments', { scheme, width: 1280 });
      await page.waitForSelector('tbody tr');
      assert.deepEqual(await axeViolations(page), [], `enrolments with the new buttons ${scheme}`);
      await page.context().close();
    }
  }
} catch (error) {
  failed = error;
} finally {
  await browser.close();
  server.close();
}
if (failed) throw failed;
console.log('Dashboard system tests passed (system page, payment lookup, exports, quiet refresh).');
