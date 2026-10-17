/* The "Join Waitlist" / "Enrol Now" buttons repeated down the BA Training page.

   Each one sits in a <div class="section-cta"> whose button carries
   data-goatcounter-click="section-cta-<where>-waitlist" (or -enrol once registration is open).
   The open and close commands both rewrite every block from here, so the buttons can only ever
   be in one of two states and a hand edit cannot leave one of them behind. */

export const SECTION_CTA = /<div class="section-cta">[\s\S]*?<\/div>/g;
const WHERE = /data-goatcounter-click="section-cta-([a-z]+)-(?:waitlist|enrol)"/;

/* c is the validated open-registration config; leave it out for the closed (waitlist) state. */
function render(where, c) {
  const open = Boolean(c);
  const note = open
    ? `₦${c.priceText}. Starts ${c.startLong}; apply by ${c.deadlineLong}.`
    : 'Free to join. It does not reserve a seat.';
  return `<div class="section-cta">\n        <a class="btn btn-primary" href="${open ? '#join' : '#waitlist'}" data-goatcounter-click="section-cta-${where}-${open ? 'enrol' : 'waitlist'}">${open ? 'Enrol Now' : 'Join Waitlist'}</a>\n        <p class="section-cta__note">${note}</p>\n      </div>`;
}

export function setSectionCtas(page, c) {
  let count = 0;
  const result = page.replace(SECTION_CTA, (block) => {
    const where = block.match(WHERE)?.[1];
    if (!where) throw new Error('A section call-to-action button is missing its tracking name. Review the BA Training page.');
    count += 1;
    return render(where, c);
  });
  if (!count) throw new Error('Expected the section call-to-action buttons on the BA Training page; found none.');
  return result;
}
