# Ubon Udonkang · Portfolio v6

**Live site:** https://ubonudonkang.com (custom domain, set in `CNAME`; `ubonudonkang.github.io` redirects here)

A static site served by GitHub Pages from the root of `main`. There is no build step: edit the HTML, CSS and JS directly.

## Publishing changes

Work on a branch, open a pull request, and merge it. GitHub Pages redeploys `main` automatically, usually within a minute or two.

```bash
git checkout -b my-change
git add .
git commit -m "Describe the change"
git push -u origin my-change
```

Never force-push to `main`: it rewrites history and can wipe out other changes.

## File structure

```
index.html                     Home: hero with portrait, stats, cohort, case file, services, work, testimonials, resources
about/index.html               Bio, 4C Framework, skills, experience, certifications, full LinkedIn recommendations
projects/index.html            Work: the five case studies
project-rights-issue/          Case study: ₦351B rights issue digitisation (Access Bank, 2024)
project-treasury-management/   Case study: treasury management system (Access Bank)
project-ams/                   Case study: accounting management system (government client)
project-rpa-treasury/          Case study: RPA for treasury digitalisation (Access Bank)
project-loan-approval/         Case study: loan approval automation across African subsidiaries (Access Bank)
resources/index.html           Paid and free resources
contact/index.html             Contact details and enquiry form
ba-training/index.html         BA Bridge Cohort: page-specific styles and February 2027 waitlist
css/site.css                   Design system shared by every page (starts with the @font-face rules)
fonts/                         Self-hosted Inter, Instrument Serif and JetBrains Mono (latin + latin-ext woff2), plus inter-naira.woff2: the naira sign on its own (1 KB)
js/site.js                     Dock, WAT clock, email copy (press C), scroll reveals, testimonials, draggable case file, PDF viewer
js/forms.js                    The one script for the contact, waitlist and BA enrolment forms (and the Apps Script endpoint they post to)
scripts/site_forms.gs          The one Apps Script web app behind those forms: enrolment, waitlist and contact tabs in one workbook
scripts/build_assets.mjs        The build step: inlines css/site.css into every page and stamps script versions (run it after editing css/site.css, js/site.js or js/forms.js)
img/ubon-udonkang.jpg          Portrait used on the home and About pages
favicon.ico                    Favicon (16, 32, 48 px); browsers and Google request /favicon.ico
img/icon-192.png, icon-512.png Larger icons, listed in site.webmanifest
img/apple-touch-icon.png       iPhone/iPad home-screen icon (180 px)
site.webmanifest               Web app manifest (name, icons, colours)
docs/ams/                      Do not publish confidential client documents here
```

## Common edits

- **Forms:** see [Forms and the Apps Script](#forms-and-the-apps-script). The contact form (`data-form="contact"`) posts to the same Apps Script as the waitlist and enrolment forms and writes to the `Contact` tab.
- **Portrait:** replace `img/ubon-udonkang.jpg` with another photo of the same name. A 4:5 portrait works best.
- **AMS documents:** confidential originals must stay out of the public repository. The Data Dictionary is available by request only, subject to permission and redaction. Removing a file from the current site does not remove old copies from Git history or caches.
- **Testimonials:** short quotes live in the home page carousel. The full recommendations are on the About page.
- **Cohort promotion:** the BA Bridge card sits after the homepage stats while registration is open; the close command moves it before the homepage's final dark CTA. On other content pages it appears before the final dark CTA (after the form on Contact). The open command updates its repeated copy and links. It is intentionally absent from BA Training, BA Workbench, and the 404 page. Keep the `HOME_COHORT_PROMO` markers around the homepage card so both commands can move it.
- **February waitlist:** the November 2026 cohort is full. The BA Training page collects name, email, and consent (`data-form="waitlist"`) and posts them through `js/forms.js` to the `Waitlist` tab, with an email notification to the site owner. The hidden `type`, `cohort` and `form_name` fields identify the signup, and the script skips repeat email and cohort combinations. No payment or BA enrolment is created by joining the waitlist. Do not describe a waitlist signup as a reserved place.

## Forms and the Apps Script

Every form on the site is handled by one browser script, `js/forms.js`, and one server script, `scripts/site_forms.gs`. A form says what it is with `data-form`; the endpoint lives only in `js/forms.js` (`ENDPOINT`).

| Form | Page | `data-form` | Lands in |
| --- | --- | --- | --- |
| Contact enquiry | `contact/` | `contact` | `Contact` tab |
| Cohort waitlist | `ba-training/` (closed) | `waitlist` | `Waitlist` tab |
| BA enrolment + Squad | `ba-training/` (open) | `enrol` | `BA Training` tab (gid 0) |
| 1:1 session payment | `resources/1-on-1-session/` | `session` | `Sessions` tab (from Squad's webhook) |

- The script routes a post by `form_name` (`contact`, `ba-waitlist-*`) or `action` (`signup`, and the admin, review and Selar actions). Each tab is matched by column heading, so the existing `Waitlist` headings (`name`, `email`, `cohort`, `consent`, `type`) keep working; a missing tab is created.
- Every submission carries a unique id or reference, and the script ignores repeats (same email and cohort for the waitlist, same `submission_id` for contact, same `reference` for enrolment). That is what makes the browser's retry safe. Google Sheets turns a typed or imported cohort such as `February 2027` into a real date, so the script reads a date in the `cohort` column back as `February 2027` (`cohortText_`) before comparing or counting.
- A hidden `_gotcha` field is the honeypot. Contact and waitlist notifications go to `SITE_NOTIFY_EMAIL`; payment reviews go to `NOTIFY_EMAIL`.
- `js/forms.js` reads the script's JSON answer when the browser allows it, so a rejected save shows the error message. If the browser blocks the answer (Apps Script's redirect can lack CORS headers) it resends once with `no-cors`; that send cannot be confirmed, so check the sheet after any deployment change.
- Keep `scripts/site_forms.gs` as the **only** file in the Apps Script project. A second file declaring the same top-level names (for example `NOTIFY_EMAIL`) stops the whole project compiling, and the forms then fail without any visible error.

**Deploying a change to the script:** paste `scripts/site_forms.gs` over the project's code, delete any other `.gs` files (the dashboard's `admin` HTML file is the one exception; see Admin dashboard below), run `checkSetup()` once, then *Deploy → Manage deployments → edit the existing deployment → New version* so the `/exec` URL does not change. Then submit one test form of each kind and confirm a row (and a notification email) arrives. The script's own secrets (admin key, Selar key, WhatsApp group link) stay in Script Properties, not in this repository.

## Admin dashboard

`scripts/admin.html.txt` is a responsive dashboard for the owner: a sidebar on laptops, a bottom tab bar (with a More menu) on phones, and these pages. It is the second half of `scripts/site_forms.gs`: the page is an HTML file in the Apps Script project, and it calls one server function, `adminApi`. The older admin page that opens with a key in its address still works until the dashboard is accepted.

| Page | What it does |
| --- | --- |
| Overview | What needs attention, key figures (each opens its page), system health, and shortcuts to add an enrolment or create an invite |
| Enrolments | Search, status filters and paging; a detail panel with notes, the review email, payment confirmation and the welcome-email resend |
| Add enrolment | For someone paying outside the website. Same checks and same row as the older "Add Offline Enrollee" page; opens the new enrolment, ready to be confirmed |
| Waitlist | Counts by cohort, search, repeats flagged (same email and cohort), **Copy emails** (each address once) and **Download CSV** |
| Enquiries | Contact-form messages with a panel, a Reply by email link, and **Mark as handled** |
| 1:1 sessions | Paid session payments and any with an unexpected amount; honour a booking only if its notes quote a reference listed here as Paid |
| Invites | Create a private registration link (the same link is reused for an unused invite to the same address), copy links, and see which were used |

**First deployment (about ten minutes):**

1. In the Apps Script project, paste the new `scripts/site_forms.gs` over `Code.gs` (still the only `.gs` file).
2. Add the page: *Files +* → *HTML*, name it exactly `admin`, and paste all of `scripts/admin.html.txt` into it.
3. Run `checkSetup()` once and accept any new permission prompt.
4. *Deploy → Manage deployments → edit the existing deployment → New version*. This keeps the `/exec` address that the website and Squad use, and adds the new `Admin notes` column to the BA Training sheet the first time it is needed.
5. *Deploy → New deployment → Web app*, **Execute as: Me**, **Who has access: Only myself**. Copy its URL; that is the dashboard. Open it signed in as `ubonudonkang@gmail.com` (bookmark it, or *Add to Home Screen* on a phone).

**Safe by construction:** the public deployment never serves the dashboard to a stranger. Even on the public address, every `adminApi` call checks that the signed-in Google account is the account the script runs as, or one of the two addresses already set as `NOTIFY_EMAIL` and `SITE_NOTIFY_EMAIL` in the script, so a stranger who finds the page code still gets nothing. Google, not the page, says who is signed in. If Google ever shows the script no address, the check refuses. To let another account in (untested; Google may hide other people's addresses from the script), list it in the script property `BA_BRIDGE_ADMIN_EMAILS` (comma separated) and widen the dashboard deployment's access.

**If the dashboard address does not show the dashboard:** open the dashboard deployment's address followed by `?action=app`, then match what you see.

| You see | Cause | Fix |
| --- | --- | --- |
| `{"result":"error","message":"Unsupported action."}` | The deployment still runs an older version of the code | *Deploy → Manage deployments*, pencil on the dashboard deployment, *Version: New version*, *Deploy* |
| `Dashboard page missing` | There is no HTML file called `admin` in the project | *Files +* → *HTML*, name it `admin`, paste `scripts/admin.html.txt`, then deploy a new version |
| `Not authorised` and "Google did not tell the script which account" | The deployment is not set to *Execute as: Me* | Edit the deployment, set *Execute as: Me* and *Who has access: Only myself* |
| `Not authorised` and "You are signed in as …" | Google gave the script an address that is not the account it runs as and not one of the two owner addresses | If it is your account, add it to the script property `BA_BRIDGE_ADMIN_EMAILS` and reload; otherwise open the address in a private window signed in only as the owner |
| Google's "unable to open the file" page | Wrong Google account, or a deployment that was deleted | As above; copy the address again from *Manage deployments* |
| The dashboard frame is there but empty, with no "Build" label in the sidebar corner | The `admin` file in the project, or the deployment's version, is older than `scripts/admin.html.txt` | Paste the current file into `admin`, save it (Ctrl+S), then edit the dashboard deployment to *New version* |
| "Starting the dashboard..." that never goes away | The page's script was blocked or never ran | Reload in a private window; send a screenshot |
| A red line "The dashboard could not start: ... SyntaxError ... (line N, column M)" followed by "Received, line N: ..." | The copy of the page that reached the browser differs from `scripts/admin.html.txt` at that spot (a half-pasted or altered copy). The page stays plain ASCII with no template strings so that copy and paste, and Google's page frame, have as little as possible to change | Paste again from the downloaded file opened in a plain text editor, not from a rendered preview; if it still fails, send the "Received" line |
| A red line starting "The dashboard hit a problem and stopped" | The page's script failed; the line says why (a half-pasted file shows as a syntax error with a line number) | Paste the whole file again; if it persists, send the line |
| The plain `BA Bridge endpoint is online.` message without `?action=app` | Normal on the public deployment; on the dashboard deployment it means Google gave the script no account | Use the `?action=app` address to see which case applies |

**After every later change** to either file, both deployments need *New version* (the public one for the website, the dashboard one for the owner), because each deployment keeps its own version.

**Notes:**

- The page builds everything with `textContent` and `createElementNS`, never `innerHTML`, because names, emails and notes are typed by strangers, and because Google's page frame can refuse string-to-HTML assignments (an earlier version drew its icons that way and showed a blank page). The test serves the page under that same rule. If a script error ever does happen, the page says so on screen instead of staying blank. `scripts/test_admin_ui.mjs` includes a name written as an `<img onerror>` tag and checks that it shows as text.
- Inside Apps Script the page runs in a frame, so its links (`#/enrolments/BAB-…`) work for navigation and the Back button but cannot be pasted as deep links into the dashboard's address.
- The `Admin notes` column holds your notes about a person. Nothing reads it except the dashboard.
- Invite links point at the public address the website uses (`WEB_APP_URL`), not the dashboard, so they open for the person they are sent to.
- **Mark as handled** adds a `Handled` column to the Contact tab the first time it is used; nothing else reads it. The page sends back what it was showing, so a row that has moved (a deleted line) is never changed by mistake.
- CSV downloads start with a byte-order mark so spreadsheet programs read names correctly, and any text that starts with `=`, `+`, `-` or `@` is made plain so a stranger's text cannot run as a formula. Apps Script's frame can block downloads; if nothing arrives, use **Copy emails** instead.
- A Google Sheets cell holding a cohort such as `February 2027` is stored as a date, so the cohort is read back as words before it is counted (see Forms and the Apps Script).
- Dashboard buttons call the same code as the review-email link (confirming a payment sends the same welcome email, copied to the same addresses), so both can be used side by side.
- Tests: `node scripts/test_admin_api.mjs` covers access, figures, filters, detail and actions against the Apps Script stand-in (`scripts/gas_harness.mjs`). `node scripts/test_admin_ui.mjs` (overview, enrolments and the shell) and `node scripts/test_admin_pages.mjs` (the other pages and the phone menu) drive the page in Chromium against the same code (layouts at six widths, keyboard use, focus handling, dark mode, accessibility with axe when `axe-core` is available) and skips itself when Playwright is missing.

## Reopening BA Bridge registration

The enrolment form is preserved in `scripts/ba_bridge_checkout.template.txt`; its behaviour (saving the application to the Apps Script, then opening Squad checkout) lives in `js/forms.js`. The template is **dormant** while the public BA Training page is on the waitlist. Before the first reopening, put the Squad public key in `SQUAD_PUBLIC_KEY` in `js/forms.js` (see Payments (Squad) below); the command refuses to apply without it. The open command requires the new cohort month, actual start date, application deadline, number of seats and NGN price, and (only if you deployed the Apps Script somewhere new) the Apps Script URL. From the repository root, preview with your **real** details:

```sh
node scripts/open_ba_registration.mjs --cohort "February 2027" --start 2027-02-02 --deadline 2027-01-25 --seats 10 --price 80000
```

The values above show the syntax; the dates and amount are **examples**, not confirmed February settings. The command validates them and lists the files it would change. Add `--apply` after checking the preview. It edits local files only. It restores the enrolment form, sets the price, cohort and browser session keys on the form, updates the BA Training copy and structured data, updates sitewide buttons and cohort cards, moves the homepage card below the hero, updates the Apps Script source's expected price, and refreshes sitemap dates. Without `--apps-script` the form uses the endpoint in `js/forms.js`; pass it only to point this cohort at a different deployment.

**Before publishing:** deploy the updated `scripts/site_forms.gs` as a new version of the Apps Script web app (the command sets its `EXPECTED_AMOUNT`); put the live public key in `js/forms.js`; check Squad's webhook and redirect URLs (below); and make one sandbox payment end to end. Run `node scripts/test_open_registration.mjs`, `node scripts/test_selar_flows.mjs`, `node scripts/test_forms.mjs`, `node scripts/test_assets.mjs` and `node scripts/test_ba_bridge_script.mjs`, review the diff, then publish the website. No command here deploys Apps Script, changes Squad, or publishes the site. Squad's payment report makes the Apps Script verify the payment and email you the review link; compare it with the Squad dashboard before pressing Confirm.

## Closing BA Bridge registration again

The waitlist form (its payment-return handling is in `js/forms.js`) is saved in `scripts/ba_bridge_waitlist.template.txt` as a dormant plain-text template. After a future cohort fills or reaches its deadline, run `node scripts/close_ba_registration.mjs "February 2027" "May 2027"`, replacing those Month YYYY values with the cohort that filled and the planned next cohort. The command swaps the BA Training form, removes its checkout path, keeps that cohort's browser return state available, points `#join` links to `#waitlist`, changes every header cohort button to the visible text **Join Waitlist**, and moves the homepage cohort promo from below the hero to just before the final dark CTA. It can be run again with the same values without changing the pages. Seat counts and the application deadline do not automatically disable checkout; run the close command and mark the Selar product sold out when registration ends.

Before publishing, update the BA page's hero, price/status card, FAQ, metadata and structured data, plus repeated promotional copy outside the header; the command intentionally leaves that editorial copy for review. Update the sitemap and tests, and mark the closed Selar product sold out so its direct link cannot keep accepting purchases. The waitlist sends name, email and consent to the `Waitlist` tab and does not create a BA Training sheet row. The template derives the hidden `form_name` (for example `ba-waitlist-may-2027`) from the next cohort.

## Payments (Squad)

BA Bridge enrolments and the 1:1 session are paid through Squad by GTCO (card, bank transfer or USSD). The session payment is live; the enrolment flow is dormant until the next cohort opens, because the BA Training page is on the waitlist.

- **BA Bridge registration is closed:** the November cohort was sold at ₦80,000 through Selar. The website no longer creates new BA applications or opens any checkout; the Squad flow below is retained as a dormant template for the next cohort. Disable or unpublish the November BA Bridge product in Selar separately, because a person with its direct link can otherwise still buy it.
- **Flow:** the enrolment form saves the application to the Apps Script as `Awaiting payment`, then `js/forms.js` opens Squad's inline checkout with the reference `BAB-…-1` (`-2`, `-3` for retries, since Squad needs a fresh reference each attempt). The price comes from the form (`data-amount`, set by the open command) and is sent to Squad in kobo.
- **Keys:** the public key is `SQUAD_PUBLIC_KEY` in `js/forms.js` (`sandbox_pk_…` while testing, `pk_…` live; public keys are meant to sit in page code). The secret key lives only in the Apps Script (Project Settings → Script Properties → `SQUAD_SECRET_KEY`, `sandbox_sk_…` or `sk_…`) and is never committed; a test fails if a secret key appears in a shipped file. Sandbox and live keys must match the mode of the payment being checked.
- **Squad dashboard:** set the **Webhook URL** to the Apps Script `/exec` URL (the same one `ENDPOINT` in `js/forms.js` uses), with no query string, and the **Redirect URL** to `https://ubonudonkang.com/ba-training/`. Squad adds `?reference=…` to the redirect, which the page uses to show the buyer their reference. Checkout runs in a window on the page for both products, so the redirect is mainly a fallback. The account has one redirect URL, so if Squad ever did navigate after an in-window payment, a 1:1 session buyer would land on the BA Training page; the earlier sandbox test of both pages did not, but check once after setting it. Do this in both sandbox and live modes.
- **Recognising a payment:** a paid transaction reaches the Apps Script two ways, Squad's webhook (a JSON `charge_successful` post) and the browser (`action=payment`, sent when checkout reports success or the buyer returns). Both end in one function that asks Squad's verify API about the reference with the secret key and trusts nothing in the request. A verified payment of exactly `EXPECTED_AMOUNT` marks the row `Paid (Squad verified)`; a different amount or currency marks it `Squad payment: amount needs review`. It is safe for the same payment to arrive many times.
- **Review email:** as soon as a payment is verified the Apps Script emails the review link to `ubonanalyst@gmail.com`. No one needs to press anything. Opening the link changes nothing; **Confirm payment** on that page sets `Paid — manually confirmed`, `Verified by you` = `Yes`, and sends the student's welcome email. A second successful payment for an already-paid enrolment sends a separate warning so it can be refunded.
- **Webhook limits:** Apps Script cannot read request headers, so Squad's `x-squad-encrypted-body` signature is not checked; the verify call is what makes a forged webhook harmless, and references that are not awaiting payment in the sheet are ignored without calling Squad. Apps Script also cannot answer with an error status, so Squad cannot retry a webhook that arrived while its API was down. Run `installSquadSweepTrigger()` once: every 30 minutes it re-checks enrolments still awaiting payment (last 7 days).
- **Checks:** run `checkSetup()` in the editor to see whether the secret key is set and whether it is a sandbox or live key, and `testSquadVerify()` (after pasting a reference into it) to see what Squad says about one payment without changing the sheet.
- **Verification limitation:** a browser return, query parameter, or session-storage record is not server-verified proof of payment. Only the Apps Script's own check with Squad marks a row paid.
- **1:1 session (live):** `resources/1-on-1-session/` takes the name and email, opens Squad checkout for ₦15,000 (`data-amount` on the form) with the reference `UU1-…`, and unlocks the Cal.com button when checkout reports success, with the reference in the booking notes. That unlock trusts the browser, as the Selar return did, and the Cal.com link has always been visible in the page script, so the real check is server side: Squad's webhook (or the browser's report) makes the Apps Script verify the payment, add it to the `Sessions` tab and email `ubonudonkang@gmail.com`. A booking should be honoured only if its notes quote a reference that appears there as `Paid`; `CHECK AMOUNT` means the amount was not ₦15,000. The price lives in two places that a test keeps equal: `data-amount` on the page and `SESSION_AMOUNT` in the Apps Script. Unknown `UU1-` references are looked up at most 60 times an hour so strangers cannot use up the script's Squad calls.
- **Earlier Selar payments:** the November cohort was paid through Selar. A buyer returning with `?payment=selar` still sees their reference, and the Apps Script keeps its Selar handler and columns for those sales. Nothing new is sold through Selar for BA Bridge or the 1:1 session. The "Apply Like You Mean It" ebook on the Resources page still links to its own Selar listing.
- **BA Training sheet:** `scripts/site_forms.gs` targets [this spreadsheet](https://docs.google.com/spreadsheets/d/1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk/edit?gid=0#gid=0), tab `gid=0`, for enrolments and manual payment reconciliation; the waitlist and contact forms write to their own tabs in the same workbook. The script adds the Selar, confirmation and email-status columns after the original 26 headers.

## SEO and caching

- **Every page's `<head>`** has its own title, description, canonical URL, link-preview tags (Open Graph and Twitter) and structured data, between `<!--seo-->` and `<!--/seo-->`. Keep titles under 60 characters and descriptions between 110 and 160.
- **Structured data:** a Person and WebSite on the home page, ProfilePage on About, Course on BA Training, and breadcrumbs on the other pages. Check with Google's Rich Results Test after changes.
- **`sitemap.xml`** lists every public page. Add new pages to it and submit it in Google Search Console. **`robots.txt`** points to the sitemap and keeps `/docs/` out of search.
- **`404.html`** is the page GitHub Pages shows for missing URLs.
- **Share image:** `img/og-card.jpg` (1200×630, about 80 KB). **Home-screen icon:** `img/apple-touch-icon.png`.
- **Stylesheet:** `css/site.css` is the file to edit, but pages don't link to it: `node scripts/build_assets.mjs` copies it, lightly minified, into a `<style data-inline="site.css">` block in every page. GitHub Pages only lets browsers cache files for 10 minutes, so a separate stylesheet saved little and held up the first paint. After changing `css/site.css`, run the build so every page picks it up (`node scripts/build_assets.mjs --check` lists pages that are out of date, and `node scripts/test_assets.mjs` fails if any are). The BA Workbench is a self-contained tool with its own styles and is not touched.
- **Cache busting:** pages load `/js/site.js?v=…` and `/js/forms.js?v=…`; the same build sets each `v=` from the file's contents, so browsers never pair a new page with an old cached script.
- **Fonts:** the naira sign (₦) is the only character the site uses from the latin-ext range, and the 85 KB Inter latin-ext file used to download on every page that showed a price just to draw it. It now comes from `fonts/inter-naira.woff2`, and the big latin-ext faces no longer claim U+20A6 (the other latin-ext characters, for example accented names, still load them). To rebuild the small file: `pyftsubset fonts/inter-latin-ext.woff2 --unicodes=U+20A6 --flavor=woff2 --layout-features='' --output-file=fonts/inter-naira.woff2` (needs `pip install fonttools brotli`).
- **Accessibility and speed checks:** after larger changes, run an axe scan and Lighthouse against a local server (`python3 -m http.server`). The last scan found no violations on 11 pages in both themes at phone and desktop widths, and the home page scored 96 for performance on Lighthouse's simulated mobile profile. `test_assets.mjs` keeps the text colours fixed in that scan above 4.5 : 1.

## Design notes

- White editorial layout: Instrument Serif headings, Inter body text, JetBrains Mono labels.
- **Light and dark themes.** All colours are tokens on `:root` in `css/site.css`. Light is the default for every visitor. Dark applies only when chosen with the top-bar toggle, and the choice is remembered in the browser. Use the tokens (`--ink`, `--paper`, `--surface`, `--on-ink`, `--accent-fill`...) rather than hard-coded colours. The case file on the home page deliberately stays "paper" in both themes.
- One accent colour, signature blue `#1F3BD6` (lightened to `#8FA2FF` for text in dark mode). Stamp red is used only on the "Approved" and "Delivered" stamps.
- The dock is the main navigation on every page. Its magnification only runs with a mouse.
- Respects reduced motion, reduced transparency and higher-contrast settings.

## Review conversion tracking

GoatCounter records header and cohort-promotion waitlist CTA clicks, legacy cohort Selar returns, Squad checkout opens and completed payments (`cohort-squad-checkout-opened`, `cohort-squad-paid`, `session-squad-checkout-opened`, `session-squad-paid`), and Career Clarity checkout/return events. BA Bridge waitlist submissions go to the waitlist Google Sheet and are not tracked as a GoatCounter event. A Selar return, or a browser report of a Squad payment, is not verified revenue or a confirmed booking; the Apps Script's check with Squad is. Reconcile earlier paid enrolments with Selar and the Apps Script records; Cal.com remains the Career Clarity booking record. Contact success events retain the engagement type selected when the form was submitted (`contact-enquiry-<type>`, counted by `js/forms.js`). Page visits use GoatCounter's existing pageview tracking.
