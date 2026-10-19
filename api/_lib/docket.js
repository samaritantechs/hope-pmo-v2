/* =====================================================================================
   THE DOCKET -- the one number a customer keeps across every loan.
   =====================================================================================
   "comments and location should be docket based so that they travel all reference numbers /
    loan tracks"

   A customer is given a docket once (2-217-110984) and a REFERENCE per loan: the docket's digits
   with the loan's track appended. Verified against the live book: docket digits + track digit(s)
   = the reference number, on every one of 2,921 loans, and no two customers share a docket. So
   the docket is the key that follows a person from their first loan to their tenth, and it can
   be read off any reference the system already holds.

   THE KEY IS DIGITS ONLY. The reports write the docket with dashes (DOCKET#), the origination
   sandbox writes it 1-3-6, and a reference carries no dashes at all; comparing any two of those
   as text fails for no reason. Everything keyed on a docket in this system is keyed on its
   digits, through docketKeyOf, and nowhere else.

   ONLY TRACKS 1-10 ARE UNAMBIGUOUS FROM A BARE REFERENCE, and this is a known, open gap, not an
   oversight: "ending 0 is track 10" was confirmed, but a ref ending in 1-9 could be track 1-9
   OR the low digit of track 11-19 -- nothing in the digits says which. The decode takes the
   single digit, so a customer on their eleventh loan gets a key one digit longer than their real
   docket. That key cannot be another customer's (every real docket is shorter), so the failure
   is a history that does not merge with the earlier loans -- never two customers merged into
   one. Where a report carries the docket, that wins over the decode. The SQL backfill in
   db/RUN-ME-2026-10-19-docket-keys.sql mirrors this rule; change one, change both. */
export function refFor(docket, track) {
  const digits = String(docket || '').replace(/-/g, '');
  return digits + String(track);
}

/** The inverse, for the ONE report that carries a reference with no docket column at all --
    the expected report; every other report (defaulters, approved) carries DOCKET# outright and
    should be read from that column directly, never decoded. See the note above on tracks 11-19. */
export function docketFromRef(ref) {
  const s = String(ref || '');
  const track = s.slice(-1) === '0' ? s.slice(-2) : s.slice(-1);
  const digits = s.slice(0, s.length - track.length);
  return { docket: digits.slice(0, 1) + '-' + digits.slice(1, 4) + '-' + digits.slice(4), track: Number(track) };
}

/** The customer's key: the docket's digits. A known docket (off a report that carries one) is
    exact and wins; otherwise the reference is decoded. Empty when neither says anything -- a
    key must never be '' for one customer and '' for another and have them match. */
export function docketKeyOf(ref, docketNo) {
  const known = String(docketNo == null ? '' : docketNo).replace(/\D/g, '');
  if (known.length >= 3) return known;
  const digits = String(ref == null ? '' : ref).replace(/\D/g, '');
  if (digits.length < 3) return '';
  const trackLen = digits.slice(-1) === '0' ? 2 : 1;
  return digits.slice(0, digits.length - trackLen);
}
