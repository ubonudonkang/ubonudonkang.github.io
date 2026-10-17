import assert from 'node:assert/strict';
import { chromium, chromePath, axeSource, BUILD, DAY, enrolOf, webhook, postJson, seeded, populate, serve, open, until, axeViolations, overflow, rowsOf } from './admin_ui_helpers.mjs';

/* Drives the dashboard page (scripts/admin.html.txt) in a real browser against the real server code (scripts/site_forms.gs, run in the Apps Script stand-in).
   Enrolments, the shell, themes, errors and the page's own failure reporting are here; the other pages are in test_admin_pages.mjs. */

if (!chromium) { console.log('Playwright is not installed here; skipping the dashboard page tests.'); process.exit(0); }

const owner = populate(seeded());
const html = owner.context.doGet({ parameter: {} }).html;
const { server, url } = await serve(html);
const browser = await chromium.launch({ executablePath: chromePath });
let failed = null;
try {
  /* ── Overview, navigation, owner identity ── */
  {
    const { page, errors } = await open(browser, owner, { url });
    await page.waitForSelector('.kpi');
    assert.equal(await page.locator('h1#title').textContent(), 'Overview');
    assert.equal(await page.title(), 'Overview · BA Bridge Admin');
    assert.match(await page.locator('.kpis').textContent(), /Enrolments\s*30/);
    assert.match(await page.locator('.kpis').textContent(), /Needs confirmation\s*2/);
    const attention = await page.locator('.attn__item').allTextContents();
    assert.equal(attention.length, 4, 'every attention item is listed');
    assert.match(attention[0], /Urgent/);
    assert.match(await page.locator('.card', { hasText: 'System' }).textContent(), /Sandbox/);
    assert.match(await page.locator('#nav .nav__count').textContent(), /^4$/, 'the sidebar shows how many items need attention');
    await page.waitForFunction(() => document.getElementById('user').textContent === 'owner@example.test');

    // the main landmark moves with navigation; Enrolments is one click away
    await page.locator('#nav a', { hasText: 'Enrolments' }).click();
    await page.waitForSelector('tbody tr');
    assert.equal(await page.locator('h1#title').textContent(), 'Enrolments');
    assert.equal(await page.locator('#nav a[aria-current="page"]').textContent(), 'Enrolments4');
    assert.equal(await rowsOf(page).count(), 25, 'one page of results');
    assert.match(await page.locator('.pager').textContent(), /1–25 of 30/);
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Filters, search, paging, and the address keeps them ── */
  {
    const { page, errors } = await open(browser, owner, { url });
    await page.locator('#nav a', { hasText: 'Enrolments' }).click();
    await page.waitForSelector('tbody tr');
    await page.locator('.seg button', { hasText: 'Needs confirmation' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
    assert.match(page.url(), /status=review/);
    assert.equal(await page.locator('.seg button[aria-pressed="true"]').textContent(), 'Needs confirmation2');
    assert.deepEqual((await page.locator('tbody .rowlink').allTextContents()).sort(), ['Chidi Paid', 'Dayo Wrong Amount']);
    assert.equal(await page.locator('.badge--bad').count(), 1, 'a wrong amount is flagged differently from an ordinary payment');

    await page.locator('.seg button', { hasText: 'All' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 25);
    await page.locator('#enrol-search').fill('chidi@');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    assert.match(page.url(), /q=chidi/);
    await page.locator('#enrol-search').fill('nobody-by-that-name');
    await page.waitForSelector('.empty');
    assert.match(await page.locator('.empty').textContent(), /No enrolments match/);

    await page.locator('#enrol-search').fill('');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 25);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5);
    assert.match(await page.locator('.pager').textContent(), /26–30 of 30/);
    assert.equal(await page.getByRole('button', { name: 'Next' }).isDisabled(), true);
    // filters and pages replace the address instead of adding to it, so Back leaves the list; Forward brings it back as it was
    await page.goBack();
    await page.waitForSelector('.kpi');
    assert.equal(await page.locator('h1#title').textContent(), 'Overview');
    await page.goForward();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5);
    assert.match(await page.locator('.pager').textContent(), /26–30 of 30/);

    // the "/" shortcut jumps to search
    await page.locator('h1#title').focus();
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'enrol-search');
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Slow answers: a late reply to an earlier choice must not replace the latest one ── */
  {
    const delays = { enrolments: [] };
    const { page, errors } = await open(browser, owner, { url, delays });
    await page.evaluate(() => { location.hash = '#/enrolments'; });
    await page.waitForSelector('tbody tr');
    delays.enrolments.push(900, 0);
    await page.locator('.seg button', { hasText: 'Needs confirmation' }).click(); // slow
    await page.locator('.seg button', { hasText: 'Awaiting payment' }).click(); // fast
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 25);
    await page.waitForTimeout(1200);
    assert.equal(await rowsOf(page).count(), 25, 'the slow answer for the earlier filter was ignored');
    assert.equal(await page.locator('.seg button[aria-pressed="true"]').textContent(), 'Awaiting payment27');
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Drawer: open, keyboard, return focus, nothing typed by a visitor becomes markup ── */
  {
    const { page, errors } = await open(browser, owner, { url });
    await page.evaluate(() => { location.hash = '#/enrolments'; });
    await page.waitForSelector('tbody tr');

    const hostile = page.locator('.rowlink', { hasText: 'Mallory' });
    assert.equal(await hostile.count(), 1);
    assert.equal(await page.locator('tbody img').count(), 0, 'a name that looks like markup is shown as text');
    await hostile.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.drawer h2');
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('.drawer img').count(), 0);
    assert.match(await page.locator('.drawer h2').textContent(), /<img src=x onerror="window.__xss=1"> Mallory/);
    assert.equal(await page.evaluate(() => document.querySelector('.drawer').contains(document.activeElement)), true, 'focus moves into the drawer');
    assert.match(page.url(), /#\/enrolments\/BAB-UI6-AAA/);

    // Tab never leaves the drawer
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('.drawer').contains(document.activeElement)), true, `Tab ${i}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('.drawer', { state: 'detached' });
    assert.doesNotMatch(page.url(), /BAB-UI6/);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '<img src=x onerror="window.__xss=1"> Mallory', 'focus goes back to the row that opened it');

    // a deep link opens the drawer straight away
    await page.evaluate(() => { location.hash = '#/enrolments/BAB-UI3-AAA'; });
    await page.waitForSelector('.drawer h2');
    assert.equal(await page.locator('.drawer h2').textContent(), 'Chidi Paid');
    assert.match(await page.locator('.drawer').textContent(), /Needs confirmation/);
    await page.locator('.scrim').click({ position: { x: 20, y: 300 } });
    await page.waitForSelector('.drawer', { state: 'detached' });

    // an unknown reference says so, and can be closed
    await page.evaluate(() => { location.hash = '#/enrolments/BAB-NOPE'; });
    await page.waitForSelector('.drawer .banner');
    assert.match(await page.locator('.drawer .banner').textContent(), /not found/);
    assert.equal(await page.locator('.drawer .banner button').count(), 0, 'retrying a missing enrolment would not help');
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.waitForSelector('.drawer', { state: 'detached' });
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Actions: review email, notes, confirmation, resend ── */
  {
    const h = populate(seeded());
    const { page, errors, calls } = await open(browser, h, { url });
    await page.evaluate(() => { location.hash = '#/enrolments/BAB-UI3-AAA'; });
    await page.waitForSelector('.drawer h2');

    // A note typed but not yet saved survives the drawer being redrawn after an action.
    await page.locator('#note').fill('Asked to start in March. Paid by transfer.');
    const before = h.emails.length;
    const reloads = calls.filter((c) => c === 'enrolment').length;
    await page.getByRole('button', { name: 'Send review email' }).click();
    await page.waitForSelector('.toast');
    assert.match(await page.locator('.toast').first().textContent(), /Review email sent to/);
    assert.equal(h.emails.length, before + 1);
    await until(() => calls.filter((c) => c === 'enrolment').length > reloads);
    assert.equal(await page.locator('#note').inputValue(), 'Asked to start in March. Paid by transfer.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.getByText('Note saved').waitFor();
    assert.equal(h.cell('BAB-UI3-AAA', 'Admin notes'), 'Asked to start in March. Paid by transfer.');

    // confirmation needs an explicit yes, and Escape or Cancel changes nothing
    await page.getByRole('button', { name: 'Confirm payment' }).click();
    await page.waitForSelector('.dialog');
    assert.equal(await page.locator('#dialog-field').inputValue(), '80000');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-field');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.dialog', { state: 'detached' });
    assert.ok(await page.locator('.drawer').isVisible(), 'Escape closes only the dialog');
    assert.doesNotMatch(String(h.cell('BAB-UI3-AAA', 'Verified by you')), /yes/i);

    const welcomeBefore = h.emails.length;
    await page.getByRole('button', { name: 'Confirm payment' }).click();
    await page.locator('#dialog-field').fill('abc');
    await page.getByRole('button', { name: 'Confirm and send welcome email' }).click();
    await page.waitForFunction(() => document.querySelector('.dialog .err') && document.querySelector('.dialog .err').textContent.length > 0);
    assert.equal(h.emails.length, welcomeBefore, 'a bad amount is refused before any email goes out');
    await page.locator('#dialog-field').fill('80000');
    await page.getByRole('button', { name: 'Confirm and send welcome email' }).click();
    await page.waitForSelector('.dialog', { state: 'detached' });
    await page.waitForFunction(() => /Confirmed/.test(document.querySelector('.drawer .badge').textContent));
    const welcome = h.emails.slice(welcomeBefore).find((m) => /welcome/i.test(m.subject || ''));
    assert.ok(welcome, 'the welcome email was sent');
    assert.equal(welcome.to, 'chidi@example.test');
    assert.match(h.cell('BAB-UI3-AAA', 'Verified by you'), /Yes/);
    assert.equal(await page.getByRole('button', { name: 'Confirm payment' }).count(), 0, 'nothing left to confirm');

    // the list behind the drawer has caught up
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.waitForFunction(() => /Needs confirmation\s*1/.test(document.querySelector('.seg').textContent));

    // resending asks first
    await page.evaluate(() => { location.hash = '#/enrolments/BAB-UI5-AAA'; });
    await page.getByRole('button', { name: 'Resend welcome email' }).click();
    await page.waitForSelector('.dialog');
    const resendBefore = h.emails.length;
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(h.emails.length, resendBefore);
    await page.getByRole('button', { name: 'Resend welcome email' }).click();
    await page.getByRole('button', { name: 'Send again' }).click();
    await page.waitForSelector('.dialog', { state: 'detached' });
    assert.equal(h.emails.length, resendBefore + 1);
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Layouts: no sideways scrolling, the right navigation for each width ── */
  for (const width of [360, 390, 768, 1024, 1280, 1600]) {
    const { page, errors } = await open(browser, owner, { url, width, height: 800 });
    await page.waitForSelector('.kpi');
    assert.equal(await overflow(page), 0, `overview at ${width}px scrolls sideways`);
    const mobile = width < 900;
    assert.equal(await page.locator('#tabbar').isVisible(), mobile, `tab bar at ${width}px`);
    assert.equal(await page.locator('#side').isVisible(), !mobile, `sidebar at ${width}px`);
    await page.evaluate(() => { location.hash = '#/enrolments'; });
    await page.waitForSelector('tbody tr');
    assert.equal(await overflow(page), 0, `enrolments at ${width}px scrolls sideways`);
    // below 720px the table turns into cards: the header is visually hidden and each row is its own box
    assert.equal((await page.locator('thead').boundingBox()).width > 1, width >= 720, `table header at ${width}px`);
    assert.equal(await page.locator('tbody tr').first().evaluate((tr) => getComputedStyle(tr).display), width >= 720 ? 'table-row' : 'grid', `row layout at ${width}px`);
    await page.evaluate(() => { location.hash = '#/enrolments/BAB-UI3-AAA'; });
    await page.waitForSelector('.drawer h2');
    assert.equal(await overflow(page), 0, `drawer at ${width}px scrolls sideways`);
    const box = await page.locator('.drawer').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `drawer fits at ${width}px`);
    // touch targets on phones
    if (mobile) {
      for (const button of await page.locator('.drawer .actions .btn').all()) assert.ok((await button.boundingBox()).height >= 44, 'buttons are at least 44px tall on a phone');
      const tab = await page.locator('#tabbar a').first().boundingBox();
      assert.ok(tab.height >= 44);
    }
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── Theme: follows the device, can be switched, and is remembered ── */
  {
    const { page } = await open(browser, owner, { url, scheme: 'dark' });
    await page.waitForSelector('.kpi');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // a colour change can land a frame after the click when the browser is set to reduce motion
    const bgIs = (colour) => page.waitForFunction((c) => getComputedStyle(document.body).backgroundColor === c, colour);
    assert.equal(await bg(), 'rgb(14, 14, 16)', 'dark device, dark page');
    await page.locator('#theme-top').click();
    await bgIs('rgb(246, 244, 239)');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.reload();
    await page.waitForSelector('.kpi');
    assert.equal(await bg(), 'rgb(246, 244, 239)', 'the choice is remembered');
    await page.context().close();
  }

  /* ── Accessibility ── */
  if (axeSource) {
    for (const scheme of ['light', 'dark']) {
      for (const width of [390, 1280]) {
        const { page } = await open(browser, owner, { url, scheme, width });
        await page.waitForSelector('.kpi');
        assert.deepEqual(await axeViolations(page), [], `overview ${scheme}/${width}`);
        await page.evaluate(() => { location.hash = '#/enrolments'; });
        await page.waitForSelector('tbody tr');
        assert.deepEqual(await axeViolations(page), [], `enrolments ${scheme}/${width}`);
        await page.evaluate(() => { location.hash = '#/enrolments/BAB-UI3-AAA'; });
        await page.waitForSelector('.drawer h2');
        assert.deepEqual(await axeViolations(page), [], `drawer ${scheme}/${width}`);
        await page.getByRole('button', { name: 'Confirm payment' }).click();
        await page.waitForSelector('.dialog');
        assert.deepEqual(await axeViolations(page), [], `dialog ${scheme}/${width}`);
        await page.context().close();
      }
    }
  } else {
    console.log('axe-core is not installed here; skipping the accessibility checks.');
  }

  /* ── A frame that refuses history.replaceState: filters and search still work ── */
  {
    const { page, errors } = await open(browser, owner, { url, before: () => { history.replaceState = () => { throw new DOMException('refused', 'SecurityError'); }; } });
    await page.evaluate(() => { location.hash = '#/enrolments'; });
    await page.waitForSelector('tbody tr');
    await page.locator('.seg button', { hasText: 'Needs confirmation' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
    assert.match(page.url(), /status=review/);
    assert.deepEqual(errors, []);
    await page.context().close();
  }

  /* ── The file survives being carried through Google's pages: plain ASCII, and no template strings ── */
  {
    // A real deployment failed with a syntax error at the start of a template string that Chromium accepts when the file is served directly.
    // Whatever Google changes on the way, plain quotes and ASCII text are the least likely to be touched.
    assert.equal(/[^\x00-\x7F]/.test(html), false, 'the page is ASCII only; write symbols as \\u escapes');
    assert.equal(html.includes('`'), false, 'no template strings in the page');
    assert.equal(html.includes('${'), false);
  }

  /* ── The page says what is wrong when its own script cannot run, and which build it is ── */
  {
    const good = await open(browser, owner, { url });
    await good.page.waitForSelector('.kpi');
    assert.equal(await good.page.locator('#boot').count(), 0, 'the startup line goes away once the dashboard is drawn');
    assert.equal(await good.page.locator('.side__build').textContent(), BUILD);
    await good.context.close();

    // The dashboard script has a syntax error (a half-pasted file, or a copy altered on the way). Google writes the page into its frame
    // with document.write, which reports the error in its own words and counts lines from the start of the script, so test that route.
    const wrapped = (page) => `<!doctype html><meta charset=utf-8><iframe id="f" style="width:900px;height:500px"></iframe><script>
      const html = ${JSON.stringify(page).replace(/<\//g, '<\\/')};
      const d = document.getElementById('f').contentDocument; d.open(); d.write(html); d.close();
    </script>`;
    const broken = await serve(wrapped(html.replace("'use strict';", "'use strict';\nconst = ;")), '');
    const brokenPage = await (await browser.newContext()).newPage();
    await brokenPage.goto(broken.url);
    const inner = () => brokenPage.frames().find((f) => f !== brokenPage.mainFrame());
    await brokenPage.waitForFunction(() => { const f = document.getElementById('f'); const b = f.contentDocument.getElementById('boot'); return b && /could not start/.test(b.textContent); });
    const shown = await inner().locator('#boot').textContent();
    assert.match(shown, /The dashboard could not start: .*SyntaxError.*\(line \d+, column \d+\)/);
    assert.match(await inner().locator('.boot__src').textContent(), /Received, line 4: const = ;/, 'the line is shown as the page received it');
    assert.equal(await inner().locator('.side__build').textContent(), BUILD, 'the build stamp is static, so it shows even then');
    await brokenPage.context().close();
    broken.server.close();

    // The page's security rule lets the first small script run but blocks the dashboard script.
    const { createHash } = await import('node:crypto');
    const early = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const sealed = await serve(html, `script-src 'sha256-${createHash('sha256').update(early).digest('base64')}'`);
    const blocked = await open(browser, owner, { url: sealed.url });
    await blocked.page.waitForFunction(() => /blocked by a security rule/.test(document.getElementById('boot').textContent));
    assert.match(await blocked.page.locator('#boot').textContent(), /script-src/);
    await blocked.context.close();
    sealed.server.close();

    // The old page (no startup line, no build stamp) is what a stale deployment would still serve; this one never shows blank.
    assert.match(html, /Starting the dashboard/);
  }

  /* ── A script error is shown on the page, not left as a blank screen ── */
  {
    const { page } = await open(browser, owner, { url });
    await page.waitForSelector('.kpi');
    await page.evaluate(() => { setTimeout(() => { throw new Error('boom from the test'); }); });
    await page.waitForSelector('.banner--fatal');
    assert.match(await page.locator('.banner--fatal').textContent(), /The dashboard hit a problem and stopped: boom from the test/);
    assert.equal(await page.locator('.banner--fatal').count(), 1);
    await page.context().close();
  }

  /* ── Errors: a failing server, and a visitor who is not the owner ── */
  {
    const { page } = await open(browser, owner, { url, failures: { overview: 'Service unavailable' } });
    await page.waitForSelector('.banner');
    assert.match(await page.locator('.banner').textContent(), /Service unavailable/);
    assert.equal(await page.getByRole('button', { name: 'Try again' }).count(), 1);
    await page.context().close();

    const stranger = populate(seeded({ user: { active: 'stranger@example.test' } }));
    const refused = await open(browser, stranger, { url });
    await refused.page.waitForSelector('.banner');
    assert.match(await refused.page.locator('.banner').textContent(), /Only the site owner/);
    assert.equal(await refused.page.locator('.kpi').count(), 0, 'no figures are shown to a stranger');
    assert.equal(await refused.page.locator('#user').textContent(), '');
    await refused.context.close();
  }
} catch (error) {
  failed = error;
} finally {
  await browser.close();
  server.close();
}
if (failed) throw failed;
console.log('Dashboard page tests passed.');
