/* =====================================================================================
   THE RECOVERY OFFICER'S PAY, BY PERCENTAGE — NOT BY AMOUNT.

     "RECOVERY OFFICERS COMMISSION PLAN BY RECOVERY % NOT AMOUNTS."
     "KWA ASILIMIA ZA RECOVERY ZA (RECOVERY OFFICER) NA TEAM ALIZOPEWA, PERFORMANCE
      ITAMLIPA BILA KUJALISHA ANA TEAM NGAPI, WATEJA WANGAPI AU AMOUNT KIASI GANI"

   WHY THE CHANGE MATTERS, in one line: paying a percentage of what was recovered pays the
   officer who was handed the biggest book. Paying a band on the PERCENTAGE recovered pays the
   officer who did most with whatever book they were handed. Teams are dealt out to be of equal
   difficulty, so the second is the only one that measures the person.

   THE LADDER. Five bands, and below the bottom one pays nothing — which is intended, exactly as
   it is on the collection side, and is why 50 is a floor rather than the start of a slope.

     50–59%   KUFELI            20,000 / day      week 120,000     month 480,000
     60–69%   where we are now  25,000 / day      week 150,000     month 600,000
     70–79%   a day here and    30,000 / day      week 180,000     month 720,000
              there, not a week
     80–89%   the target, by    40,000 / day      week 240,000     month 960,000
              day and by week
     90%+     MAFANIKIO         60,000 / day      week 360,000     month 1,440,000

   WHERE 25,000 COMES FROM, because it is the anchor and the rest of the ladder hangs off it:

     600,000 a month  /  4 weeks  =  150,000 a week  /  6 days  =  25,000 a day

   and 25,000 is band (b), 60–69%, which is where the team is now. So an officer holding today's
   performance earns the 600,000 the plan sets as the floor of the job, and every band above and
   below moves them off it by their own effort. The ladder is not five arbitrary numbers; it is
   one number and four steps away from it.

   THE MONTH COLUMN IS day × 6 × 4, and the plan's own sheet has 1,340,000 against the top band
   where that arithmetic gives 1,440,000. The DAY RATE is the operative number here and it is
   the one taken; the month figure is a consequence of it, not an input. Flagged rather than
   quietly resolved, because a pay table nobody can re-derive is a pay table nobody trusts.

   THE WEEK IS SIX DAYS, AND THE SIXTH IS THE WEEKEND, SCORED ON THE WHOLE WEEK.

     "Jumatatu – Ijumaa recovery = recovery amount vs uncollected [siku 5]
      Jumamosi na jumapili full recovery = weekly recovered vs weekly defaulted
      [weekly rec perfomance as siku ya 6 from sat-sun] eg in default of 1m mon-fri rec=200k,
      then sat-sun rec =300k weekly rec = 50% and that's the 6th day record [the 50%]"

     "let the weekends stay as they are but weekly recovery is the 6th day commisssion day"

   So Monday to Friday each stand on their own: what came off the book that day against what
   the book held that day. THE WEEKEND IS NOT TOUCHED — Saturday and Sunday go on being worked
   and recorded exactly as they are, and recovery made then still counts. What they are not is
   two more paid records. The SIXTH COMMISSION DAY is the week's own figure: everything
   recovered Monday to Sunday over everything the week was given to recover.

   WHY THIS IS NOT PAYING FOR THE SAME WORK TWICE, since it looks like it at first glance. The
   five weekday records are each a snapshot of one day. The sixth is not a sixth day's work; it
   is the week judged as a whole, which is a different question and the one the officer is
   actually managed on. An officer who takes 60% every day and an officer who takes nothing for
   four days and everything on Friday can end the week identically on the sixth record, and
   differently on the first five. Both facts are worth paying for, and that is the plan.

   Worked through the plan's own example: a week defaulted 1,000,000. Mon–Fri took 200,000. The
   weekend took a further 300,000. The sixth day scores 500,000 / 1,000,000 = 50%, which lands
   in the 50–59% band and pays 20,000. Note what that means and is meant to mean: the weekend
   record is CUMULATIVE, so a strong weekend lifts a poor week rather than being judged alone,
   and five good days cannot be undone by a quiet Sunday.

   Pay is the six bands ADDED, never a band on the week's average. A good Friday has to be worth
   something after a poor Tuesday, or the ladder stops being something an officer can act on in
   the morning. That is the same rule the collection board follows, for the same reason.
   ===================================================================================== */

/* Highest first, so the first band whose floor is reached is the answer -- the same shape and
   the same reading order as PMO_BANDS, deliberately: two ladders that are read differently are
   two ladders somebody will read wrongly. */
/* THE TOP BAND HAS NO CEILING. "the last band is 90 to 100+ you know their is 100%+ rec" --
   a book can give up more than it opened with, because arrears added during the week are
   recovered in the same week. 90%+ is therefore the label as well as the rule; writing
   "90-100%" would be a promise the ladder does not keep, and the first officer to take 112%
   would go looking for the band above. */
export const RECOVERY_BANDS = [
  { floor: 90, tzs: 60000, label: '90%+ MAFANIKIO' },
  { floor: 80, tzs: 40000, label: '80–89% LENGO' },
  { floor: 70, tzs: 30000, label: '70–79%' },
  { floor: 60, tzs: 25000, label: '60–69%' },
  { floor: 50, tzs: 20000, label: '50–59% KUFELI' },
];
export const RECOVERY_BELOW = { floor: 0, tzs: 0, label: 'chini ya 50% / below 50%' };

/** Which band a recovery percentage falls in.

    A day with NOTHING TO RECOVER has no percentage at all, and that is not a failure — it is a
    day the officer was given no arrears to work, so it pays nothing and says why rather than
    being scored as 0% and dragged to the bottom of the board. Same rule as pmoBand, and it has
    to be: an officer whose team had a clean day must not read as an officer who did nothing. */
export function recoveryBand(pct) {
  if (pct == null) return null;
  for (const b of RECOVERY_BANDS) if (pct >= b.floor) return b;
  return RECOVERY_BELOW;
}

/* Jumatatu, Jumanne, Jumatano, Alhamisi, Ijumaa -- then WIKENDI, which is one slot and not two.
   The collection board's five keys with a sixth on the end, so a screen that already draws the
   PMO week can draw this one by adding a column rather than by learning a new shape. */
export const RECOVERY_DAY_KEYS = ['J3', 'J4', 'J5', 'AL', 'IJ', 'WK'];
export const RECOVERY_WEEKEND_KEY = 'WK';

/** A percentage to one decimal, or null when there was nothing to recover. One definition,
    because a board and an export that round differently disagree about which band somebody is
    in -- and that is somebody's pay. */
export function recPct(recovered, base) {
  if (!(base > 0)) return null;
  return Math.round((recovered / base) * 1000) / 10;
}

/** THE SIX RECORDS OF ONE OFFICER'S WEEK.

    `weekdays` is five { date, recovered, base } in Monday-to-Friday order -- each day's own
    drop against what that day's books held when the day started. `week` is the whole week's
    { recovered, base } INCLUDING the weekend, which is what the sixth record is scored on.

    Returns the six rows in order and what they add up to. Deliberately pure: the pay rule is
    testable without a database, and the board, the export and any slide all read the same six
    numbers rather than each working them out again. */
export function recoveryWeek(weekdays, week) {
  const rows = (weekdays || []).slice(0, 5).map((d, i) => {
    const pct = recPct(d.recovered, d.base);
    const band = recoveryBand(pct);
    return { key: RECOVERY_DAY_KEYS[i], date: d.date, recovered: d.recovered, base: d.base,
      pct, band: band ? band.label : null, tzs: band ? band.tzs : 0 };
  });
  /* THE SIXTH RECORD. Not the weekend's own percentage -- the WEEK's, which is the whole point
     of the rule: "weekly recovered vs weekly defaulted ... and that's the 6th day record". */
  const wPct = recPct(week && week.recovered, week && week.base);
  const wBand = recoveryBand(wPct);
  rows.push({ key: RECOVERY_WEEKEND_KEY, date: null,
    recovered: (week && week.recovered) || 0, base: (week && week.base) || 0,
    pct: wPct, band: wBand ? wBand.label : null, tzs: wBand ? wBand.tzs : 0,
    weekly: true });
  return { rows, tzs: rows.reduce((s, r) => s + r.tzs, 0), weekPct: wPct };
}
