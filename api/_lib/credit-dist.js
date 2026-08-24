/** THE CREDITS DISTRIBUTION -- how the OFF JANA pile is dealt out, and why the ARRANGEMENT
    rotates with every deck.

      "The credits should always get random customers so have random assignement model during
       distribution per each watu deck upload ... dont assign a customer but a way we
       destribute like this upload arranges them alphabetically and destribute, the next uses
       by amount, the next by days the next by agent alpahabetically"

    The distribution was always a fair deal -- round-robin, nobody's pile bigger than anyone
    else's by more than one -- but it always dealt from the SAME order (sorted by REF), so day
    after day the same credit officer caught roughly the same customers. Not an assignment
    problem: an ORDER problem. Fixed by rotating how the pile is arranged before the deal:

      deck 1  customers A-Z by name
      deck 2  by amount (largest arrears first, so the big ones spread instead of clumping)
      deck 3  by days elapsed (longest-stuck first, same reasoning)
      deck 4  officers A-Z take turns off the pile in REF order (the DEAL order rotates
              instead of the pile -- the defaulter deck carries no sales-agent column, so
              "by agent alphabetically" is honoured on the receiving side, which is the side
              that has names)
      deck 5  back to the top.

    WHICH ARRANGEMENT A DECK USES IS DERIVED, NOT STORED. Each deck date maps to a fixed slot
    in the cycle (its day number since epoch, mod 4), so:
      - every NEW deck upload lands on the next arrangement in the cycle -- decks are daily,
        so consecutive uploads walk the list exactly in the order asked for;
      - the answer for a given deck NEVER CHANGES -- a re-upload of the same day's corrected
        file keeps that day's arrangement (a correction must not hand every officer a
        different pile mid-morning), and last Tuesday's board still shows last Tuesday's
        split, not one recomputed under today's arrangement;
      - it costs NOTHING: no counter to bump, no table to read, nothing that can drift or be
        forgotten -- the same reasoning recovery.js and time.js use for every other
        "one rule, derived, never stored" decision in this codebase. */

/** The cycle, in the order given. `key` is stable (tests and the UI chip both use it);
    `label` is what leadership reads on the board. */
export const DIST_STRATEGIES = [
  { key: 'name',    label: 'A-Z kwa jina / by customer name' },
  { key: 'amount',  label: 'Kwa deni / by amount (largest arrears first)' },
  { key: 'days',    label: 'Kwa siku / by days elapsed (longest first)' },
  { key: 'officer', label: 'Maafisa A-Z / officers take turns A-Z' },
];

/** dateKey ('yyyy-mm-dd') -> which arrangement that deck uses. Day number since epoch mod the
    cycle length: consecutive deck days walk the cycle in order, and the same day always
    answers the same -- see the header for why derived beats stored here. */
export function distStrategyFor(dateKey) {
  const t = Date.parse(String(dateKey || '') + 'T00:00:00Z');
  if (isNaN(t)) return DIST_STRATEGIES[0];
  const day = Math.floor(t / 86400000);
  return DIST_STRATEGIES[((day % DIST_STRATEGIES.length) + DIST_STRATEGIES.length) % DIST_STRATEGIES.length];
}

const S = v => String(v == null ? '' : v);
const N = v => (typeof v === 'number' ? v : Number(v) || 0);

/** Deal `customers` across `creditUsers`, arranged per the strategy for `dateKey`.
    Same fairness contract assignToCredits always had -- round-robin, piles within one of each
    other, deterministic and reproducible for a given deck -- plus the rotating arrangement.
    Returns { assigned: Map(creditKey -> [customer...]), strategy }. */
export function distributeToCredits(customers, creditUsers, dateKey) {
  const strategy = distStrategyFor(dateKey);
  const assigned = new Map();
  if (!creditUsers || !creditUsers.length) return { assigned, strategy };

  /* The officers' deal order is fixed and deterministic too -- by user_id, the stable key --
     EXCEPT under 'officer', where rotating the receiving order IS the arrangement. */
  const officers = creditUsers.slice().sort(strategy.key === 'officer'
    ? (a, b) => S(a.name || a.user_id).localeCompare(S(b.name || b.user_id))
    : (a, b) => S(a.user_id || a.name).localeCompare(S(b.user_id || b.name)));

  const sorted = customers.slice().sort(
    strategy.key === 'name'   ? (a, b) => S(a.full_name).localeCompare(S(b.full_name)) || S(a.ref).localeCompare(S(b.ref))
  : strategy.key === 'amount' ? (a, b) => N(b.arrears) - N(a.arrears) || S(a.ref).localeCompare(S(b.ref))
  : strategy.key === 'days'   ? (a, b) => N(b.days_elapsed) - N(a.days_elapsed) || S(a.ref).localeCompare(S(b.ref))
  :                             (a, b) => S(a.ref).localeCompare(S(b.ref)));   // 'officer': pile by ref, deal order rotates

  sorted.forEach((c, i) => {
    const key = officers[i % officers.length].user_id || officers[i % officers.length].name;
    (assigned.get(key) || assigned.set(key, []).get(key)).push(c);
  });
  return { assigned, strategy };
}
