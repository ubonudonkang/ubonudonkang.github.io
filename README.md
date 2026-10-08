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
contact/index.html             Contact details and enquiry form (Formspree)
ba-training/index.html         BA Bridge Cohort: page-specific styles and February 2027 waitlist
css/site.css                   Design system shared by every page (starts with the @font-face rules)
fonts/                         Self-hosted Inter, Instrument Serif and JetBrains Mono (latin + latin-ext woff2)
js/site.js                     Dock, WAT clock, email copy (press C), scroll reveals, testimonials, draggable case file, PDF viewer
img/ubon-udonkang.jpg          Portrait used on the home and About pages
favicon.ico                    Favicon (16, 32, 48 px); browsers and Google request /favicon.ico
img/icon-192.png, icon-512.png Larger icons, listed in site.webmanifest
img/apple-touch-icon.png       iPhone/iPad home-screen icon (180 px)
site.webmanifest               Web app manifest (name, icons, colours)
docs/ams/                      Do not publish confidential client documents here
```

## Common edits

- **Contact form:** posts to Formspree form `xdaqwayj` (see `contact/index.html`).
- **Portrait:** replace `img/ubon-udonkang.jpg` with another photo of the same name. A 4:5 portrait works best.
- **AMS documents:** confidential originals must stay out of the public repository. The Data Dictionary is available by request only, subject to permission and redaction. Removing a file from the current site does not remove old copies from Git history or caches.
- **Testimonials:** short quotes live in the home page carousel. The full recommendations are on the About page.
- **Cohort promotion:** the BA Bridge card sits after the homepage stats while registration is open; the close command moves it before the homepage's final dark CTA. On other content pages it appears before the final dark CTA (after the form on Contact). The open command updates its repeated copy and links. It is intentionally absent from BA Training, BA Workbench, and the 404 page. Keep the `HOME_COHORT_PROMO` markers around the homepage card so both commands can move it.
- **February waitlist:** the November 2026 cohort is full. The BA Training page collects name, email, and consent and posts them to a Google Sheet through an Apps Script web app (the `Waitlist` sheet, with an email notification to the site owner). It does not use Formspree, so waitlist signups no longer reach the Formspree inbox shared with the contact form. The hidden `type`, `cohort` and `form_name` fields identify the signup, and the Apps Script skips repeat email and cohort combinations. The form posts with a `no-cors` `fetch` (Apps Script's redirect sends no CORS headers, so the response is always opaque) and treats any resolved request as success; only a network failure shows the error message. No payment or BA enrolment is created by joining the waitlist. Do not describe a waitlist signup as a reserved place.

## Reopening BA Bridge registration

The enrolment form and Apps Script → Selar checkout logic are preserved in `scripts/ba_bridge_checkout.template.txt`. That plain-text template is **dormant** while the public BA Training page is on the waitlist. The open command requires the new cohort month, actual start date, application deadline, number of seats, NGN price, Selar product URL, and deployed Apps Script URL. From the repository root, preview with your **real** details:

```sh
node scripts/open_ba_registration.mjs --cohort "February 2027" --start 2027-02-02 --deadline 2027-01-25 --seats 10 --price 80000 --selar https://selar.com/NEW_PRODUCT --apps-script https://script.google.com/macros/s/YOUR_DEPLOYMENT/exec
```

The values above show the syntax; the dates, amount, product and endpoint are **examples**, not confirmed February settings. The command validates them and lists the files it would change. Add `--apply` after checking the preview. It edits local files only. It restores the enrolment form, changes the browser price and Selar link, sets cohort-specific browser session keys, updates the BA Training copy and structured data, updates sitewide buttons and cohort cards, moves the homepage card below the hero, updates the Apps Script source's expected cohort/price, and refreshes sitemap dates. The sheet gains a `Cohort` column after the existing columns so future enrolments can be distinguished without moving old data.

**Before publishing:** deploy the updated `scripts/ba_bridge_enrolment.gs` to the Apps Script web app and make sure `--apps-script` names that deployment; verify its sheet and manual confirmation email. Set the Selar product price to match `--price` and its post-purchase return to `https://ubonudonkang.com/ba-training/?payment=selar`. Keep the old product sold out unless deliberately updated and reused. Run `node scripts/test_open_registration.mjs`, `node scripts/test_selar_flows.mjs`, and `node scripts/test_ba_bridge_script.mjs`, review the diff, then publish the website. No command here deploys Apps Script, changes Selar, or publishes the site. A browser return is not proof of payment; reconcile each sale in Selar before confirming a place.

## Closing BA Bridge registration again

The Google Sheets waitlist form, payment-return handling, and submit script are saved in `scripts/ba_bridge_waitlist.template.txt` as a dormant plain-text template. After a future cohort fills or reaches its deadline, run `node scripts/close_ba_registration.mjs "February 2027" "May 2027"`, replacing those Month YYYY values with the cohort that filled and the planned next cohort. The command swaps the BA Training form and script, removes its checkout path, keeps that cohort's browser return state available, points `#join` links to `#waitlist`, changes every header cohort button to the visible text **Join Waitlist**, and moves the homepage cohort promo from below the hero to just before the final dark CTA. It can be run again with the same values without changing the pages. Seat counts and the application deadline do not automatically disable checkout; run the close command and mark the Selar product sold out when registration ends.

Before publishing, update the BA page's hero, price/status card, FAQ, metadata and structured data, plus repeated promotional copy outside the header; the command intentionally leaves that editorial copy for review. Update the sitemap and tests, and mark the closed Selar product sold out so its direct link cannot keep accepting purchases. The waitlist sends name, email and consent to the waitlist Apps Script web app and does not create a BA Training sheet row. The template derives the hidden `form_name` (for example `ba-waitlist-may-2027`) from the next cohort.

## Payments (Selar)

- **BA Bridge registration is closed:** the November product was sold at ₦80,000. The website no longer creates new BA applications or opens Selar checkout, but the full flow is retained as a dormant template for a future reopening. Disable or unpublish the November BA Bridge product in Selar separately, because a person with its direct link can otherwise still buy it.
- **Earlier BA purchases:** the page still recognises a matching saved browser session when an earlier buyer returns with `?payment=selar`. It removes the query parameter and shows the existing reconciliation guidance, without offering a new checkout. The old Apps Script and sheet remain for processing earlier applications.
- **1:1 flow:** the form saves the visitor's name and email in browser session storage before opening Selar. A matching `?payment=selar` return unlocks Cal.com and preserves the prefilled booking details across a refresh. A return URL alone never unlocks booking.
- **Verification limitation:** a browser return, query parameter, or session-storage record is not server-verified proof of payment. The website does not mark a Google Sheet row paid from browser code. Reconcile each completed Selar sale with the retained BA reference.
- **BA Training sheet:** `scripts/ba_bridge_enrolment.gs` targets [this spreadsheet](https://docs.google.com/spreadsheets/d/1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk/edit?gid=0#gid=0), tab `gid=0`. It remains available for earlier applications and manual payment reconciliation; the current website waitlist does not write to this sheet. Four Selar columns follow the original 26 headers: `Selar sale reference`, `Confirmation token`, `Confirmed at`, and `Confirmed by`. A `Cohort` column follows them for future enrolments.
- **Manual confirmation:** the script sends a per-enrolment review link to `ubonanalyst@gmail.com`. Opening the link shows the record; a separate **Confirm payment** button changes its `Payment status` to `Paid — manually confirmed` and `Verified by you` to `Yes`. The optional Selar sale reference and amount paid can be recorded on that screen. Do not put Selar credentials or signing values in this repository.

## SEO and caching

- **Every page's `<head>`** has its own title, description, canonical URL, link-preview tags (Open Graph and Twitter) and structured data, between `<!--seo-->` and `<!--/seo-->`. Keep titles under 60 characters and descriptions between 110 and 160.
- **Structured data:** a Person and WebSite on the home page, ProfilePage on About, Course on BA Training, and breadcrumbs on the other pages. Check with Google's Rich Results Test after changes.
- **`sitemap.xml`** lists every public page. Add new pages to it and submit it in Google Search Console. **`robots.txt`** points to the sitemap and keeps `/docs/` out of search.
- **`404.html`** is the page GitHub Pages shows for missing URLs.
- **Share image:** `img/og-card.jpg` (1200×630, about 80 KB). **Home-screen icon:** `img/apple-touch-icon.png`.
- **Stylesheet:** `css/site.css` is the file to edit, but pages don't link to it: the build step (`seo.py`) copies it, lightly minified, into a `<style data-inline="site.css">` block in every page. GitHub Pages only lets browsers cache files for 10 minutes, so a separate stylesheet saved little and held up the first paint. After changing `css/site.css`, re-run the build so every page picks it up.
- **Cache busting:** pages load `/js/site.js?v=…`; the build sets `v=` from the file's contents, so browsers never pair a new page with an old cached script.

## Design notes

- White editorial layout: Instrument Serif headings, Inter body text, JetBrains Mono labels.
- **Light and dark themes.** All colours are tokens on `:root` in `css/site.css`. Light is the default for every visitor. Dark applies only when chosen with the top-bar toggle, and the choice is remembered in the browser. Use the tokens (`--ink`, `--paper`, `--surface`, `--on-ink`, `--accent-fill`...) rather than hard-coded colours. The case file on the home page deliberately stays "paper" in both themes.
- One accent colour, signature blue `#1F3BD6` (lightened to `#8FA2FF` for text in dark mode). Stamp red is used only on the "Approved" and "Delivered" stamps.
- The dock is the main navigation on every page. Its magnification only runs with a mouse.
- Respects reduced motion, reduced transparency and higher-contrast settings.

## Review conversion tracking

GoatCounter records header and cohort-promotion waitlist CTA clicks, legacy cohort Selar returns, and Career Clarity checkout/return events. BA Bridge waitlist submissions go to the waitlist Google Sheet and are not tracked as a GoatCounter event. A Selar return is not server-verified revenue or a confirmed booking. Reconcile earlier paid enrolments with Selar and the Apps Script records; Cal.com remains the Career Clarity booking record. Contact success events retain the engagement type selected when the form was submitted. Page visits use GoatCounter's existing pageview tracking.
