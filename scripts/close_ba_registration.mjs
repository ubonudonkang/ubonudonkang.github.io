import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SECTION_START = '<!-- BA_FLOW_SECTION_START -->';
const SECTION_END = '<!-- BA_FLOW_SECTION_END -->';
const SCRIPT_START = '<!-- BA_FLOW_SCRIPT_START -->';
const SCRIPT_END = '<!-- BA_FLOW_SCRIPT_END -->';
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
  const section = locate(template, SECTION_START, SECTION_END).text
    .replaceAll('{{CLOSED_COHORT}}', closedCohort)
    .replaceAll('{{NEXT_COHORT}}', nextCohort);
  const script = locate(template, SCRIPT_START, SCRIPT_END).text;
  if (section.includes('{{') || script.includes('{{')) throw new Error('The waitlist template has an unresolved placeholder.');

  const pageSection = locate(page, SECTION_START, SECTION_END);
  let result = page.slice(0, pageSection.start) + section + page.slice(pageSection.end);
  const pageScript = locate(result, SCRIPT_START, SCRIPT_END);
  result = result.slice(0, pageScript.start) + script + result.slice(pageScript.end);
  result = result.replaceAll('href="#join"', 'href="#waitlist"')
    .replaceAll('href="/ba-training/#join"', 'href="/ba-training/#waitlist"');
  if (/ENDPOINT_URL|SELAR_COHORT_URL|https:\/\/selar\.com\/|Continue to payment|window\.location\.assign/.test(result)) {
    throw new Error('A checkout path remains on the BA Training page; review it before closing registration.');
  }
  return result;
}

export function pointCohortLinksToWaitlist(page) {
  return page.replaceAll('href="/ba-training/#join"', 'href="/ba-training/#waitlist"');
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
    const closed = closeRegistration(page, template, closedCohort, nextCohort);
    const linkedPages = htmlFiles(repo).filter((file) => file !== pagePath).map((file) => {
      const original = fs.readFileSync(file, 'utf8');
      return { file, original, updated: pointCohortLinksToWaitlist(original) };
    });
    if (closed !== page) fs.writeFileSync(pagePath, closed);
    for (const { file, original, updated } of linkedPages) {
      if (updated !== original) fs.writeFileSync(file, updated);
    }
    console.log(closed === page ? 'BA Training page is already using this waitlist flow.' : 'BA Training enrolment and checkout were replaced with the waitlist flow.');
    console.log('Cohort links to the former enrolment anchor now point to the waitlist.');
    console.log('Review the BA page copy, sitewide CTA wording, metadata and Selar product status before publishing.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
