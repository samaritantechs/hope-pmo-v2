/** THE ILIYONASIA REGISTER, AND THE ONE PLACE IT MEETS A COLLECTION FIGURE.
 *
 *  It lives in its own file because it is read from three sides now -- the portal's reports,
 *  the shared dashboard that the phone's summary strip is also built from, and the boards --
 *  and the alternative was portal-core importing dashboard-core importing portal-core.
 *
 *  "One definition of a rule, in one place" (CLAUDE.md). Two implementations of "does this
 *  figure include the register" is exactly what produced two different Col % for one week.
 */
import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { num } from './recovery.js';

const K = v => String(v == null ? '' : v).trim().toUpperCase();

/* =====================================================================================
   ILIYONASIA COUNTS. A REGISTER NOTHING READS BACK IS A NOTEBOOK.
   =====================================================================================
     "received amounts in all team reports and leader reports must include registered
      iliyonasia"

   Iliyonasia records a payment that was made and verified and did not reach the deck -- with
   who, when and why attached -- so the correction lives in the system instead of in somebody's
   Excel. It has been recording them and NOTHING has been reading them: every report went on
   showing the figure the deck got wrong, which is the exact situation the register was built
   to end. Writing a correction down and then not applying it is worse than not having the
   register, because it looks like the fix has been made.

   AND THEN IT WAS APPLIED IN TWO PLACES, WHICH IS ITS OWN FAULT.

     "my guys who posts reports says the col% of excels and our system differ so he is worried
      we are not including iliyonasia in collected"
     "he just uploaded and confirmed that by using the expected tab"
     "not just there: that was evidence so EVERYWHERE the amount should add as stated during
      manual input"

   The weekly report and the leader reports applied it, each in a loop of their own; the
   Expected tab, the dashboard, the Orodha, the month ledger, the month report, the officer
   boards, the commission boards and the phone's bar did not. So one week had two Col %
   depending on which screen asked, and neither matched the Excel somebody keeps by hand.

   THE AMOUNT ADDS, AS TYPED, WHEREVER A COLLECTION FIGURE IS SHOWN. The one exception is a
   screen that is deliberately showing the DECK -- the Expected tab lists it customer by
   customer -- and even there the total includes the register and the deck's own figure is
   returned beside it, never the other way round.

   withAdj_ below is now the only function that folds a correction into a collection figure.
   Every screen calls it, and none of them re-implements it.

   ALL FOUR BOOKS ARE APPLIED NOW, and one rule decides every one of them: an Iliyonasia is
   money RECEIVED, so it comes off whichever book it was filed against.

     expected-current   the day's collection sheet    -> COLLECTED up   (uncollected down)
     expected-initial   the early-collection sheet    -> COLLECTED up   (uncollected down)
     defaulter-current  the evening arrears deck      -> arrears down   -> RECOVERY UP
     defaulter-initial  the morning arrears deck      -> arrears down   -> RECOVERY DOWN

   The arrears pair looks contradictory until you write recovery out: it is initial MINUS
   current, per day. Take money off the current deck and the gap widens; take it off the
   initial deck and the day started from a lower figure, so the gap narrows. Same rule, one
   subtraction, opposite directions -- which is exactly why these two sat unapplied until
   somebody who runs the book said which was which. See ADJ_ARREARS_TARGETS below for the
   worked example.

   IT IS NEVER SILENT. Each corrected row carries `adjusted` beside its collected figure and
   the totals carry the sum, so a figure that includes a correction can always be taken apart.
   An adjustment that quietly moves a total is indistinguishable from a bug -- which is not a
   theory: the weekly report has sent `adjusted` since the day the register was first applied
   and the screen dropped it on the floor, so the figure moved and nothing said why. That is
   what sent somebody to go and check their Excel.

   ONLY ADJUSTMENTS WITH A TEAM count towards a team report -- an adjustment with no team
   cannot be attributed to one, and inventing an attribution would make the rows stop adding up
   to the total. They are returned separately as `unattributed` so the screen can say so.

   A TINY READ, AND WHERE IT IS NOW PAID FOR. This is a hand-typed register: tens of rows, not
   thousands, always bounded to the caller's own date range, always issued inside a Promise.all
   that was already there so it adds no wall time, and null where the table has not been built
   -- in which case every figure in the system is exactly what it is today.

   RULE 1 SAYS COUNT IT ON THE CALL PATH, so it is counted. The phone's daily-summary strip
   reads it TWICE -- once inside buildDashboard for today's Col, once for the week's Col beside
   it -- because that bar shows two collection figures and a bar that contradicts itself in
   front of three hundred officers is worse than the fault being fixed. Both sit behind
   summaryCache and cachedAnswer, so it is per scope per refresh, not per handset, and the
   budget for that whole path is in test/speed.test.mjs and went up by two in the same commit.

   IT IS STILL NEVER READ DURING AN UPLOAD. Nothing in api/upload.js touches this file. */
export const ADJ_RECEIVED_TARGETS = ['expected-current', 'expected-initial'];
/* THE ARREARS BOOKS, AND WHICH WAY EACH ONE MOVES RECOVERY.
   =====================================================================================
     "we have defaulter initial to mark the state of day, and current to mark the
      progress/end of the day so initial minus current = recovered amount. Per Day."
     "if an amount is registered wether positive or negative to initial or current even if by
      team or by customer ref no then it should apply in that inital deck or any current
      available"

   ONE RULE, AND BOTH DIRECTIONS FALL OUT OF IT: an Iliyonasia is money RECEIVED, and money
   received REDUCES ARREARS. It comes off whichever deck it was filed against, and recovery is
   initial minus current, so:

     defaulter-current   the evening deck missed a payment, so its arrears are too HIGH.
                         Take it off -> current falls -> RECOVERY GOES UP.

       initial 1,000,000   current 850,000 -> recovered 150,000
       + 50,000 registered against current
       initial 1,000,000   current 800,000 -> recovered 200,000

     defaulter-initial   the morning deck was wrong, so the day STARTED from an overstated
                         position. Take it off -> initial falls -> RECOVERY GOES DOWN.

       initial 1,000,000   current 850,000 -> recovered 150,000
       + 50,000 registered against initial
       initial   950,000   current 850,000 -> recovered 100,000

   THE SIGN IS TAKEN AS TYPED, both books, exactly as it is on the expected side: positive is
   money received and lowers arrears; negative is money going back out and raises them.
   Clamped at zero, because a book cannot owe less than nothing.

   WHERE IT LANDS: the deck the row NAMES, on the day it names -- "that initial deck or any
   current available". A caller has already resolved which deck it is reading (a date, a type
   and a weekday), so the correction goes onto that one, whichever weekday's it turned out to
   be. A team-day the deck never covered gets a cell made for it, same as the expected side.

   THE ONE THING IT WILL NOT DO IS INVENT A PAIR. Recovery is only measured on a day where BOTH
   decks were uploaded; a correction on a day with no pair leaves that day contributing nothing,
   because "we did not measure recovery" and "recovery was nil" are different facts and the
   register cannot turn one into the other. */
export const ADJ_ARREARS_TARGETS = ['defaulter-current', 'defaulter-initial'];
export const ADJ_ALL_TARGETS = ADJ_RECEIVED_TARGETS.concat(ADJ_ARREARS_TARGETS);

/* ---------------------------------------------------------------- READ IT ONCE, NOT PER SCREEN
   "Mind you we aint interfering app efficiency and speed : postgres issues"

   Fair. The first version of this asked the database once per screen, per range -- which on a
   dashboard meant twice in one request, and on the phone's bar twice more. On a throttled
   instance that is exactly the kind of drip nobody notices until it is everywhere.

   So the register is read WHOLE and REMEMBERED, the same way `settings` and `teams` already are
   in portal-core: it is a hand-typed book of tens of rows -- config-sized, not book-sized --
   filtering it by date on the wire saves nothing and costs the sharing. One read per database
   client per minute now serves every screen and every handset behind it, and a second caller in
   the same request pays nothing at all.

   IN-FLIGHT IS SHARED TOO. Without that, the dashboard's two callers both miss the cold cache
   in the same millisecond and both go to the database -- which is the shape that took this
   system down once already (see the note in supabase.js).

   AND A WRITE DROPS THE MEMO, so a PMO who registers a payment sees it on the next screen they
   open rather than up to a minute later.

   THE MISSING TABLE IS REMEMBERED TOO, AND THAT PART IS NOT AN OPTIMISATION. db/RUN-ME-015 is
   pasted in by hand like every migration here, so on a deployment where it has not been run,
   every one of these reads is a query Postgres REJECTS -- and logs as an error. The Supabase
   report showing twelve thousand Postgres errors is what a fallback that keeps asking looks
   like from the database's side. Asked once every five minutes instead of on every screen, the
   same fallback behaves identically and stops shouting. Same rule as knownMissing() for the
   totals functions in snapshot-totals.js, for the same reason. */
const ADJ_TTL_MS = 60000;
const ADJ_MISSING_TTL_MS = 5 * 60 * 1000;
const adjCache = new WeakMap();

/* AND IT NEVER MAKES ANYBODY WAIT. Rule 1 in CLAUDE.md, applied honestly rather than only
   counted: this register rides on /api/call now -- twice on the phone's summary strip, once
   inside buildDashboard for today's Col and once for the week's -- and the database it reads
   has been running Unhealthy at 83% RAM. Counting the read was not enough. A read that is
   ONE of thirty on a path is still a read that can HANG, and a hang on that path is three
   hundred officers looking at a spinner because a report figure could not be corrected.

   So every caller gets an answer within a budget or gets null, and null means "the figures are
   exactly what the decks say" -- the same answer a deployment without the table gets, which is
   a state this whole file is already built to be correct in. The read runs on and fills the
   memo for the next caller; nothing is cancelled, because cancelling would not give the
   database its time back.

   A slow database is not a reason to slow the phone down. It is a reason to ask it for less
   and draw the screen. */
export const ADJ_BUDGET_MS = 1500;
function within_(p, ms, fallback) {
  let t = null;
  const late = new Promise(res => { t = setTimeout(() => res(fallback), ms); if (t.unref) t.unref(); });
  return Promise.race([p.then(v => { clearTimeout(t); return v; }, () => { clearTimeout(t); return fallback; }), late]);
}

/** Called by every write to the register, so an admin sees their own entry immediately. */
export function noteAdjustmentsWritten(db) { adjCache.delete(db); }

async function readAdjustments(db, nowMs) {
  const at = nowMs || Date.now();
  const hit = adjCache.get(db);
  if (hit) {
    if (hit.missingAt && (at - hit.missingAt) < ADJ_MISSING_TTL_MS) return null;
    if (hit.pending) return hit.pending;
    if (hit.rows && (at - hit.at) < ADJ_TTL_MS) return hit.rows;
  }
  const pending = (async () => {
    try {
      /* WHOLE, AND FIVE COLUMNS. The reason and who typed it belong to the Iliyonasia tab,
         which reads the table itself. A collection figure needs the team, the book, the amount
         and the day -- and the REF, because commission on the early-collection scheme is paid
         per customer rather than on a percentage, and a customer is a ref. */
      const rows = await fetchAll(() => db.from('pmo_adjustments')
        .select('team, target, amount, adj_date, ref'));
      adjCache.set(db, { at: Date.now(), rows });
      return rows;
    } catch (e) {
      // db/RUN-ME-015 not run here. Remembered, so the next screen does not ask again and get
      // the same rejection logged against the database a second time.
      adjCache.set(db, { at, missingAt: Date.now() });
      return null;
    }
  })();
  adjCache.set(db, { at: (hit && hit.at) || 0, rows: hit && hit.rows, pending });
  return pending;
}

export async function adjReceived_(db, user, { from, to, budgetMs = 0 } = {}) {
  /* `budgetMs` is passed by everything on the call path and by nothing else: a report can wait
     for its own correction, the phone cannot. See ADJ_BUDGET_MS above. */
  const all = budgetMs > 0
    ? await within_(readAdjustments(db), budgetMs, null)
    : await readAdjustments(db);
  if (all == null) return null;        // db/RUN-ME-015 not run here -- reports are unchanged
  /* THE DATE WINDOW, APPLIED HERE. It used to be a `gte`/`lte` on the wire; on tens of rows
     that is a round trip to save nothing, and it is what stopped the register being shared
     between two callers asking for two different ranges in one request. */
  const rows = all.filter(r => {
    const d = String(r.adj_date || '').slice(0, 10);
    return d >= from && d <= to;
  });
  /* KEYED BY TARGET, because the two books are two different figures. `expected-current` is
     the day's collection sheet and `expected-initial` is the early-collection one -- a
     correction to one is not a correction to the other, and adding them together would move
     Col by an Early Col figure and be impossible to find afterwards. */
  const byTeam = new Map(), byDay = new Map(), byCell = new Map(), byRef = new Map();
  const total = {}, seen = {};
  let unattributed = 0;
  const add = (m, k, a) => m.set(k, (m.get(k) || 0) + a);
  for (const r of (rows || [])) {
    const tg = String(r.target);
    // All four books now. The arrears pair was parked until somebody said which way it read;
    // they have -- see ADJ_ARREARS_TARGETS above.
    if (!ADJ_ALL_TARGETS.includes(tg)) continue;
    const a = num(r.amount);
    if (!r.team) { unattributed += a; continue; }
    if (!teamAllowed(user, r.team)) continue;
    add(byTeam, tg + '|' + K(r.team), a);
    /* PER DAY AS WELL AS PER TEAM, because a report that applies a correction to its team
       table and not to its day strip shows two figures for the same money on the same screen
       -- and only after a correction, which is exactly when somebody is already hunting a
       discrepancy. Every figure on a report moves together or none of them does. */
    const d = String(r.adj_date || '').slice(0, 10);
    if (d) {
      add(byDay, tg + '|' + d, a); add(byCell, tg + '|' + r.team + '|' + d, a);
      /* NETTED PER REF AS WELL, for the commission side. Two rows against the same customer on
         the same day are ONE customer -- a second entry is a correction to the first, not a
         second person paying -- and a ref whose entries net to nothing or less is not somebody
         who paid at all. Both of those are decided here, once, rather than by whoever counts. */
      const ref = String(r.ref == null ? '' : r.ref).trim();
      if (ref) add(byRef, tg + '|' + r.team + '|' + d + '|' + ref, a);
    }
    total[tg] = (total[tg] || 0) + a;
    seen[tg] = (seen[tg] || 0) + 1;
  }
  return { total, seen, unattributed,
    of: (target, team) => byTeam.get(target + '|' + K(team)) || 0,
    onDay: (target, date) => byDay.get(target + '|' + String(date).slice(0, 10)) || 0,
    /* The register rows themselves, netted per team per day, for a caller that fills cells
       rather than adding to a finished total. Same rows, one grouping further down. */
    cells: target => [...byCell.entries()]
      .filter(([k]) => k.startsWith(target + '|'))
      .map(([k, amount]) => { const p = k.split('|'); return { team: p[1], date: p[2], amount }; }),
    /* THE CUSTOMERS THE REGISTER NAMES, one entry per ref per team per day, with what that
       ref nets to. Only rows that CARRY a ref appear: an entry with no ref is money that
       cannot be attributed to a person, and inventing a person to pay somebody for would be
       worse than paying nothing. */
    refCells: target => [...byRef.entries()]
      .filter(([k]) => k.startsWith(target + '|'))
      .map(([k, amount]) => { const p = k.split('|'); return { team: p[1], date: p[2], ref: p[3], amount }; }) };
}

/* =====================================================================================
   PAYING FOR A CUSTOMER, AND NOT PAYING FOR THEM TWICE.
   =====================================================================================
     "yes keep commission on the register: everywhere the amount was registered it must apply
      so even commissions too and they are the most complaining on this part"
     "so check the deck by customer ref no and status not amounts"

   THE TWO SCHEMES ARE PAID DIFFERENTLY, and that is why applying the amount was only half the
   job. PMO Collection is paid by BAND on the day's collection percentage, so a registered
   payment moves the percentage and therefore moves the money -- that half worked the moment the
   amount was applied. Early Collection is paid PER CUSTOMER: so many PAID or OVERPAID, times a
   rate. An Iliyonasia has no customer row, so it moved that officer's percentage and left their
   shillings exactly where they were. They are the ones complaining, and they were right to.

   SO A REGISTERED PAYMENT COUNTS AS ONE COLLECTED CUSTOMER -- if it names one. A register row
   with a REF is a person; a row without one is money that cannot be attributed to anybody, and
   inventing a person to pay somebody for is worse than paying nothing. A ref whose entries net
   to zero or less is not somebody who paid.

   AND THE DECK IS CHECKED BY REF AND STATUS, NEVER BY AMOUNT. When the corrected sheet finally
   arrives with that customer marked PAID, the deck and the register would each pay for them --
   the same person, twice, on a screen that decides what people are owed. So before a ref is
   counted, that day's book is asked one question about it: does this customer already read PAID
   or OVERPAID here? If so the register does not pay for them again; the deck already has.
   Comparing AMOUNTS would be the wrong test -- a part payment, a rounding, a customer who paid
   twice, and it silently pays or silently does not. A status is what the sheet actually asserts.

   IT IS A NARROW READ, AND USUALLY NO READ AT ALL. Only the refs the register itself names are
   asked about -- tens of them, by primary-key-shaped `in (...)`, over the days already in hand
   -- and a range with no ref-carrying rows in it does not go to the database at all. It is
   called from the commission board and from nowhere else: this is the one screen where the
   count decides money, and the count is not worth a read on any screen where it is decoration.

   Where the migration has not been run, or the read fails, NOTHING is counted. Paying nobody by
   accident is a complaint; paying twice by accident is a loss and an argument. */
export async function adjCountableRefs_(db, adj, { target, snapshotType, from, to }) {
  /* Never called from the call path -- the commission board is a portal screen -- so this one
     has no budget and is allowed to take the time it needs to be right about somebody's pay. */
  const empty = new Set();
  if (!adj) return empty;
  /* Positive only. A negative entry is money going back out -- a correction to a correction --
     and it does not make somebody a paying customer. */
  const named = adj.refCells(target).filter(c => c.amount > 0);
  if (!named.length) return empty;
  const refs = [...new Set(named.map(c => c.ref))];
  let rows = [];
  try {
    rows = await fetchAll(() => db.from('repayment_snapshots')
      .select('ref, team, snapshot_date, todays_status')
      .eq('snapshot_type', snapshotType)
      .in('ref', refs)
      .gte('snapshot_date', from).lte('snapshot_date', to));
  } catch (e) {
    return empty;                       // cannot check -- so do not pay. See above.
  }
  const already = new Set();
  for (const r of (rows || [])) {
    const st = K(r.todays_status);
    if (st !== 'PAID' && st !== 'OVERPAID') continue;
    already.add(K(r.team) + '|' + String(r.snapshot_date || '').slice(0, 10) + '|' + K(r.ref));
  }
  const out = new Set();
  for (const c of named) {
    const k = K(c.team) + '|' + c.date + '|' + K(c.ref);
    if (!already.has(k)) out.add(k);
  }
  return out;
}

/* THE CORRECTION FOLDED INTO TEAM-DAY TOTALS -- ONE FUNCTION, EVERY SCREEN.
   =====================================================================================
     "the col% of excels and our system differ ... he is worried we are not including
      iliyonasia in collected"

   He was right, and the reason is the one CLAUDE.md names: the rule had TWO implementations.
   The weekly report and the leader reports applied the register by hand, each in their own
   loop; the dashboard, the Orodha, the month ledger, the month report and the presentation
   never applied it at all. So the same week's Col % read one figure on the report he posts
   and a different one on the screen the directors open, and neither of them matched the
   Excel he keeps by hand. Two answers to one question is worse than the wrong answer,
   because there is nothing to correct.

   This is now the ONE place a registered Iliyonasia meets a collection figure. It takes
   team-day totals rows -- the shape every collection screen in this system reads -- and
   returns them with the correction in:

     collected   up by the registered amount
     uncollected down by it, clamped at zero: money received is money no longer outstanding
     adjusted_amt  carried on the row, so any total built from these rows can still say how
                   much of itself is correction rather than deck

   CALL IT AFTER pickLatestBatchRows, NEVER BEFORE. These rows carry `upload_batch`, and the
   rule that decides which upload wins compares batches. A correction folded in before that
   would either be thrown away with a losing batch or -- worse -- survive as its own batch and
   push a real deck out. After the batch is resolved there is exactly one row per team per day
   and the correction has one place to land.

   A CELL IS MADE IF THERE IS NONE, and `onDate` is what makes that safe: a correction on a
   day whose sheet never arrived is precisely the case the register exists for, but a caller
   that has filtered to one day must not be handed rows from another. Callers holding a single
   resolved day pass that day; callers holding a whole resolved range pass null. */
export function withAdj_(rows, adj, target, onDate = null, countable = null) {
  if (!adj) return rows;
  /* One day, a named set of days, or null for "these rows are the whole range I read". The set
     form is for the shared dashboard, whose Expected read is today on a weekday and the whole
     week at the weekend: it has to accept every day it drew and no others. */
  const only = onDate == null ? null
    : Array.isArray(onDate) || onDate instanceof Set
      ? new Set([...onDate].map(d => String(d).slice(0, 10)))
      : String(onDate).slice(0, 10);
  const inRange = d => only == null || (only instanceof Set ? only.has(d) : d === only);
  const cells = adj.cells(target).filter(c => inRange(c.date));
  if (!cells.length) return rows;
  /* HOW MANY CUSTOMERS THIS CORRECTION IS WORTH, per team-day -- see adjCountableRefs_. Only
     the commission board passes a set; everywhere else `paid_n` is a display count and moving
     it would change a figure nobody asked about. Null and empty behave identically, so a
     caller that asks for counting on a range with nothing countable in it gets today's
     behaviour exactly. */
  const nBy = new Map();
  if (countable && countable.size) {
    for (const c of adj.refCells(target)) {
      if (!inRange(c.date) || c.amount <= 0) continue;
      const k = K(c.team) + '|' + c.date;
      if (!countable.has(k + '|' + K(c.ref))) continue;
      nBy.set(k, (nBy.get(k) || 0) + 1);
    }
  }
  const dayOf = r => String(r.snapshot_date || '').slice(0, 10);
  const out = rows.slice();
  const at = new Map();
  for (let i = 0; i < out.length; i++) {
    const k = K(out[i].team) + '|' + dayOf(out[i]);
    if (!at.has(k)) at.set(k, i);
  }
  for (const c of cells) {
    const k = K(c.team) + '|' + c.date;
    const n = nBy.get(k) || 0;
    const i = at.get(k);
    if (i == null) {
      at.set(k, out.length);
      out.push({ snapshot_date: c.date, snapshot_type: null, team: c.team,
        upload_batch: null, created_at: null, customers: n,
        expected_amt: 0, collected_amt: c.amount, uncollected_amt: 0,
        paid_n: n, over_n: 0, adjusted_amt: c.amount, adjusted_n: n });
    } else {
      const r = out[i];
      out[i] = { ...r,
        collected_amt: num(r.collected_amt) + c.amount,
        uncollected_amt: Math.max(0, num(r.uncollected_amt) - c.amount),
        adjusted_amt: num(r.adjusted_amt) + c.amount,
        /* PAID, not OVERPAID. The register says a payment was made and verified; nothing in it
           says it was more than what was due, and guessing the richer of the two rates would
           pay somebody for a thing nobody wrote down. */
        paid_n: num(r.paid_n) + n,
        adjusted_n: num(r.adjusted_n) + n };
    }
  }
  return out;
}
/* THE SAME FOLD, ON THE ARREARS SIDE. Deliberately its own function rather than a flag on
   withAdj_: these rows carry `arrears_amt` and nothing else that money touches, and the
   direction is opposite -- money received makes an arrears figure SMALLER where it makes a
   collected figure bigger. One function that did both would be one `if` away from applying a
   payment as a debt, on the number the Monday meeting is read from.

   `onDate` is not optional here and takes no set: recovery is a per-day pairing, and a caller
   always holds one day's deck when it asks. */
export function withAdjDef_(rows, adj, target, onDate) {
  if (!adj || !onDate) return rows;
  const day = String(onDate).slice(0, 10);
  const cells = adj.cells(target).filter(c => c.date === day);
  if (!cells.length) return rows;
  const out = rows.slice();
  const at = new Map();
  for (let i = 0; i < out.length; i++) {
    const k = K(out[i].team);
    if (!at.has(k)) at.set(k, i);
  }
  for (const c of cells) {
    const i = at.get(K(c.team));
    if (i == null) {
      /* A TEAM-DAY THE DECK NEVER COVERED still gets a cell -- a correction against a book that
         did not arrive is exactly the case the register exists for. It carries the deck's own
         shape so whatever sums it cannot tell the difference; `customers` stays 0 because a
         correction is an amount, not a person, and a headcount must not grow by it. */
      at.set(K(c.team), out.length);
      out.push({ snapshot_date: c.date, snapshot_type: null, weekday: null, team: c.team,
        upload_batch: null, created_at: null, customers: 0,
        arrears_amt: Math.max(0, -c.amount), adjusted_amt: c.amount });
    } else {
      const r = out[i];
      out[i] = { ...r,
        // Money received lowers a debt. Clamped: a book cannot owe less than nothing.
        arrears_amt: Math.max(0, num(r.arrears_amt) - c.amount),
        adjusted_amt: num(r.adjusted_amt) + c.amount };
    }
  }
  return out;
}

/** How much of a set of already-corrected rows is correction rather than deck. */
export const tAdjusted = rows => rows.reduce((s, r) => s + num(r.adjusted_amt), 0);
/** And how many of its collected CUSTOMERS came from the register rather than the deck -- so a
    commission board can say what it is paying for, and a double can be found by looking. */
export const tAdjustedN = rows => rows.reduce((s, r) => s + num(r.adjusted_n), 0);