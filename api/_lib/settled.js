/* =====================================================================================
   WHEN IS A DEBT ACTUALLY PAID?
   =====================================================================================

   Reported from the field:

     "i found husna hassani philiko 42141021001 as a defaulter 8-9 yet that customer is a
      paid one 11-12 ... arreas is 1 seen not even a negative nor underpaid it was defaulter"

   She was on an officer's phone as a DEFAULTER owing ONE SHILLING, at a due summary of 8-9,
   while the same day's expected book had her at 11-11, overpaid, arrears -833, with her last
   instalment due the following Tuesday. The fault was staleness -- her row was written by a
   deck weeks earlier and nothing ever retired it -- and that fix lives in upload.js.

   THIS FILE ONLY ANSWERS ONE QUESTION: given an arrears figure, does the customer owe
   anything worth collecting. The rule is exactly what it has always been, and it does not
   bend:

     "i didnt understand you well, we donmt forgive arreas of 1 shilling"
     "take the tolerance setting out entirely - everything should be auto"

   An earlier version of this file let a setting soften that line for rounding crumbs left by
   dividing a loan into twelve uneven weekly instalments. The owner said no -- a shilling is
   still a debt, full stop -- so there is no setting here any more, only the rule: a balance
   at or below zero is paid, and anything above it is owed. */

/** TRUE when this arrears figure means the customer owes nothing at all.

    A NULL ARREARS IS NOT SETTLED. It is unknown -- a follow-up stub, a column the file did not
    carry -- and treating unknown as paid is how a real debtor disappears off the list. */
export function isSettled(arrears) {
  if (arrears == null || arrears === '') return false;
  const n = Number(arrears);
  if (!Number.isFinite(n)) return false;
  return n <= 0;
}

/** The word to show for a customer's status, given what they owe. Used by both the defaulter
    book and the expected lists so the two can never disagree about the same person. */
export function statusWithPaid(arrears, status, fallback = '') {
  return isSettled(arrears) ? 'PAID' : (status || fallback);
}
