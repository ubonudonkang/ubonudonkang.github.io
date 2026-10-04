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
- **Cohort promotion:** the BA Bridge card appears after the homepage stats and before the final dark CTA on content pages (after the form on Contact). Its HTML is repeated in those pages, so update the cohort status, dates, and links everywhere when they change. It is intentionally absent from BA Training, BA Workbench, and the 404 page.
- **February waitlist:** the November 2026 cohort is full. The BA Training page now collects name, email, and consent through the existing Formspree form `xdaqwayj`. The hidden `type` and `cohort` fields distinguish these inbox notifications from contact enquiries. No payment or BA enrolment is created by joining the waitlist. Do not describe a waitlist signup as a reserved place.

## Reopening BA Bridge registration

The November enrolment form and its Apps Script → Selar checkout logic are preserved in `scripts/ba_bridge_checkout.template.txt`. That plain-text file is **dormant**: the live BA Training page does not load or run it. `scripts/ba_bridge_enrolment.gs` remains the sheet and manual payment-confirmation source. Keep the waitlist page in place until the February offer is ready.

Before reopening, confirm the February start date, registration deadline, seat count, price, and Selar product. Set Selar's post-purchase return to `/ba-training/?payment=selar`, and check the deployed Apps Script endpoint and sheet. The archived browser code hardcodes the November `80000` amount and product URL; `createSignup_` in the Apps Script also hardcodes `80000`, so both must match the February price before any checkout is enabled. Update the confirmation email and any cohort-specific dates as well.

Restore the form and checkout handler from the template into `ba-training/index.html`, replacing its current waitlist form and Formspree setup. Keep the `BA_FLOW_SECTION` and `BA_FLOW_SCRIPT` marker comments around the restored blocks; the closing command uses them. Update the BA page's hero, FAQ, metadata, structured data, `#join` links and CSS, then update the repeated header and cohort CTAs throughout the HTML pages. Refresh the sitemap dates and adapt the offline tests to the reopened flow. Check a saved enrolment, Selar return, and manual reconciliation before publishing. Do not use a browser return as proof of payment; confirm each sale in Selar. Keep the November product sold out unless you deliberately update and reuse it; make the February product available only when its checkout is ready.

## Closing BA Bridge registration again

The Formspree waitlist form, earlier-buyer return handling, and script loader are saved in `scripts/ba_bridge_waitlist.template.txt` as a dormant plain-text template. After a future cohort fills, run `node scripts/close_ba_registration.mjs "February 2027" "May 2027"`, replacing those Month YYYY values with the cohort that filled and the planned next cohort. The command swaps the BA Training form and script, removes its checkout path, and points `#join` links on the BA page and other HTML pages to `#waitlist`. It can be run again with the same values without changing the pages.

Before publishing, update the BA page's hero, price/status card, FAQ, metadata and structured data, plus repeated sitewide CTAs and promotion cards; the command intentionally leaves that editorial copy for review. Update the sitemap and tests, and mark the closed Selar product sold out so its direct link cannot keep accepting purchases. The waitlist still sends name, email and consent to the existing Formspree inbox, and does not create a BA Training sheet row.

## Payments (Selar)

- **BA Bridge registration is closed:** the November product was sold at ₦80,000. The website no longer creates new BA applications or opens Selar checkout, but the full flow is retained as a dormant template for the February reopening. Disable or unpublish the November BA Bridge product in Selar separately, because a person with its direct link can otherwise still buy it. Do not reopen it for the February cohort until its date, capacity, price, and checkout flow are confirmed.
- **Earlier BA purchases:** the page still recognises a matching saved browser session when an earlier buyer returns with `?payment=selar`. It removes the query parameter and shows the existing reconciliation guidance, without offering a new checkout. The old Apps Script and sheet remain for processing earlier applications.
- **1:1 flow:** the form saves the visitor's name and email in browser session storage before opening Selar. A matching `?payment=selar` return unlocks Cal.com and preserves the prefilled booking details across a refresh. A return URL alone never unlocks booking.
- **Verification limitation:** a browser return, query parameter, or session-storage record is not server-verified proof of payment. The website does not mark a Google Sheet row paid from browser code. Reconcile each completed Selar sale with the retained BA reference.
- **BA Training sheet:** `scripts/ba_bridge_enrolment.gs` targets [this spreadsheet](https://docs.google.com/spreadsheets/d/1y5frsyZV52ciQ9AXP2_GKhnnCtXb5SrnfwBWV-4U2Sk/edit?gid=0#gid=0), tab `gid=0`. It remains available for earlier applications and manual payment reconciliation; the current website waitlist does not write to this sheet. Four Selar columns follow the original 26 headers: `Selar sale reference`, `Confirmation token`, `Confirmed at`, and `Confirmed by`.
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

GoatCounter records header and cohort-promotion waitlist CTA clicks, legacy cohort Selar returns, and Career Clarity checkout/return events. BA Bridge waitlist submissions use the existing Formspree inbox; live delivery has not been tested. A Selar return is not server-verified revenue or a confirmed booking. Reconcile earlier paid enrolments with Selar and the Apps Script records; Cal.com remains the Career Clarity booking record. Contact success events retain the engagement type selected when the form was submitted. Page visits use GoatCounter's existing pageview tracking.
