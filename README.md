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
index.html                     Home: hero with portrait, case file, services, work, cohort, testimonials, resources
about/index.html               Bio, 4C Framework, skills, experience, certifications, full LinkedIn recommendations
projects/index.html            Work: the five case studies
project-rights-issue/          Case study: ₦351B rights issue digitisation (Access Bank, 2024)
project-treasury-management/   Case study: treasury management system (Access Bank)
project-ams/                   Case study: accounting management system (government client)
project-rpa-treasury/          Case study: RPA for treasury digitalisation (Access Bank)
project-loan-approval/         Case study: loan approval automation across African subsidiaries (Access Bank)
resources/index.html           Paid and free resources
contact/index.html             Contact details and enquiry form (Formspree)
ba-training/index.html         BA Bridge Cohort: page-specific styles, enrolment form and payment modal
css/site.css                   Design system shared by every page (starts with the @font-face rules)
fonts/                         Self-hosted Inter, Instrument Serif and JetBrains Mono (latin + latin-ext woff2)
js/site.js                     Dock, WAT clock, email copy (press C), scroll reveals, testimonials, draggable case file, PDF viewer
img/ubon-udonkang.jpg          Portrait used on the home and About pages
favicon.ico                    Favicon (16, 32, 48 px); browsers and Google request /favicon.ico
img/icon-192.png, icon-512.png Larger icons, listed in site.webmanifest
img/apple-touch-icon.png       iPhone/iPad home-screen icon (180 px)
site.webmanifest               Web app manifest (name, icons, colours)
docs/ams/                      AMS case study documents opened in the PDF viewer
```

## Common edits

- **Contact form:** posts to Formspree form `xdaqwayj` (see `contact/index.html`).
- **Portrait:** replace `img/ubon-udonkang.jpg` with another photo of the same name. A 4:5 portrait works best.
- **AMS documents:** add a PDF to `docs/ams/`, then give its row in `project-ams/index.html` a `data-pdf` path and a `View` button, like the Data Dictionary row.
- **Testimonials:** short quotes live in the home page carousel. The full recommendations are on the About page.

## Payments (Squad by GTCO)

- **Where it runs:** the BA Bridge Cohort enrolment (`ba-training/`, ₦80,000) and the 1:1 session (`resources/1-on-1-session/`, ₦15,000) open Squad's inline checkout. There is no bank-transfer option.
- **Public key:** set `SQUAD_PUBLIC_KEY` near the bottom of `js/site.js`. Use `sandbox_pk_…` while testing and `pk_…` in production. Public keys are safe in page code. While it is empty, both pages show "Online payment is not switched on yet".
- **Secret key:** never in this repo. It lives only in the cohort's Google Apps Script (Project Settings → Script properties → `SQUAD_SECRET_KEY`), which checks each cohort payment with Squad's verify API before marking the row Paid.
- **Cohort flow:** the form saves the enrolment to the Apps Script endpoint (`ENDPOINT_URL` in `ba-training/index.html`) as "Awaiting payment", opens checkout with the reference `BAB-…-1` (`-2`, `-3` for retries), then posts `action=payment` so the script can verify it.
- **1:1 flow:** pay first; the Cal.com button then unlocks with the visitor's name, email and Squad reference filled in. The Squad dashboard is the record of these payments.
- **Checkout script:** `https://checkout.squadco.com/widget/squad.min.js` loads only when someone starts paying. If you enforce a Content Security Policy, allow it in `script-src` and `frame-src`.

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
