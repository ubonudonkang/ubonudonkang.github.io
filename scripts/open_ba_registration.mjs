import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const SECTION_START = '<!-- BA_FLOW_SECTION_START -->';
const SECTION_END = '<!-- BA_FLOW_SECTION_END -->';
const SCRIPT_START = '<!-- BA_FLOW_SCRIPT_START -->';
const SCRIPT_END = '<!-- BA_FLOW_SCRIPT_END -->';
const MONTH_YEAR = /^(January|February|March|April|May|June|July|August|September|October|November|December) (20\d{2})$/;

function one(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
  if (matches.length !== 1) throw new Error(`Expected one ${label}; found ${matches.length}. Review the page before reopening.`);
  return source.replace(pattern, replacement);
}

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const endStart = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || endStart < 0 || source.indexOf(startMarker, start + 1) >= 0 ||
      source.indexOf(endMarker, endStart + 1) >= 0) throw new Error(`Expected one ${startMarker} block.`);
  return { start, end: endStart + endMarker.length, text: source.slice(start, endStart + endMarker.length) };
}

function replaceBlock(page, template, start, end) {
  const old = block(page, start, end);
  const next = block(template, start, end);
  return page.slice(0, old.start) + next.text + page.slice(old.end);
}

function isoDate(value, label) {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value || ''))
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD).`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error(`${label} is not a real date.`);
  return date;
}

export function validateConfig(input) {
  const cohortMatch = MONTH_YEAR.exec(input.cohort || '');
  if (!cohortMatch) throw new Error('--cohort must be Month YYYY, for example "February 2027".');
  const start = isoDate(input.start, '--start');
  const deadline = isoDate(input.deadline, '--deadline');
  if (deadline >= start) throw new Error('--deadline must be before --start.');
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(start);
  if (`${month} ${start.getUTCFullYear()}` !== input.cohort)
    throw new Error('--cohort must match the month and year in --start.');
  const seats = Number(input.seats);
  const price = Number(input.price);
  if (!Number.isSafeInteger(seats) || seats < 1 || seats > 1000) throw new Error('--seats must be a positive whole number (up to 1000).');
  if (!Number.isSafeInteger(price) || price < 1 || price > 100000000) throw new Error('--price must be a positive NGN whole number.');
  let selar;
  let endpoint;
  try { selar = new URL(input.selar); } catch { throw new Error('--selar must be a Selar product URL.'); }
  try { endpoint = new URL(input['apps-script']); } catch { throw new Error('--apps-script must be a deployed Google Apps Script /exec URL.'); }
  if (selar.protocol !== 'https:' || !['selar.com', 'www.selar.com'].includes(selar.hostname) ||
      !/^\/[A-Za-z0-9_-]+\/?$/.test(selar.pathname) || selar.search || selar.hash)
    throw new Error('--selar must be a plain https://selar.com/PRODUCT URL.');
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname) || endpoint.search || endpoint.hash)
    throw new Error('--apps-script must be a deployed https://script.google.com/macros/s/.../exec URL.');
  if (/\/(?:NEW_PRODUCT|PRODUCT|YOUR_DEPLOYMENT|DEPLOYMENT|TEST_DEPLOYMENT|TESTPRODUCT|EXAMPLE|PLACEHOLDER)(?:\/|$)/i.test(selar.pathname + endpoint.pathname))
    throw new Error('Replace example Selar and Apps Script URLs with the actual product and deployed endpoint.');
  return {
    cohort: input.cohort, month, start: input.start, deadline: input.deadline,
    seats, price, selar: selar.toString(), endpoint: endpoint.toString(),
    priceText: new Intl.NumberFormat('en-NG').format(price),
    startLong: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start),
    deadlineLong: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(deadline),
    slug: input.cohort.toLowerCase().replace(' ', '-'),
  };
}

export function renderCheckoutTemplate(template, c) {
  const values = {
    COHORT: c.cohort, COHORT_SLUG: c.slug, START_DATE_LONG: c.startLong,
    PRICE_FORMATTED: c.priceText, PRICE_NGN: String(c.price),
    APPS_SCRIPT_URL: c.endpoint, SELAR_URL: c.selar,
  };
  const rendered = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown checkout placeholder ${key}.`);
    return values[key];
  });
  if (rendered.includes('{{')) throw new Error('Checkout template has an unresolved placeholder.');
  return rendered;
}

function replaceFaq(page, question, answer) {
  const escaped = question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(<summary>${escaped}<\\/summary>\\s*)<p>[\\s\\S]*?<\\/p>`);
  return one(page, pattern, `$1<p>${answer}</p>`, `FAQ answer for ${question}`);
}

function updateTrainingSeo(page, c) {
  const description = `Enrol in the ${c.cohort} BA Bridge Cohort: a 12-week live IT business analysis course with a portfolio project. ${c.seats} seats; applications close ${c.deadlineLong}.`;
  for (const attribute of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
    page = one(page, new RegExp(`(<meta ${attribute} content=")[^"]*("\\s*\\/?>)`), `$1${description}$2`, attribute);
  }
  page = one(page, /<script type="application\/ld\+json">([^<]+)<\/script>/, (_all, json) => {
    const data = JSON.parse(json);
    const course = data['@graph']?.find((item) => item['@type'] === 'Course');
    if (!course) throw new Error('BA Training Course structured data is missing.');
    course.hasCourseInstance = { '@type': 'CourseInstance', courseMode: 'online', startDate: c.start };
    course.offers = { '@type': 'Offer', price: c.price, priceCurrency: 'NGN',
      availability: 'https://schema.org/InStock', validThrough: c.deadline };
    return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  }, 'BA Training structured data');
  return page;
}

export function openTrainingPage(page, template, c) {
  if (!page.includes('<section class="section" id="waitlist">'))
    throw new Error('BA Training must be in waitlist mode before the open command runs.');
  page = replaceBlock(page, template, SECTION_START, SECTION_END);
  page = replaceBlock(page, template, SCRIPT_START, SCRIPT_END);
  page = one(page, /  \.price-waitlist-note \{[^}]*\}/,
    '  .price-amount { margin: 0; font: 400 2.5rem/1 var(--serif); letter-spacing: -0.02em; }', 'BA price style');
  page = one(page, /<div class="pilot">[^<]*<\/div>/,
    `<div class="pilot">Online business analysis course · ${c.cohort} enrolment open</div>`, 'BA hero status');
  page = one(page, /(<div class="hero-actions">\s*)<a[^>]*>[\s\S]*?<\/a>/,
    `$1<a class="btn btn-primary" href="#join">Enrol for ${c.month}</a>`, 'BA hero button');
  page = one(page, /<p class="hero-seats">[\s\S]*?<\/p>/,
    `<p class="hero-seats"><span class="pill pill--progress">${c.seats} seats available</span></p>`, 'BA seat count');
  page = one(page, /<p class="reassure">[\s\S]*?<\/p>/,
    `<p class="reassure">The ${c.cohort} cohort starts ${c.startLong}. Applications close ${c.deadlineLong}, or earlier if places fill.<br>Your place is confirmed after your Selar payment is checked.</p>`, 'BA reassurance');
  page = one(page, /<span class="chip chip-open">[^<]*<\/span>/,
    `<span class="chip chip-open">Starts: ${c.startLong}</span>`, 'BA story date');
  const optionsStart = page.indexOf('<!-- ================= OPTIONS ================= -->');
  const instructorStart = page.indexOf('<!-- ================= INSTRUCTOR ================= -->', optionsStart);
  if (optionsStart < 0 || instructorStart < 0) throw new Error('BA Training options section is missing.');
  let options = page.slice(optionsStart, instructorStart);
  options = one(options, /<h2>[^<]*<\/h2>/, `<h2>Join the ${c.cohort} cohort.</h2>`, 'BA price heading');
  options = one(options, /<div class="price-main">[\s\S]*?<\/div>\s*(?=<ul class="price-list">)/,
    `<div class="price-main">\n          <span class="pill pill--progress">${c.seats} seats available</span>\n          <p class="price-amount">₦${c.priceText}</p>\n          <dl class="price-dates">\n            <div><dt>Starts</dt><dd>${c.startLong}</dd></div>\n            <div><dt>Apply by</dt><dd>${c.deadlineLong}</dd></div>\n          </dl>\n          <a class="btn btn-primary" href="#join">Enrol for ${c.month}</a>\n          <p class="price-blurb">Submit the form before going to Selar. We confirm places after matching payment to your enrolment.</p>\n        </div>\n        `,
    'BA price card');
  page = page.slice(0, optionsStart) + options + page.slice(instructorStart);
  page = replaceFaq(page, 'When does it start?',
    `The ${c.cohort} cohort starts ${c.startLong}. Applications close ${c.deadlineLong}, or earlier if all ${c.seats} seats are taken.`);
  page = replaceFaq(page, 'How do I pay?',
    `The fee is ₦${c.priceText}. Submit the enrolment form first; then the website takes you to the Selar product to pay. Please keep your Selar receipt and enrolment reference.`);
  page = replaceFaq(page, 'When is my place confirmed?',
    'A browser return from Selar is not proof of payment. We confirm your place after manually checking your Selar sale against the saved enrolment, then email your joining details.');
  page = page.replaceAll('href="#waitlist"', 'href="#join"').replaceAll('#waitlist > .wrap', '#join > .wrap');
  return updateTrainingSeo(page, c);
}

function renderPromo(page, c) {
  const marker = '<div class="cohort rv">';
  const start = page.indexOf(marker);
  if (start < 0) return page;
  if (page.indexOf(marker, start + marker.length) >= 0) throw new Error('Expected one cohort promotion per page.');
  const story = page.indexOf('<div class="story"', start + marker.length);
  if (story < 0) throw new Error('Cohort promotion has no user-story card.');
  const click = page.includes('HOME_COHORT_PROMO_START') ? 'home-cohort-enrol' : 'cohort-promo-enrol';
  const left = `\n      <div>\n        <span class="cohort__eyebrow label"><span class="cohort__pulse"></span>Enrolling · ${c.cohort}</span>\n        <h2>Move into IT business analysis with a <em>portfolio,</em> not just a certificate.</h2>\n        <p>The ${c.cohort} BA Bridge Cohort starts ${c.startLong}. Twelve weeks of live sessions, built around one real project you can take into interviews.</p>\n        <div class="cohort__price"><span class="cohort__amount">₦${c.priceText}</span><span class="pill pill--progress">${c.seats} seats available</span></div>\n        <div class="hero__actions">\n          <a href="/ba-training/#join" class="btn btn-primary" data-goatcounter-click="${click}">Enrol for ${c.month}\n            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>\n          </a>\n          <a href="/ba-training/#weeks" class="btn btn-line">See the 12 weeks</a>\n        </div>\n      </div>\n\n      `;
  const styledLeft = left.replace(/<span class="cohort__amount">([^<]+)<\/span>/, '<strong>$1</strong>');
  return page.slice(0, start + marker.length) + styledLeft + page.slice(story);
}

function headerCta(page, c, isTraining) {
  const pattern = /<a class="(?:btn btn-primary topbar__cta|cohort-cta)"[^>]*>[\s\S]*?<\/a>/g;
  const matches = [...page.matchAll(pattern)];
  if (matches.length > 1) throw new Error('Expected at most one header cohort button per page.');
  if (!matches.length) return page;
  return page.replace(pattern, (anchor) => {
    const className = anchor.match(/class="([^"]+)"/)?.[1];
    return `<a class="${className}" href="${isTraining ? '#join' : '/ba-training/#join'}" aria-label="Join ${c.month} Cohort" data-goatcounter-click="header-cohort-cta">Join ${c.month} Cohort</a>`;
  });
}

export function moveHomePromoBelowHero(home) {
  const promo = block(home, '<!-- HOME_COHORT_PROMO_START -->', '<!-- HOME_COHORT_PROMO_END -->');
  const caseFile = '<!-- ══ CASE FILE (about)';
  const target = home.indexOf(caseFile);
  if (target < 0 || home.indexOf(caseFile, target + 1) >= 0) throw new Error('Homepage case-file marker is missing or duplicated.');
  if (promo.end < target && /^\s*$/.test(home.slice(promo.end, target))) return home;
  const newline = home.includes('\r\n') ? '\r\n' : '\n';
  const without = home.slice(0, promo.start).replace(/[ \t\r\n]*$/, '') + newline + newline +
    home.slice(promo.end).replace(/^[ \t\r\n]*/, '');
  const insertion = without.indexOf(caseFile);
  return without.slice(0, insertion).replace(/[ \t\r\n]*$/, '') + newline + newline +
    '  ' + promo.text.trim() + newline + newline + without.slice(insertion);
}

export function openContentPage(page, c, { home = false, training = false } = {}) {
  page = headerCta(page, c, training);
  if (training) return page;
  page = page.replaceAll('href="/ba-training/#waitlist"', 'href="/ba-training/#join"');
  page = renderPromo(page, c);
  page = page.replace(/and the [A-Z][a-z]+ waitlist/g, 'and BA Bridge enrolment');
  page = page.replace(/Join the [A-Z][a-z]+ waitlist|Join the waitlist|Join [A-Z][a-z]+ Cohort/gi, `Join ${c.month} Cohort`);
  page = page.replace(/Enrol for [A-Z][a-z]+/g, `Enrol for ${c.month}`);
  page = page.replace(/Waitlist open/g, 'Registration open');
  page = page.replace(/The next BA Bridge Cohort is planned for <em>[^<]*<\/em>|The <em>[^<]*<\/em> BA Bridge Cohort is open for enrolment/g,
    `The <em>${c.cohort}</em> BA Bridge Cohort is open for enrolment`);
  page = page.replace(/ · [A-Z][a-z]+ 20\d{2} (?:waitlist open|enrolment open)/g, ` · ${c.cohort} enrolment open`);
  page = page.replace(/(<span class="res-row__title">BA Bridge Cohort<\/span>[\s\S]*?<span class="res-row__price">)[^<]*/g,
    `$1₦${c.priceText}`);
  page = page.replace(/The [A-Z][a-z]+ 20\d{2} cohort is full\. The next cohort is planned for <strong>[A-Z][a-z]+ 20\d{2}<\/strong>; join the free waitlist to hear when registration opens\./g,
    `The ${c.cohort} BA Bridge Cohort is open for enrolment. Applications close ${c.deadlineLong}, or earlier if places fill.`);
  page = page.replace(/The [A-Z][a-z]+ 20\d{2} BA Bridge Cohort is open for enrolment\. Applications close [^.]+\./g,
    `The ${c.cohort} BA Bridge Cohort is open for enrolment. Applications close ${c.deadlineLong}, or earlier if places fill.`);
  page = page.replace(/The [A-Z][a-z]+ cohort is full; join the [A-Z][a-z]+ 20\d{2} waitlist\./g,
    `Enrol in the ${c.cohort} BA Bridge Cohort.`);
  page = page.replace(/Enrol in the [A-Z][a-z]+ 20\d{2} BA Bridge Cohort\./g,
    `Enrol in the ${c.cohort} BA Bridge Cohort.`);
  page = page.replace(/data-goatcounter-click="([^"]*)waitlist"/g,
    (_match, prefix) => `data-goatcounter-click="${prefix}enrol"`);
  if (home) page = moveHomePromoBelowHero(page);
  return page;
}

export function updateAppsScript(source, c) {
  source = one(source, /var COHORT_NAME = '[^']*';/, `var COHORT_NAME = '${c.cohort}';`, 'Apps Script cohort');
  source = one(source, /var EXPECTED_AMOUNT_NGN = \d+;/, `var EXPECTED_AMOUNT_NGN = ${c.price};`, 'Apps Script expected amount');
  if (!source.includes("['cohort', 'Cohort']")) throw new Error('Apps Script is missing the Cohort sheet column.');
  return source;
}

export function openReadme(source, c) {
  source = one(source, /^ba-training\/index\.html\s+BA Bridge Cohort:.*$/m,
    `ba-training/index.html         BA Bridge Cohort: ${c.cohort} enrolment`, 'README BA page status');
  source = one(source, /^- \*\*(?:[A-Z][a-z]+ waitlist|[A-Z][a-z]+ 20\d{2} enrolment):\*\*.*$/m,
    `- **${c.cohort} enrolment:** ${c.seats} seats are advertised at ₦${c.priceText}; applications close ${c.deadlineLong} or earlier if full. The BA Training form saves applications to the Apps Script sheet before opening Selar.`, 'README cohort status');
  source = one(source, /^- \*\*BA Bridge registration is (?:closed|open):\*\*.*$/m,
    `- **BA Bridge registration is open:** the ${c.cohort} cohort starts ${c.startLong}. The site opens ${c.selar} after enrolment. Set the Selar product price and return URL separately, and reconcile every sale before confirming a place.`, 'README payment status');
  return source;
}

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(full) : entry.name.endsWith('.html') ? [full] : [];
  });
}

function usage() {
  return 'Usage: node scripts/open_ba_registration.mjs --cohort "February 2027" --start 2027-02-02 --deadline 2027-01-25 --seats 10 --price 80000 --selar https://selar.com/PRODUCT --apps-script https://script.google.com/macros/s/DEPLOYMENT/exec [--apply]\nWithout --apply this is a preview. The command edits local files only; deploy Apps Script, check Selar settings, and publish the site separately.';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) { console.log(usage()); process.exit(0); }
    const input = {};
    let apply = false;
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (flag === '--apply') { apply = true; continue; }
      if (!['--cohort', '--start', '--deadline', '--seats', '--price', '--selar', '--apps-script'].includes(flag) ||
          !args[i + 1] || args[i + 1].startsWith('--') || input[flag.slice(2)]) throw new Error(`Invalid or repeated argument: ${flag}\n${usage()}`);
      input[flag.slice(2)] = args[++i];
    }
    const c = validateConfig(input);
    const template = renderCheckoutTemplate(fs.readFileSync(path.join(repo, 'scripts/ba_bridge_checkout.template.txt'), 'utf8'), c);
    const trainingPath = path.join(repo, 'ba-training/index.html');
    const homePath = path.join(repo, 'index.html');
    const appsPath = path.join(repo, 'scripts/ba_bridge_enrolment.gs');
    const changes = htmlFiles(repo).map((file) => {
      const original = fs.readFileSync(file, 'utf8');
      const content = file === trainingPath
        ? openContentPage(openTrainingPage(original, template, c), c, { training: true })
        : openContentPage(original, c, { home: file === homePath });
      return { file, original, content };
    });
    const appsOriginal = fs.readFileSync(appsPath, 'utf8');
    changes.push({ file: appsPath, original: appsOriginal, content: updateAppsScript(appsOriginal, c) });
    const readmePath = path.join(repo, 'README.md');
    const readmeOriginal = fs.readFileSync(readmePath, 'utf8');
    changes.push({ file: readmePath, original: readmeOriginal, content: openReadme(readmeOriginal, c) });
    const sitemapPath = path.join(repo, 'sitemap.xml');
    const sitemapOriginal = fs.readFileSync(sitemapPath, 'utf8');
    const today = new Date().toISOString().slice(0, 10);
    const sitemap = sitemapOriginal.replace(/<lastmod>20\d{2}-\d{2}-\d{2}<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
    changes.push({ file: sitemapPath, original: sitemapOriginal, content: sitemap });
    const changed = changes.filter(({ original, content }) => original !== content);
    if (apply) for (const { file, content } of changed) fs.writeFileSync(file, content);
    console.log(`${apply ? 'Updated' : 'Preview:'} ${changed.length} local files for ${c.cohort}: ${c.seats} seats at ₦${c.priceText}, starting ${c.startLong}.`);
    for (const { file } of changed) console.log(`  ${path.relative(repo, file)}`);
    if (!apply) console.log('Add --apply to make these local edits.');
    console.log('Before publishing: deploy the updated Apps Script, confirm its sheet and endpoint, and set the Selar product price and return URL to https://ubonudonkang.com/ba-training/?payment=selar. A browser return is not payment verification.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
