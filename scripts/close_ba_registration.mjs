import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SECTION_START = '<!-- BA_FLOW_SECTION_START -->';
const SECTION_END = '<!-- BA_FLOW_SECTION_END -->';
const MONTH_YEAR = /^(?:January|February|March|April|May|June|July|August|September|October|November|December) 20\d{2}$/;

function locate(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const endMarkerStart = source.indexOf(endMarker, start);
  if (start < 0 || endMarkerStart < start ||
      source.indexOf(startMarker, start + 1) !== -1 ||
      source.indexOf(endMarker, endMarkerStart + 1) !== -1) {
    throw new Error(`Expected exactly one ${startMarker} / ${endMarker} block`);
  }
  const end = endMarkerStart + endMarker.length;
  return { start, end, text: source.slice(start, end) };
}

export function closeRegistration(page, template, closedCohort, nextCohort) {
  if (!MONTH_YEAR.test(closedCohort) || !MONTH_YEAR.test(nextCohort) || closedCohort === nextCohort) {
    throw new Error('Provide different closed and next cohorts as Month YYYY, for example "February 2027" "May 2027".');
  }
  const nextSlug = `${nextCohort.slice(0, 3).toLowerCase()}-${nextCohort.slice(-4)}`;
  const storagePrefix = closedCohort === 'November 2026'
    ? 'uu-cohort-selar'
    : `uu-cohort-selar-${closedCohort.toLowerCase().replace(' ', '-')}`;
  const section = locate(template, SECTION_START, SECTION_END).text
    .replaceAll('{{CLOSED_COHORT}}', closedCohort)
    .replaceAll('{{CLOSED_STORAGE_PREFIX}}', storagePrefix)
    .replaceAll('{{NEXT_COHORT_SLUG}}', nextSlug)
    .replaceAll('{{NEXT_COHORT}}', nextCohort);
  if (section.includes('{{')) throw new Error('The waitlist template has an unresolved placeholder.');

  const pageSection = locate(page, SECTION_START, SECTION_END);
  let result = page.slice(0, pageSection.start) + section + page.slice(pageSection.end);
  result = result.replaceAll('href="#join"', 'href="#waitlist"')
    .replaceAll('href="/ba-training/#join"', 'href="/ba-training/#waitlist"');
  if (/data-form="enrol"|data-selar-url|https:\/\/selar\.com\/|Continue to payment/.test(result)) {
    throw new Error('A checkout path remains on the BA Training page; review it before closing registration.');
  }
  return result;
}

export function pointCohortLinksToWaitlist(page) {
  return page.replaceAll('href="/ba-training/#join"', 'href="/ba-training/#waitlist"');
}

export function headerCtaToWaitlist(page, isTrainingPage = false) {
  let matches = 0;
  const updated = page.replace(/<a class="(?:btn btn-primary topbar__cta|cohort-cta)"[^>]*>[\s\S]*?<\/a>/g, (anchor) => {
    matches += 1;
    const openEnd = anchor.indexOf('>');
    let open = anchor.slice(0, openEnd + 1);
    if (!/\bhref="[^"]*"/.test(open) || !/\baria-label="[^"]*"/.test(open)) {
      throw new Error('A header cohort button is missing its link or accessible label.');
    }
    open = open.replace(/\bhref="[^"]*"/, `href="${isTrainingPage ? '#waitlist' : '/ba-training/#waitlist'}"`)
      .replace(/\baria-label="[^"]*"/, 'aria-label="Join Waitlist"')
      .replace(/\bdata-goatcounter-click="[^"]*"/, 'data-goatcounter-click="header-waitlist-cta"');
    return open + 'Join Waitlist</a>';
  });
  if (matches > 1) throw new Error('Expected at most one header cohort button per page.');
  return updated;
}

export function moveHomePromoToBottom(home) {
  const startMarker = '  <!-- HOME_COHORT_PROMO_START -->';
  const endMarker = '  <!-- HOME_COHORT_PROMO_END -->';
  const closingMarker = '  <!-- ══ CLOSING';
  const { start, end, text: promo } = locate(home, startMarker, endMarker);
  const closing = home.indexOf(closingMarker);
  if (closing < 0 || home.indexOf(closingMarker, closing + 1) !== -1) {
    throw new Error('Could not find the unique homepage closing section.');
  }
  if (start < closing && /^\s*$/.test(home.slice(end, closing))) return home;
  const newline = home.includes('\r\n') ? '\r\n' : '\n';
  const withoutPromo = home.slice(0, start).replace(/[ \t\r\n]*$/, '') + newline + newline +
    home.slice(end).replace(/^[ \t\r\n]*/, '');
  const target = withoutPromo.indexOf(closingMarker);
  return withoutPromo.slice(0, target).replace(/[ \t\r\n]*$/, '') + newline + newline +
    promo + newline + newline + withoutPromo.slice(target);
}

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(fullPath) : entry.name.endsWith('.html') ? [fullPath] : [];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [closedCohort, nextCohort] = process.argv.slice(2);
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const pagePath = path.join(repo, 'ba-training/index.html');
  const templatePath = path.join(repo, 'scripts/ba_bridge_waitlist.template.txt');
  try {
    const page = fs.readFileSync(pagePath, 'utf8');
    const template = fs.readFileSync(templatePath, 'utf8');
    const closed = headerCtaToWaitlist(closeRegistration(page, template, closedCohort, nextCohort), true);
    const linkedPages = htmlFiles(repo).filter((file) => file !== pagePath).map((file) => {
      const original = fs.readFileSync(file, 'utf8');
      let updated = headerCtaToWaitlist(pointCohortLinksToWaitlist(original));
      if (file === path.join(repo, 'index.html')) updated = moveHomePromoToBottom(updated);
      return { file, original, updated };
    });
    if (closed !== page) fs.writeFileSync(pagePath, closed);
    for (const { file, original, updated } of linkedPages) {
      if (updated !== original) fs.writeFileSync(file, updated);
    }
    console.log(closed === page ? 'BA Training page is already using this waitlist flow.' : 'BA Training enrolment and checkout were replaced with the waitlist flow.');
    console.log('Header buttons say Join Waitlist, cohort links point to the waitlist, and the homepage promo is before the final CTA.');
    console.log('Review other cohort copy, metadata and Selar product status before publishing.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
