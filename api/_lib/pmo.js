/** PMO COLLECTION — the collection officers, paid on the ONE thing they control.
 *
 * A PMO collection officer is handed a set of teams and judged on the percentage of today's
 * expected repayment that actually came in. Not on how many teams they hold, not on how many
 * customers are in them, not on the size of the book — the teams are distributed so that those
 * even out, and the whole point of the plan is that two officers with very different portfolios
 * are paid the same for the same percentage.
 *
 * THE BANDS, from the collection commission plan:
 *
 *     85–89%   20,000/day    week 100,000    month   400,000     KUFELI
 *     90–92%   25,000/day    week 125,000    month   500,000     most days, and this week
 *     93–94%   30,000/day    week 150,000    month   600,000     one day in two or three weeks
 *     95–96%   40,000/day    week 200,000    month   800,000     the target
 *     97–100%  60,000/day    week 300,000    month 1,200,000     MAFANIKIO
 *
 * The written plan lists whole numbers with gaps between the bands — 89 to 90, 92 to 93 — so a
 * percentage of 89.4 belongs to no band as written. It is read here as "at least": 89.4 pays
 * the 85–89 rate, because the alternative is a figure that pays nothing at all and nobody
 * intended that. Below 85 pays nothing, which IS intended.
 */

import { num } from './recovery.js';

/* Highest first, so the first band whose floor is reached is the answer. */
export const PMO_BANDS = [
  { floor: 97, tzs: 60000, label: '97–100% MAFANIKIO' },
  { floor: 95, tzs: 40000, label: '95–96% LENGO' },
  { floor: 93, tzs: 30000, label: '93–94%' },
  { floor: 90, tzs: 25000, label: '90–92%' },
  { floor: 85, tzs: 20000, label: '85–89% KUFELI' },
];
export const PMO_BELOW = { floor: 0, tzs: 0, label: 'chini ya 85% / below 85%' };

/** Which band a collection percentage falls in. A day with nothing expected has no percentage
    at all, and that is NOT a failure — it is a day the officer was given nothing to collect, so
    it pays nothing and says why rather than being scored as 0%. */
export function pmoBand(pct) {
  if (pct == null) return null;
  for (const b of PMO_BANDS) if (pct >= b.floor) return b;
  return PMO_BELOW;
}

/** The role name on an access code that marks somebody as a PMO collection officer. A setting
    rather than a constant because it is typed by a person into a form: "PMO COLLECTION",
    "PMO-COLLECTION" and "Pmo Collection" are all the same intention, and a spelling that does
    not match should be fixable without a deploy. */
export const PMO_ROLE_KEY = 'PMO_ROLE';
export const PMO_ROLE_DEFAULT = 'PMO COLLECTION';

/** The weekly bonus amount. The plan names the CONDITION -- whoever leads, having beaten their
    own previous week -- but not the figure, so there is no honest default except none. It
    starts unset and the screen says so, rather than showing a number nobody chose. */
export const PMO_BONUS_KEY = 'PMO_WEEKLY_BONUS';

/* SWITCHED OFF IS NOT THE SAME AS DELETED, AND BOTH ARE NEEDED.

     "admin should have a button to enable or disable bonuses: fix like that to collection the
      others too"

   Delete removes the rule: there is no bonus, and the amount is gone with it. Disable pauses
   the rule while KEEPING the amount, which is what a month with no budget for it looks like,
   or a fortnight while the criteria are being rewritten. Without the switch the only way to
   pause a bonus is to delete the figure and remember it, and somebody always remembers it
   wrongly.

   ABSENT MEANS ON, deliberately: every book that already has a bonus set keeps paying it, and
   nobody has to go and switch on something that was already running. */
export const PMO_BONUS_ON_KEY = 'PMO_WEEKLY_BONUS_ON';
export const REC_BONUS_KEY = 'REC_WEEKLY_BONUS';
export const REC_BONUS_ON_KEY = 'REC_WEEKLY_BONUS_ON';

/** A settings flag reads as ON unless it has been deliberately switched off. '0', 'no' and
    'false' are all somebody meaning off; anything else, including an empty string and a missing
    row, is on. */
export function bonusOn(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return !(s === '0' || s === 'no' || s === 'false' || s === 'off');
}

const norm = v => String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/* THE ONE DEFINITION OF "IS THIS PERSON A COLLECTION OFFICER", and it has to be one, because
   two screens ask it about the same person and must not disagree.

     "change it to be the one reading at commissions since commissions are using
      PMO COLLECTION instead of COLLECTION"

   The call app was taught to recognise a collection officer however the role is spelled, so
   that Catherine's list would narrow. Commissions was not: it compared the role to the
   configured name by exact equality. So the moment the roles were renamed to COLLECTION, the
   PMO board matched nobody, went empty, and the collection commission computed on it stopped
   with it -- the app and the commission screen holding two different opinions about the same
   person, which is precisely the state a single definition exists to prevent.

   TWO WAYS TO MATCH, and both are needed:

     the configured name   PMO_ROLE, compared with punctuation and case forgiven, so
                           'PMO COLLECTION', 'pmo-collection' and 'Pmo  Collection' are one
                           answer and a deployment can rename the role to anything at all
     the WORD              a role CONTAINING 'COLLECTION' or 'COLLECTOR', so 'COLLECTION',
                           'Collection Officer' and 'EARLY COLLECTION' are recognised without
                           anybody having to edit a setting to match what was typed

   Matching on a contained word cannot reach RECOVERY, GMO, MANAGER, BIKE, OPM, LEGAL, CREDIT
   or ADMIN -- none of them carries either word -- so no role that was outside this before is
   swept into it now. */
export const COLLECTION_WORDS = ['COLLECTION', 'COLLECTOR'];
export function hasCollectionWord(role) {
  const r = norm(role);
  return !!r && COLLECTION_WORDS.some(w => (' ' + r + ' ').includes(' ' + w + ' '));
}

export function isPmoRole(role, want) {
  if (!norm(role)) return false;
  return norm(role) === norm(want || PMO_ROLE_DEFAULT) || hasCollectionWord(role);
}

/** One officer's collection over one set of already-resolved TEAM-DAY TOTALS -- the rows
    api/_lib/snapshot-totals.js produces, one per team per day rather than one per customer.
    Uncollected was clamped per customer before it was ever summed, so the total still cannot go
    negative however the day went — the same rule the dashboard's Uncollected KPI uses, applied
    where the summing happens. */
export function collectionOf(rows) {
  let expected = 0, collected = 0, uncollected = 0, customers = 0;
  for (const r of rows) {
    expected += num(r.expected_amt);
    collected += num(r.collected_amt);
    uncollected += num(r.uncollected_amt);
    customers += num(r.customers);
  }
  return { expected, collected, uncollected, customers,
    // Null, not zero, when nothing was expected. "No percentage" and "nought per cent" are
    // very different things to put in front of somebody whose pay depends on it.
    pct: expected > 0 ? Math.round((collected / expected) * 1000) / 10 : null };
}

/** THE BOARD.
 *
 *  `roster`   [{ name, teams: [..] }]        the PMO collection officers and what they hold
 *  `byDay`    Map dateKey -> resolved rows   one day's Expected snapshot, latest batch only
 *  `days`     the collection days of the week, Monday to Friday
 *
 *  Returns one row per officer with today's figures, the week's figures, and what each is
 *  worth. The MONEY is computed here but the presentation never shows it — see the note on
 *  pmoPublicRow.
 */
/* Jumatatu (tatu, 3rd), Jumanne (nne, 4th), Jumatano (tano, 5th), Alhamisi, Ijumaa -- the
   working week as it is written on every board in every branch. */
export const PMO_DAY_KEYS = ['J3', 'J4', 'J5', 'AL', 'IJ'];

export function pmoBoard(roster, byDay, today, days) {
  const rows = roster.map(p => {
    const mine = new Set((p.teams || []).map(t => norm(t)));
    const pick = d => (byDay.get(d) || []).filter(r => mine.has(norm(r.team)));

    const day = collectionOf(pick(today));
    /* The week is every collection day added together, NOT the average of five percentages.
       Averaging percentages would let a quiet Monday with four customers count as much as a
       heavy Friday with four hundred. */
    const weekRows = days.flatMap(pick);
    const week = collectionOf(weekRows);

    /* Pay follows each day's own band, added up — which is what makes a good Friday worth
       something after a poor Tuesday. A week of steady 90–92% therefore pays 5 × 25,000 =
       125,000, exactly as the plan's table says it should. Days with nothing expected are not
       counted as failures; they simply do not pay. */
    const perDay = days.map(d => {
      const c = collectionOf(pick(d));
      const b = pmoBand(c.pct);
      return { date: d, pct: c.pct, uncollected: c.uncollected, tzs: b ? b.tzs : 0, band: b ? b.label : null };
    });
    const todayBand = pmoBand(day.pct);

    return {
      officer: p.name,
      teams: (p.teams || []).length,
      teamList: (p.teams || []).slice().sort(),
      customers: day.customers,
      // Today
      expected: day.expected, collected: day.collected, uncollected: day.uncollected, pct: day.pct,
      band: todayBand ? todayBand.label : null,
      commission: todayBand ? todayBand.tzs : 0,
      // The week
      weekExpected: week.expected, weekCollected: week.collected,
      weekUncollected: week.uncollected, weekPct: week.pct,
      weekCommission: perDay.reduce((s, d) => s + d.tzs, 0),
      weekDays: perDay,
      /* THE FIVE DAYS AS COLUMNS, because the week's total is the only thing the officer could
         see and it is not the thing they are paid on. Pay follows EACH DAY'S OWN band, added up
         -- a good Ijumaa is worth something after a poor Jumanne -- so the five percentages are
         what tell somebody what they are earning. Flattened onto the row here rather than dug
         out of weekDays by whoever draws the table, so the board and the slide cannot disagree
         about which day is which. */
      ...Object.fromEntries(perDay.flatMap((d, i) => {
        const k = PMO_DAY_KEYS[i];
        return k ? [['pct' + k, d.pct], ['tzs' + k, d.tzs]] : [];
      })),
    };
  });
  // Best first. An officer with no percentage at all sorts last rather than as a zero.
  return rows.sort((a, b) => (b.weekPct == null ? -1 : b.weekPct) - (a.weekPct == null ? -1 : a.weekPct));
}

/** THE PRESENTATION VERSION. Deliberately a different shape, not the same rows with the money
    left off by whoever is drawing the slide.
 *
 *  Commission belongs on the commission panel, where the person it concerns can see their own
 *  figure. A projector in a meeting room is the wrong place for anybody's pay: the slide is
 *  about who is collecting, and putting shillings on it changes what the room talks about.
 *
 *  Building the public row HERE means a future slide cannot accidentally include the money by
 *  reaching for a field that happens to be sitting there. */
export function pmoPublicRow(r, i) {
  return { sn: i + 1, officer: r.officer, teams: r.teams,
    uncollected: r.uncollected, pct: r.pct,
    /* THE FIVE DAYS, because the daily percentage is what the pay is worked out from.
       Pay follows EACH DAY'S OWN band, added up -- a good Ijumaa is worth something after a
       poor Jumanne -- so the week's figure alone does not tell an officer what they earned.
       The room was being shown the one number the officers are NOT paid on.

       PERCENTAGES ONLY. The `tzs` beside each of these on the commission board is that day's
       rate in shillings, and it stays off the projector for the same reason everything else
       does. Listed one by one rather than copied wholesale, so a future field added to the
       board cannot arrive on the slide by accident. */
    ...Object.fromEntries(PMO_DAY_KEYS.map(k => ['pct' + k, r['pct' + k] == null ? null : r['pct' + k]])),
    weekUncollected: r.weekUncollected, weekPct: r.weekPct };
}
