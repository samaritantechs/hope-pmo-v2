/* =====================================================================================
   WHEN IS A DEBT ACTUALLY PAID?
   =====================================================================================

   Reported from the field, and both halves were right:

     "i found husna hassani philiko 42141021001 as a defaulter 8-9 yet that customer is a
      paid one 11-12 ... arreas is 1 seen not even a negative nor underpaid it was defaulter"

   She was on an officer's phone as a DEFAULTER owing ONE SHILLING, at a due summary of 8-9,
   while the same day's expected book had her at 11-11, overpaid, arrears -833, with her last
   instalment due the following Tuesday. Two separate faults produced that one row, and this
   file is the first of them.

   WHY A SHILLING IS OWED AT ALL. The loan is divided into twelve weekly instalments and the
   division rarely comes out whole -- 1,360,000 over twelve is 113,333.33 -- so the schedule
   carries a few shillings of rounding that no payment can ever clear. In one day's live book
   nine customers were carrying arrears under a thousand shillings; one of them owed THREE.
   Every one of them was classed `underpaid`, which means defaulter, which means an officer
   rings them.

   ZERO WAS THE WRONG LINE. The PAID chip already forgave a balance of zero or less, and that
   was right as far as it went -- but a rounding remainder is not zero, so it fell straight
   through and stayed on the list for ever. Nobody in this company is sent to collect one
   shilling; the rule should say so.

   THE FIGURE IS A SETTING, NOT A CONSTANT. It decides who gets telephoned, so it is a
   business decision and the owner must be able to change it without waiting for a deployment.
   `PAID_TOLERANCE_TZS` in the settings table; the default below applies until somebody sets
   it. Set it to 0 and the behaviour is exactly what it was before this file existed.

   THE DEFAULT IS ZERO, WHICH CHANGES NOTHING UNTIL SOMEBODY DECIDES IT SHOULD:

     "please audit both expected and defaulters that appear to be real ones and dont make a
      mistake by removing anyone demanded while doing this"

   Forgiving a real debt is far the more expensive of the two mistakes, and this code is not
   entitled to make that call. At zero the rule is exactly what it has always been -- a balance
   of zero or less is paid, anything above it is owed -- and the customer who prompted all this
   is still cleared, because her expected arrears is MINUS 833. The staleness fix is what her
   case needed; the tolerance is a separate question.

   The judgement, when it is made, is genuinely hard: in one day's live book the small arrears
   were 3, 106, 334, 672, 674 and four customers owing exactly 1,000. Three shillings is plainly
   the twelve-way division leaving a crumb. An exact thousand is not arithmetic -- it looks like
   somebody paid a thousand short. Anything in between is a person's judgement, and this file
   deliberately leaves it to one. */

export const PAID_TOLERANCE_KEY = 'PAID_TOLERANCE_TZS';
export const PAID_TOLERANCE_DEFAULT = 0;

/** Read the tolerance, falling back to the default for anything that is not a usable number.
    Never throws and never returns a negative: a broken setting must not start hiding debt. */
export function paidToleranceOf(value) {
  /* UNSET IS NOT ZERO-BY-ACCIDENT. `Number('')` is 0, so a blank or missing setting used to
     come back as a deliberate-looking 0 rather than the default -- the default never applied
     anywhere, and a test caught it. They happen to agree today; they will not the day somebody
     changes the default, and a setting that silently ignores its own default is the sort of
     thing nobody finds twice. */
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return PAID_TOLERANCE_DEFAULT;
  const n = Number(raw.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return PAID_TOLERANCE_DEFAULT;
  return n;
}

/** TRUE when this arrears figure means the customer owes nothing worth collecting.

    A NULL ARREARS IS NOT SETTLED. It is unknown -- a follow-up stub, a column the file did not
    carry -- and treating unknown as paid is how a real debtor disappears off the list. The
    original PAID chip got this right and it is kept exactly. */
export function isSettled(arrears, tolerance = PAID_TOLERANCE_DEFAULT) {
  if (arrears == null || arrears === '') return false;
  const n = Number(arrears);
  if (!Number.isFinite(n)) return false;
  return n <= tolerance;
}

/** The word to show for a customer's status, given what they owe. Used by both the defaulter
    book and the expected lists so the two can never disagree about the same person. */
export function statusWithPaid(arrears, status, tolerance = PAID_TOLERANCE_DEFAULT, fallback = '') {
  return isSettled(arrears, tolerance) ? 'PAID' : (status || fallback);
}
