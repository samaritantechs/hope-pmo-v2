import { fetchAll, runQuery , rpcAll } from './supabase.js';
import { teamAllowed, ADMIN_TABS, ALL_TABS } from './auth.js';
import { generatePasscode, hashPasscode } from './passcode.js';
import { todayKey, currentWeekday, isoWeekday, weekMondayKey, addDaysKey } from './time.js';
import { latestSnapshot, snapshotsInRange, upperTeams, pickLatestBatch , latestDeckAnyWeekday , pickLatestPerCustomer, withBatchKeys } from './snapshots.js';
import { expectedTotalsInRange, expectedTotalsLatest, defaulterTotalsInRange,
  totalsAggSlice, monthSummaryRows,
  tCustomers, tExpected, tCollected, tUncollected, tArrears, tPaidOver , deckDatesPerTeam, deckKey } from './snapshot-totals.js';
import { cachedAnswer } from './answer-cache.js';
import { pmoBoard, pmoPublicRow, isPmoRole, PMO_BANDS, PMO_ROLE_KEY, PMO_ROLE_DEFAULT, PMO_BONUS_KEY } from './pmo.js';
import { notifCore, notifSeenCore, notifKeyFor } from './notify.js';
import { audited, auditList, AUDITED } from './audit.js';
import { recordPerformance, performanceHistory, recordsFor } from './performance.js';
import { isSystemOpen, clearSystemOpenCache, readsAsOpen } from './system-gate.js';

/** Narrow a query to the teams the caller may see, or leave it alone for somebody who sees
    everything. scoped() still runs afterwards -- it is the rule, and a filter that quietly
    stopped working must not become a data leak -- but by then there is little left to drop. */
const onTeams = (q, teams) => (teams && teams.length ? q.in('team', upperTeams(teams)) : q);
import { collectedOf, uncollectedOf, num, recoveryBasis } from './recovery.js';
import { buildDashboard, SALES_STAGES } from './dashboard-core.js';
import { reportCoreForPortal, pnorm, h36, fuStatusConfig, fuStatusShape, parseFuStatuses,
  FU_STATUS_KEY, isCreditRole, buildLeaderMaps, positionOf } from './call-core.js';
import { ROLE_COLS, assignFor, assignStrategy } from './assign.js';
import { expdfMine, expdfReport } from './expdf.js';

/** Every read and write behind the portal (public/app.html), one function per tab, all
    team-scoped through the same teamAllowed the rest of the system uses. Ported from the
    api_* family in the live Code.gs: the SHAPES the portal consumes are what matter, and
    each function below is the v2 query that produces the same answer the sheets did.

    Everything runs against an injected `db`, so the whole surface is testable against the
    fake PostgREST client without a network. */

const K = s => String(s == null ? '' : s).trim().toUpperCase();
const scoped = (user, rows) => rows.filter(r => teamAllowed(user, r.team));

/* ------------------------------------------------------------------ loans (applications) */
const STAGES = ['unassigned', 'assigned', 'unassessed', 'assessed', 'pending_approval', 'approved', 'pending_disb', 'disbursed'];

/** The pipeline, filterable by stage -- but ALL stages is a real choice and the default,
    because "where is every application right now" is the question this tab gets asked most,
    and forcing a stage first meant a docket could only be found if you already knew which
    stage it had reached. */
async function loans(db, user, { stage }) {
  const st = STAGES.includes(stage) ? stage : '';
  /* Scoped at the database. An officer holding one team read every loan the company has ever
     written -- all forty teams, every column -- and kept a fortieth of it. */
  const q = onTeams(db.from('loans').select('*'), user.teams);
  const rows = await fetchAll(() => (st ? q.eq('stage', st) : q).order('created_at', { ascending: false }));
  const mine = scoped(user, rows);
  return { stage: st, stages: STAGES, rows: mine, count: mine.length,
    amount: mine.reduce((s, r) => s + (num(r.principal_amt) || num(r.requested_amt) || num(r.loan_amt)), 0) };
}

/** Counts for every stage in one pass -- the applications tab's pipeline strip. */
async function loanPipeline(db, user) {
  // Same read, same rule: narrowed in the query rather than after it has all arrived.
  const rows = scoped(user, await fetchAll(() => onTeams(db.from('loans').select('team, stage, principal_amt, requested_amt, loan_amt'), user.teams)));
  const by = {};
  for (const st of STAGES) by[st] = { stage: st, count: 0, amount: 0 };
  for (const r of rows) {
    const b = by[r.stage];
    if (!b) continue;
    b.count++;
    b.amount += num(r.principal_amt) || num(r.requested_amt) || num(r.loan_amt);
  }
  // A card per stage, and the two figures v1 led with: how many applications are in the
  // pipeline ALTOGETHER, and what they are asking for. Eight stage cards answer "where are
  // they" and never "how many".
  const stages = STAGES.map(s => by[s]);
  return { stages,
    total: stages.reduce((n, x) => n + x.count, 0),
    requested: rows.reduce((n, r) => n + num(r.requested_amt), 0) };
}

/* ------------------------------------------------------------------ expected repayment */
/* EXACTLY WHAT THE EXPECTED TAB DRAWS, and nothing else.
   The table's own columns, plus the guarantor pair the follow-up drawer offers to ring when
   the customer will not answer, plus the three collectedOf() reads. Everything else on the row
   -- the docket, four schedule dates, the branch, the totals -- was crossing the internet for
   every customer of every team on every open of this tab.

   IF A COLUMN IS ADDED TO THE SCREEN IT MUST BE ADDED HERE. The fake database in the tests
   honours the projection, so a forgotten one shows up as a red test rather than as a blank
   column in the field. */
const EXPECTED_TAB_COLS = 'ref, full_name, contact, team, zone, due_summary, initial_inst, '
  + 'payment_expected, todays_payment, todays_status, arrears, balance, '
  + 'guarantor_name, guarantor_contact';

async function expected(db, user, { type = 'today', date }, nowMs) {
  /* TEAM-SCOPED AT THE DATABASE. This downloaded every team's customers and threw away the
     thirty-nine the officer may not see -- the exact read behind the 521s in the log
     (`select=*&snapshot_date=eq...&limit=10000`). An officer on one team now carries one
     team's rows. An admin, whose teams are null, is unchanged.

     Deliberately not applied to the DATE resolution inside latestSnapshot: which day is the
     latest is a property of the whole upload, and a team with no rows that day must not
     silently fall back to an older one. */
  const snap = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: type },
    date ? { onDate: date, teams: user.teams, columns: EXPECTED_TAB_COLS }
         : { notAfter: todayKey(nowMs), teams: user.teams, columns: EXPECTED_TAB_COLS });
  const rows = scoped(user, snap.rows).map(r => ({ ...r, collected: collectedOf(r) }));
  const expectedAmt = rows.reduce((s, r) => s + num(r.payment_expected), 0);
  const collected = rows.reduce((s, r) => s + r.collected, 0);
  const status = {};
  for (const r of rows) { const k = K(r.todays_status) || '(BLANK)'; status[k] = (status[k] || 0) + 1; }
  return {
    type, date: snap.date, rows, count: rows.length,
    totals: { expected: expectedAmt, collected, uncollected: uncollectedOf(rows),
      pct: expectedAmt > 0 ? Math.round((collected / expectedAmt) * 1000) / 10 : null },
    byStatus: Object.keys(status).sort().map(k => ({ status: k, count: status[k] })),
  };
}

/* =====================================================================================
   THE DEMAND MESSAGE -- one wording, one number, WhatsApp or SMS.
   =====================================================================================
   "We need a WHATSApp & Normal sms demand message pretext button that lands at message with
      Habari
      Unakumbushwa kulipa deni lako (Arreas) kuepusha usumbufu.
      Kwa maelezo Zaidi piga (user phone no from leader table chat, if not in chat default to
      pmo recovery no)"

   COMPOSED ON THE SERVER, not in the page. Two screens send it -- the portal's follow-up
   drawer and the phone's customer sheet -- and a demand notice whose wording depends on which
   screen it was sent from is two different notices going out under one company's name. The
   text is a setting, so it can be changed without a deploy.

   THE NUMBER IS THE POINT. A demand notice telling a customer to ring a number nobody answers
   is worse than sending nothing, so it is resolved in the order of who actually knows this
   customer:

     1. the sender's OWN number, if the teams table has one for the role they hold on THIS
        customer's team -- "the user phone no from the leader table"
     2. the team's recovery officer, who owns the book this customer is in
     3. PMO_RECOVERY_NO from Settings -- "if not in chat default to pmo recovery no"

   If none of those exist the message goes out WITHOUT the "piga" line rather than with an
   empty one or the word "undefined". A reminder with no number is still a reminder; a reminder
   telling somebody to call nothing is a complaint waiting to happen.

   NOTHING IS SENT FROM HERE. This returns the text and the links; the officer's own phone opens
   WhatsApp or the SMS app with it, from their own number, which is the number the customer
   already knows. No gateway, no cost, no third party holding the book. */
const DEMAND_TEXT_KEY = 'DEMAND_MESSAGE_TEXT';
const DEMAND_DEFAULT =
  'Habari\n'
  + 'Unakumbushwa kulipa deni lako (Arreas) kuepusha usumbufu.\n'
  + 'Kwa maelezo Zaidi piga {phone}';

/** Digits only, with Tanzania's country code, which is what wa.me expects. Leaves anything it
    does not recognise alone rather than mangling it -- a number it cannot parse is still a
    number a person can read in the text. */
export function waNumber(v) {
  const d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('255')) return d;
  if (d.startsWith('0')) return '255' + d.slice(1);
  if (d.length === 9) return '255' + d;
  return d;
}

/** Which number a customer should be told to ring. Exported so the rule is testable on its own
    -- it is three fallbacks deep and the wrong one printed on a demand notice is a phone that
    rings in the wrong office. */
export function demandContact(user, teamRow, pmoDefault) {
  const t = teamRow || {};
  const me = K(user && user.name);
  // 1. The sender's own number, found by the role THEY hold on THIS team.
  for (const role of Object.keys(TEAM_PHONE_OF)) {
    if (me && K(t[role]) === me && t[TEAM_PHONE_OF[role]]) {
      return { phone: String(t[TEAM_PHONE_OF[role]]).trim(), source: role };
    }
  }
  // 2. The recovery officer, who owns the book this customer is in.
  if (t.recovery_no) return { phone: String(t.recovery_no).trim(), source: 'recovery' };
  // 3. The PMO's own number.
  if (pmoDefault) return { phone: String(pmoDefault).trim(), source: 'pmo' };
  return { phone: '', source: 'none' };
}

async function demandMessage(db, user, { ref, team }, nowMs) {
  const wanted = String(ref == null ? '' : ref).trim();
  if (!wanted) throw badRequest('ref is required');

  /* The customer is looked up so the team is OURS to decide rather than the caller's to claim
     -- otherwise anybody could pass another team's name and read its officer's phone number. */
  const [fuRows, teamRows, pmoNo] = await Promise.all([
    fetchAll(() => db.from('followup_status').select('ref, full_name, contact, team').eq('ref', wanted)),
    readTeamsAll(db),
    settingGet(db, 'PMO_RECOVERY_NO'),
  ]);
  const found = fuRows[0] || null;
  const teamName = found ? found.team : normTeamName(team);
  if (teamName && !teamAllowed(user, teamName)) {
    throw forbidden(`You do not have access to team ${teamName}.`);
  }
  const teamRow = teamRows.find(t => K(t.team) === K(teamName)) || null;
  const { phone, source } = demandContact(user, teamRow, pmoNo);

  const template = (await settingGet(db, DEMAND_TEXT_KEY)) || DEMAND_DEFAULT;
  /* A template with no {phone} in it is honoured as written -- somebody who deliberately
     removed the line meant to remove it. A template that HAS the placeholder and no number to
     put in it loses that whole line, not just the token. */
  const text = phone
    ? template.split('{phone}').join(phone)
    : template.split('\n').filter(l => l.indexOf('{phone}') < 0).join('\n');

  const to = waNumber(found ? found.contact : '');
  return {
    ref: wanted, name: found ? found.full_name : '', team: teamName || '',
    contact: found ? found.contact : '', phone, phoneSource: source, text,
    // Both links are built here so the two screens cannot drift into two different messages.
    whatsapp: to ? ('https://wa.me/' + to + '?text=' + encodeURIComponent(text))
      : ('https://wa.me/?text=' + encodeURIComponent(text)),
    sms: 'sms:' + (found && found.contact ? String(found.contact).trim() : '')
      + '?body=' + encodeURIComponent(text),
  };
}

/* ------------------------------------------------------------------ defaulters */
/* =====================================================================================
   WHERE IS THIS CUSTOMER? -- and if she is nowhere, WHY.

     "Some customers werent seen in credit users for defaulters, while troubleshooting they
      aint seen anywhere even in my admin user yet they are in the uploaded file"

   She was in the database the whole time. Defaulter decks are stored PER WEEKDAY -- that is
   deliberate and must stay, because an initial MON deck compared against a current TUE deck
   measures two different populations and reports the gap as recovery. But every screen reads
   TODAY'S weekday, so a customer whose deck was uploaded under Tuesday is invisible on Monday.
   To everyone. Including the admin. With nothing on any screen to say so.

   That is the worst shape a fault can have: the data is right, the screens are right, and the
   person looking has no way to find out which of the two is lying to them. Reproduced exactly
   -- change the deck's weekday and she vanishes from Exp.Def, the Defaulters tab and the credit
   book at once.

   So this answers the question directly. Give it a reference, a name or a phone number and it
   says every place that customer appears -- which date, which weekday, which deck, which upload
   -- and then says, in words, whether today's screens can see her and what to do if not.

   POSTGRES: three bounded reads. Each is team-scoped for a scoped user, capped, and searched
   with an indexed prefix rather than a whole-table scan followed by JavaScript. */
const FIND_LIMIT = 200;
const FIND_COLS = 'ref, full_name, contact, guarantor_name, guarantor_contact, team, status, ds, arrears, snapshot_type, weekday, snapshot_date, upload_batch, created_at';

/* =====================================================================================
   THE PHONE READS THE REGISTER, NOT THE DECK.

     "I as admin not yet seeing her on the call app defaulters"

   HOPE Calls builds its Defaulters list from followup_status -- the working register -- and
   deliberately so: an officer's own follow-up statuses, promises and comments live there, and
   the list has to carry them. The register is rebuilt from every deck upload
   (syncFollowupFromDeck), so in normal running the two agree.

   They can come apart. A customer retired for going a fortnight without their weekday's deck
   coming round, or one whose deck was loaded before the register was being written, sits in
   the deck and not in the register -- present on every portal screen and absent from every
   handset. Nothing said so, because each half was individually correct.

   This puts them back. It reads the current book the same way every screen now does -- the
   latest deck, EVERY weekday, one row per customer -- and writes in anyone the register is
   missing, leaving every existing row completely alone.

   IT NEVER TOUCHES AN OFFICER'S WORK. Only refs that are ABSENT are inserted; a row that is
   already there keeps its follow-up status, its promise, its comments and its arrears exactly
   as they are. The worst this can do is add somebody who is already a defaulter.

   POSTGRES: one bounded deck read, one keys-only read of the register, and chunked inserts of
   the difference. Admin only and on demand -- it is a repair, not something a screen runs. */
const FU_REPAIR_CHUNK = 400;

/* =====================================================================================
   THE DEFAULTER BOOK: EVERY TEAM'S OWN LATEST DECK, EVERY WEEKDAY, ONCE PER CUSTOMER.

   Three rules had to be made per-team rather than global before a defaulter could reliably be
   seen. Two were already done; this adds the third and last:

     WHICH BATCH   fixed once -- was per DAY, threw away sixteen teams when a day arrived as
                   seventeen files
     WHICH WEEKDAY fixed once -- a defaulter is a defaulter every day; only the Exp.Def
                   rotation is weekday-shaped
     WHICH DATE    THIS. `latestSnapshotDate` asks the WHOLE TABLE for its newest date, so one
                   team uploaded with a newer date made every team with an older deck vanish
                   entirely -- which is why re-uploading her team changed nothing. Her deck was
                   landing perfectly and being filtered out by somebody else's upload.

   ONE ROUND TRIP TO LEARN THE DATES -- the team-day totals function, a GROUP BY that sends no
   customer rows -- and then ONE READ PER DISTINCT DATE, which in practice is one or two. Teams
   are grouped by the date they resolved to, so no team's rows are fetched for a day it has
   nothing on.

   WITHOUT THE MIGRATION it falls back to the old single-date read. Deliberately: the honest
   alternative would be reading a month of decks to work the dates out here, and that is exactly
   the kind of read this system has spent days removing. The screen says which it used. */
const DECK_LOOKBACK_DAYS = 45;

async function defaulterBook(db, user, { type = 'current', notAfter, onDate, columns } = {}) {
  /* A PINNED DATE IS ALREADY THE ANSWER. The Monday baseline asks for one specific day, so
     there is no "which date does each team have" question to ask -- resolving per team would
     only be a way of quietly reading a different day than the one requested. */
  if (onDate) {
    const snap = await latestDeckAnyWeekday(db, 'defaulter_snapshots', { snapshot_type: type },
      { onDate, teams: user.teams, columns });
    return { ...snap, perTeam: false };
  }
  const to = notAfter;
  /* CURRENT DEFAULTERS LIVE UNTIL THE NEXT UPLOAD REPLACES THEM -- NO LOOKBACK, NO GRACE.
     "the latest current defaulter file is to live until the next one, no limit" -- and the
     other independent reports (approved, received, expected) "just there to keep record how
     we closed the day but they dont decide defaulters". Confirmed after "i bulked paid
     clients, many of them brother!" kept recurring: a team missing from today's whole-company
     CURRENT file has zero current defaulters, full stop -- not a team whose own upload merely
     lagged a day. So this pins to the single latest date across the WHOLE table (same as the
     "migration not run" fallback a few lines down always has) and never reaches back through
     the per-team, up-to-45-day lookback below.

     THIS DELIBERATELY REOPENS A DOOR THE GOBA/MBEYA TESTS BELOW WERE WRITTEN TO CLOSE: a team
     on an older date now reads as zero for CURRENT, not as "their own latest deck" -- see
     deckDatesPerTeam's own comment in snapshot-totals.js for the real incident that door was
     built for. Weighed and accepted on purpose, for 'current' only: a paid-off team's ghosts
     must not outlive one more whole-company upload. 'initial' baselines (and anything else
     that calls this) still take the per-team path below, unchanged -- a customer's baseline
     arrears is not re-uploaded on the same cadence a defaulter list is, and staying sticky
     there is still the safer failure. */
  if (type === 'current') {
    const snap = await latestDeckAnyWeekday(db, 'defaulter_snapshots', { snapshot_type: type },
      { notAfter: to, teams: user.teams, columns });
    return { ...snap, perTeam: false };
  }
  const from = addDaysKey(to, -DECK_LOOKBACK_DAYS);
  const dates = await deckDatesPerTeam(db, { type, from, to, teams: user.teams });
  if (!dates || !dates.size) {
    // No migration, or nothing in the window -- the previous behaviour, unchanged.
    const snap = await latestDeckAnyWeekday(db, 'defaulter_snapshots', { snapshot_type: type },
      { notAfter: to, teams: user.teams, columns });
    return { ...snap, perTeam: false };
  }
  /* Group the resolved decks by the date THEY landed on. A deck is a team AND a weekday, so
     Monday's GOBA and Thursday's GOBA are two different decks that were uploaded on two
     different days -- reading only the team's newest date kept whichever weekdays went up last
     and dropped the rest of the week. In practice this is still a handful of distinct dates,
     because a week's uploads cluster. */
  const byDate = new Map();                    // date -> { teams:Set, weekdays:Set, want:Set }
  for (const [key, d] of dates) {
    if (!byDate.has(d)) byDate.set(d, { teams: new Set(), weekdays: new Set(), want: new Set() });
    const g = byDate.get(d);
    const [team, wd] = key.split('|');
    g.teams.add(team);
    g.weekdays.add(wd);
    g.want.add(key);
  }
  /* ONE DATE AT A TIME, NOT ALL OF THEM AT ONCE.

     This loop used to be a Promise.all, and that was defensible while it resolved ONE date per
     team: a week's uploads cluster, so it was two requests in flight. Per weekday it is one per
     distinct upload day -- six or seven in a normal week, and more on a deployment that has been
     catching up. Firing those together is precisely the change that was tried once on the paging
     side and reverted the same day: every screen fires several of these at once, and with two
     hundred handsets the multiplied concurrency exhausted the connection pool. Logins started
     failing with "failed to fetch" and the data-heavy tabs errored.

     Sequential costs latency on one screen. Concurrent costs the whole system. */
  const all = [];
  for (const [d, g] of byDate) {
    /* Narrowed on BOTH columns at the database, then matched on the exact pairs here. The
       filters cannot express "these team/weekday combinations" on their own, so they fetch the
       rectangle and this keeps the cells -- but the rectangle is one date's rows for teams that
       genuinely have a deck on it, not a week of everything. */
    const rows = await fetchAll(() => {
      let q = db.from('defaulter_snapshots').select(withBatchKeys(columns))
        .eq('snapshot_type', type).eq('snapshot_date', d).in('team', upperTeams([...g.teams]));
      const wds = [...g.weekdays].filter(Boolean);
      // Only when every resolved deck on this date names a weekday -- a null weekday is a real
      // stored value and an .in() list can never match it.
      if (wds.length === g.weekdays.size) q = q.in('weekday', wds);
      return q;
    });
    for (const r of rows) if (g.want.has(deckKey(r.team, r.weekday))) all.push(r);
  }
  /* TWO DIFFERENT DUPLICATES, TWO DIFFERENT FIXES, BOTH NEEDED.
     "Some customers were texted arrears when I exported the sms file ... yet she aint in the
     defaulters file" -- ANASTAZIA JUMBE NGOI, SINGIDA. Her team's deck had been corrected with
     a same-day re-upload that no longer named her (she was no longer a defaulter), but the one
     step this used to run -- pickLatestPerCustomer, straight over `all` -- resolves the winning
     row PER CUSTOMER: with nothing in the newer batch to compare her old row against, her old
     row just won by default, and she came back from the dead into every export and every
     screen. pickLatestBatchRows carries the correct rule instead -- an upload that stops naming
     somebody IS the correction, so the whole older batch loses, that customer included.

     But pickLatestBatchRows resolves its winner PER TEAM, and `all` can hold two different
     WEEKDAY decks of the same team that both happen to land on the same date in two different
     batches -- resolve across them undivided and one whole deck loses to the other's batch
     stamp, the exact fault `recByDay` further down this file already grouped by weekday to
     avoid, for the same reason. So: batch-resolve within each weekday first (fixes the
     resurrection), THEN pickLatestPerCustomer across the result (still needed -- see its own
     comment above -- for the separate, legitimate case of one customer genuinely sitting in
     two different weekdays' decks on the same date, who must still count once, not twice). */
  const perDeck = [...new Set(all.map(r => K(r.weekday)))]
    .flatMap(wd => pickLatestBatchRows(all.filter(r => K(r.weekday) === wd)));
  const rows = pickLatestPerCustomer(perDeck);
  const seen = [...byDate.keys()].sort();
  return { rows, date: seen[seen.length - 1] || null, dates: seen,
    weekdays: [...new Set(all.map(r => r.weekday).filter(Boolean))].sort(),
    batch: rows.length ? (rows[0].upload_batch || 'legacy') : null, perTeam: true };
}

/* HOW MUCH ONE CALL MAY PUT RIGHT.

   The repair used to run inside the upload's last slice and took it past the platform's sixty
   seconds -- "uploading now fails at 4/5 ... HTTP 504". Taking it off the upload fixed that and
   left a worse hole: the Settings button had already been removed, so the repair became
   reachable from NOWHERE, and every weekday whose deck had not been re-uploaded since stayed
   blanked with no way to correct it. Customers still invisible, and this time because of me.

   So it is its own request, and BOUNDED. A call fixes at most this many customers and says how
   many are left; the caller rings again until none are. Resumable beats fast here -- a repair
   that half-finishes and can be continued is worth more than one that must fit in a single
   window and fails whole when it does not. */
const FU_REPAIR_MAX = 2000;

/* =====================================================================================
   FIND ONE OFFICER, RATHER THAN SHIPPING EVERY OFFICER.

     "enable search officer by name/number while the live search shows name no and team so as
      to produce person reports., having the whole list on font end is tooo long"

   The Calls screen sent the whole roster to the browser twice over -- once as a dropdown of
   every user who made a call, and once as a table of every officer in the report -- and then
   asked somebody to find a name in it. On three hundred handsets that is a long page and a long
   payload to answer a question about one person.

   This answers it at the database instead: a prefix search on the name or the number, capped,
   returning the three things you need to recognise somebody -- name, number, team.

   SCOPED, and not as an afterthought. `onTeams` narrows to what the caller may already see, so
   the search cannot become a way of reading a roster somebody has no business reading. An
   ALL-teams user searches everybody, which is what ALL means.

   THE NUMBER IS SEARCHED AS DIGITS. Phones are stored normalised -- normPhone strips the
   leading zero and the country code -- so a person typing 0712... off a handset would find
   nothing if the typed string were matched literally. The last nine digits are the part that is
   always the same however it was written. */
const OFFICER_FIND_LIMIT = 25;

async function callOfficers(db, user, args) {
  const q = String((args && args.q) == null ? '' : args.q).trim();
  if (q.length < 2) return { q, rows: [], tooShort: true };
  const like = '%' + q.replace(/[%_\\]/g, m => '\\' + m) + '%';
  const digits = q.replace(/\D/g, '');
  const clauses = ['name.ilike.' + like];
  if (digits.length >= 3) clauses.push('phone.ilike.%' + digits.slice(-9) + '%');
  const rows = await fetchAll(() => onTeams(
    db.from('call_users').select('name, phone, team, role, active').or(clauses.join(',')),
    user.teams).limit(OFFICER_FIND_LIMIT));
  const out = scoped(user, rows)
    .filter(r => r.active !== false)
    .map(r => ({ name: r.name || '', phone: r.phone || '', team: r.team || '', role: r.role || '' }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { q, rows: out, capped: out.length >= OFFICER_FIND_LIMIT };
}

async function rebuildFollowup(db, user, args, nowMs) {
  requireAdmin(user);
  const cap = Math.max(1, Math.min(FU_REPAIR_MAX, parseInt(String((args && args.max) || FU_REPAIR_MAX), 10) || FU_REPAIR_MAX));
  const today = todayKey(nowMs);
  const [deck, have] = await Promise.all([
    defaulterBook(db, user, { type: 'current', notAfter: today, columns: 'ref, full_name, contact, guarantor_name, guarantor_contact, '
        + 'disb_date, last_trans_date, status, ds, dc, days_elapsed, other_inst, arrears, team, weekday' }),
    /* THREE COLUMNS, NOT ONE, and the two extra are the whole repair.
       Reading keys alone could only answer "is this customer in the register at all", so a
       customer who was PRESENT BUT BLANKED looked like nothing to do -- which is why rebuilding
       and re-uploading both reported success and changed nothing on the handsets. */
    fetchAll(() => db.from('followup_status').select('ref, status, arrears')),
  ]);
  const known = new Set((have || []).map(r => K(r.ref)));
  /* A BLANKED ROW IS A CUSTOMER THE PHONE CANNOT SEE.
     Retiring sets status and arrears to null and keeps everything else, and the Defaulters list
     skips exactly that shape. It is the right shape for somebody who has genuinely left the book
     -- and the wrong one for somebody the current deck still names, which is what the days:1
     housekeeping sweep produced by the thousand. */
  const blank = new Set((have || []).filter(r => r.status == null && r.arrears == null).map(r => K(r.ref)));
  const deckRows = deck.rows.filter(r => r.ref);
  const missing = deckRows.filter(r => !known.has(K(r.ref)));
  const blanked = deckRows.filter(r => known.has(K(r.ref)) && blank.has(K(r.ref)));
  if (!missing.length && !blanked.length) {
    return { deck: deck.rows.length, register: known.size, added: 0, restored: 0, remaining: 0,
      done: true, date: deck.date, weekdays: deck.weekdays,
      note: 'Kila mteja wa deki yupo kwenye rejista. / Every customer in the current deck is '
        + 'already in the follow-up register — the phone is seeing the same book as the portal.' };
  }
  /* Deck-derived fields ONLY. On a row that already exists this is an UPDATE of exactly these
     columns, so fu_status, the promise, the comment trail and who wrote it are not in the
     statement at all and cannot be touched. That is what makes restoring safe enough to be a
     button rather than a migration. */
  const shape = d => ({
    ref: String(d.ref), team: d.team || null, full_name: d.full_name || null,
    contact: d.contact || null,
    guarantor_name: d.guarantor_name || null, guarantor_contact: d.guarantor_contact || null,
    disb_date: d.disb_date || null, last_trans: d.last_trans_date || null,
    status: d.status || null, ds: d.ds || null, dc: d.dc == null ? null : d.dc,
    days_elapsed: d.days_elapsed == null ? null : d.days_elapsed,
    rejesho: d.other_inst == null ? null : d.other_inst,
    arrears: d.arrears == null ? null : d.arrears,
    updated_at: new Date(nowMs).toISOString(),
  });
  const write = async (list, ignoreDuplicates) => {
    let n = 0;
    for (let i = 0; i < list.length; i += FU_REPAIR_CHUNK) {
      const slice = list.slice(i, i + FU_REPAIR_CHUNK).map(shape);
      const { error } = await runQuery(() =>
        db.from('followup_status').upsert(slice, { onConflict: 'ref', ignoreDuplicates }), 2);
      if (error) throw new Error(error.message);
      n += slice.length;
    }
    return n;
  };
  /* ignoreDuplicates on the INSERTS so a ref that arrived between the read and the write is
     skipped rather than overwriting somebody's follow-up work. The RESTORES are the opposite by
     definition -- the row is known to be there and putting its figures back is the entire job --
     so they are written as a real update of the deck columns. */
  /* The cap is spent on what is MISSING first and what is BLANKED second, because a customer
     with no row at all is invisible to more of the system than one whose figures were cleared. */
  const doMissing = missing.slice(0, cap);
  const doBlanked = blanked.slice(0, Math.max(0, cap - doMissing.length));
  const remaining = (missing.length - doMissing.length) + (blanked.length - doBlanked.length);
  const added = await write(doMissing, true);
  const restored = await write(doBlanked, false);
  const parts = [];
  if (added) parts.push(`${added} customer(s) were in the current deck but missing from the `
    + 'follow-up register, so HOPE Calls could not show them at all.');
  if (restored) parts.push(`${restored} were in the register but BLANKED — their status and arrears `
    + 'had been cleared by a retirement sweep even though the current deck still names them, which '
    + 'is why they were on no phone. Their figures are back.');
  if (remaining) parts.push(`${remaining} still to go — run again to continue.`);
  return { deck: deck.rows.length, register: known.size, added, restored, remaining,
    done: !remaining, date: deck.date, weekdays: deck.weekdays,
    note: `Wamerudishwa ${added + restored}. / ` + parts.join(' ')
      + ' No follow-up status, promise or comment was changed.' };
}

async function findCustomer(db, user, args, nowMs) {
  const q = String((args && args.q) == null ? '' : args.q).trim();
  if (q.length < 3) throw badRequest('Andika angalau herufi 3. / Type at least 3 characters — a reference, a name, or a phone number.');
  const like = '%' + q.replace(/[%_\\]/g, m => '\\' + m) + '%';
  /* PHONE NUMBERS ARE STORED NORMALISED -- normPhone strips the leading zero and any country
     code, so 0746115063 is held as 746115063 and searching the typed string would find nothing.
     The last nine digits are the part that is always the same however it was written, which is
     exactly what normPhone leaves behind. Searched IN THE QUERY alongside the reference and the
     name, because a number somebody reads off a handset is the commonest way this screen is
     used and it must not be the one that quietly fails. */
  const digits = q.replace(/\D/g, '');
  const numLike = digits.length >= 7 ? '%' + digits.slice(-9) + '%' : null;
  const orClause = cols => cols.map(c => `${c}.ilike.${c === 'contact' || c === 'guarantor_contact' ? numLike : like}`).join(',');
  const searchCols = ['ref', 'full_name'].concat(numLike ? ['contact'] : []);

  const [defRows, expRows, fuRows] = await Promise.all([
    fetchAll(() => onTeams(db.from('defaulter_snapshots').select(FIND_COLS)
      .or(orClause(searchCols)).limit(FIND_LIMIT), user.teams)),
    fetchAll(() => onTeams(db.from('repayment_snapshots')
      .select('ref, full_name, contact, team, todays_status, due_summary, payment_expected, arrears, snapshot_type, snapshot_date, upload_batch, created_at')
      .or(orClause(searchCols)).limit(FIND_LIMIT), user.teams)),
    fetchAll(() => onTeams(db.from('followup_status')
      .select('ref, full_name, contact, team, status, ds, arrears, fu_status, updated_at')
      .or(orClause(searchCols)).limit(FIND_LIMIT), user.teams)),
  ]);

  const today = todayKey(nowMs), wdToday = currentWeekday(nowMs);
  const byNum = r => !!numLike && String(r.contact || '').includes(digits.slice(-9));
  const matches = rows => rows.filter(r =>
    K(r.ref).includes(K(q)) || K(r.full_name).includes(K(q)) || byNum(r));

  const decks = matches(defRows).map(r => ({
    where: 'Defaulter', ref: r.ref, name: r.full_name, team: r.team, contact: r.contact,
    guarantor_name: r.guarantor_name, guarantor_contact: r.guarantor_contact,
    date: r.snapshot_date, weekday: r.weekday, type: r.snapshot_type,
    batch: r.upload_batch || 'legacy', status: r.status, ds: r.ds, arrears: num(r.arrears),
    /* THE WHOLE POINT. Today's screens read today's weekday and the latest date -- so a row
       that is neither is present, correct, and unreachable. */
    onToday: String(r.weekday || '') === wdToday,
    dated: String(r.snapshot_date) === today,
    /* 'initial' shares its date with the SAME upload's 'current' row -- it is Monday's
       baseline, kept for the weekly comparison, not a second real sighting of the customer.
       Sorted after its own date's other rows so latestPerRef's dedupe below never keeps a
       stale baseline over the live figure just because the two happen to tie on date. */
    rank: r.snapshot_type === 'initial' ? 1 : 0,
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.rank - b.rank);

  const expected = matches(expRows).map(r => ({
    where: 'Expected', ref: r.ref, name: r.full_name, team: r.team, contact: r.contact,
    date: r.snapshot_date, type: r.snapshot_type, batch: r.upload_batch || 'legacy',
    status: r.todays_status, ds: r.due_summary, arrears: num(r.arrears),
    dated: String(r.snapshot_date) === today,
    rank: r.snapshot_type === 'initial' ? 1 : 0,
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.rank - b.rank);

  const follow = matches(fuRows).map(r => ({
    where: 'Follow-up register', ref: r.ref, name: r.full_name, team: r.team,
    status: r.status, ds: r.ds, arrears: num(r.arrears), fu: r.fu_status, updated: r.updated_at,
    /* READ OFF THE RAW ROW, because `num` turns a null arrears into 0 and 0 is a real figure.
       Blanked means the columns are ABSENT, not zero -- that distinction is the entire signal,
       and computing it from the mapped value quietly reported every blanked customer as live. */
    blank: r.status == null && r.arrears == null,
  }));

  /* THE VERDICT, IN WORDS. A list of rows still leaves somebody to work out for themselves why
     a screen is empty; this says it. */
  const notes = [];
  const total = decks.length + expected.length + follow.length;
  if (!total) {
    notes.push('Hakuna popote. / Not found anywhere — this customer is not in any deck or '
      + 'register you can see. If they are in the file, the upload did not land: check the '
      + 'upload page for the day, and that their TEAM exists in Teams & Staff.');
  } else {
    /* =====================================================================================
       THIS VERDICT HAD GONE STALE, WHICH IS WORSE THAN HAVING NONE.

       It was written against rules that have since been fixed, and it was still handing them
       out as instructions. It told you a customer filed under Thursday is invisible today and
       to re-upload their team's deck under today's weekday -- which is exactly the thing the
       owner said should never be necessary:

         "defaulters have no day ... not that i have to upload saturady report today to see the
          defaulter"

       And it pointed at "Settings -> Rebuild follow-up register", a button that no longer
       exists. A screen whose whole job is to explain an empty list must not send somebody after
       a fault that was fixed weeks ago. What follows is the CURRENT set of reasons.
       ===================================================================================== */
    const wdays = [...new Set(decks.map(d => d.weekday).filter(Boolean))];
    if (decks.length && !decks.some(d => d.onToday)) {
      notes.push(`Yupo kwenye deki ya ${wdays.join(', ')} \u2014 hiyo ni sawa kabisa.`
        + ` / They are in the deck under weekday ${wdays.join(', ')}, and today is ${wdToday}. `
        + 'THAT IS NORMAL AND IS NOT THE PROBLEM: a defaulter is a defaulter every day, and every '
        + "weekday's deck is read at its own date. The weekday only pairs an initial against a "
        + 'current for recovery. Do NOT re-upload their deck under today to "fix" this.');
    }
    /* The date only matters now if it has fallen out of the look-back window entirely -- it is
       resolved per team AND per weekday, so a deck older than somebody else's is read exactly
       as it stands rather than being hidden by their newer upload. */
    const newestDeck = decks.length ? String(decks[0].date) : '';
    const windowFrom = addDaysKey(today, -DECK_LOOKBACK_DAYS);
    if (newestDeck && newestDeck < windowFrom) {
      notes.push(`Deki yao ya mwisho ni ya ${newestDeck} \u2014 zaidi ya siku ${DECK_LOOKBACK_DAYS}.`
        + ` / Their newest deck row is dated ${newestDeck}, more than ${DECK_LOOKBACK_DAYS} days `
        + `old (the window starts at ${windowFrom}). That is the one date rule that still hides `
        + "somebody: their weekday's deck has not been uploaded in over six weeks. Upload it.");
    }
    /* THE PHONE'S OWN ANSWER. HOPE Calls builds its Defaulters list from the register, not the
       deck, so somebody in one and not the other is on every portal screen and no handset --
       with each half individually correct and nothing to say so. */
    if (decks.length && !follow.length) {
      notes.push('Yupo kwenye deki lakini HAYUPO kwenye rejista ya ufuatiliaji.'
        + ' / They are in the defaulter deck but NOT in the follow-up register. HOPE Calls builds '
        + 'its Defaulters list from the register, so no handset can show them even though every '
        + "portal screen can. The next upload of THEIR weekday's deck puts them in automatically "
        + '\u2014 no button, nothing to press.');
    }
    /* BLANKED IS NOT THE SAME AS MISSING, and it is the shape that cost the most time. Retiring
       sets status and arrears to null and keeps the row, and the phone skips exactly that. The
       register search below would list such a row like any other, so it has to be called out by
       name or this screen quietly says "she is in the register" and leaves it there. */
    const blanked = follow.filter(f => f.blank);
    if (decks.length && blanked.length && blanked.length === follow.length) {
      notes.push('Yupo kwenye rejista lakini takwimu zake ni tupu (hali na deni).'
        + ' / They ARE in the follow-up register, but BLANKED: status and arrears are both empty. '
        + 'HOPE Calls skips exactly that shape, so they are on no handset while looking perfectly '
        + "present here. The next upload of their weekday's deck restores the figures "
        + 'automatically.');
    }
    if (decks.length && follow.length && !blanked.length) {
      notes.push('Yupo kwenye deki na kwenye rejista. / They are in the defaulter deck and in the '
        + 'follow-up register with live figures, so the portal screens and HOPE Calls should both '
        + "show them. If one particular screen does not, it is that screen's own filter \u2014 "
        + 'status, count 1-6, the role narrowing, or the team scope of the code you signed in with.');
    }
  }

  /* "results should show of latest uploaded labeled [expected or default] file only and not
     transactions or whatever" -- decks/expected above are every matching snapshot row, which is
     a customer's whole upload HISTORY, not a result list. The verdicts above still read that
     full history (a note about which weekday they last appeared under needs every row); what
     goes back to the screen is one row per ref, the latest upload only -- and the follow-up
     register does not go back at all, because it is not a separate FILE a customer was in, it
     is the running commentary on the same customer already named above. Its comments are not
     lost: openFollowup's own drawer reads them by ref the moment a result row is opened. */
  /* NOT `new Map(rows.map(r => [r.ref, r]))` -- a Map built from repeated keys keeps the LAST
     value set, not the first, which would have quietly kept the OLDEST row instead of the
     newest despite rows already being sorted newest-first. */
  const latestPerRef = rows => {
    const seen = new Set(), out = [];
    for (const r of rows) { if (seen.has(r.ref)) continue; seen.add(r.ref); out.push(r); }
    return out;
  };
  const decksOut = latestPerRef(decks), expectedOut = latestPerRef(expected);

  return { q, today, weekdayToday: wdToday, decks: decksOut, expected: expectedOut,
    count: decksOut.length + expectedOut.length, notes,
    teams: [...new Set([...decksOut, ...expectedOut].map(r => r.team).filter(Boolean))] };
}

async function defaulters(db, user, { type = 'current', weekday, date }, nowMs) {
  const wd = weekday || currentWeekday(nowMs);
  /* Team-scoped at the database, same reasoning as Expected above. Columns are deliberately
     NOT narrowed here: the Defaulters tab renders a wide row and the Exp.Def rotation reads
     this same shape, so a hard-coded list is the failure that once put customer rows on
     officers' phones with no name and nothing to tap. Fewer rows is the safe half of the win
     and it is the larger half. */
  /* A DEFAULTER IS A DEFAULTER EVERY DAY. The tab still has its weekday buttons -- pressing one
     asks for that deck and gets exactly it -- but the DEFAULT is every deck, one row per
     customer. Pinned to today's weekday, somebody whose deck was filed under Tuesday was
     missing from this list on Monday with nothing to say so. */
  const pickedWd = weekday ? wd : null;
  const snap = pickedWd
    ? await latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: type, weekday: pickedWd },
        date ? { onDate: date, teams: user.teams } : { notAfter: todayKey(nowMs), teams: user.teams })
    : await defaulterBook(db, user, date
        ? { type, onDate: date }
        : { type, notAfter: todayKey(nowMs) });
  const rows = scoped(user, snap.rows);
  return { type, weekday: wd, date: snap.date, rows, count: rows.length,
    arrears: rows.reduce((s, r) => s + num(r.arrears), 0) };
}

/** Expected Defaulters -- the WEEKLY CYCLE, not a one-day list. Every defaulter is visited
    twice a week and the two days are derived from the loan itself: the weekday it was
    disbursed on (Day 1) and three days later (Day 2), with Sunday rolled onto Monday because
    nobody works Sunday. That is why the tab is a Mon-Sat set of day tabs with a distribution
    across them -- a customer appears under two of the six.

    Each row also carries the recycling leader who currently owns the customer, because the
    officer working this list needs to know who else is already on them. */
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function rollSun(u) { return u === 7 ? 1 : u; }        // Sunday -> Monday
async function expectedDefaulters(db, user, _args, nowMs) {
  const [def, teamRows, strat] = await Promise.all([
    defaulterBook(db, user, { type: 'current', notAfter: todayKey(nowMs) }),
    readTeamsAll(db),
    assignStrategy(db),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const rows = scoped(user, def.rows)
    .filter(d => { const s = K(d.status); return s.includes('CHRON') || s.includes('EXPIR') || s.includes('DEFAULT'); })
    .map(d => {
      const raw = d.disb_date ? isoWeekday(Date.parse(String(d.disb_date) + 'T00:00:00Z')) : 0;
      const primary = raw ? rollSun(raw) : 0;
      const secondary = primary ? rollSun(((primary - 1 + 3) % 7) + 1) : 0;
      const a = assignFor(d, strat, nowMs);
      const s = K(d.status);
      const team = teamBy[K(d.team)] || {};
      return { ref: d.ref, full_name: d.full_name, contact: d.contact, team: d.team,
        arrears: num(d.arrears), balance: num(d.balance), ds: d.ds, dc: d.dc,
        status: s.includes('CHRON') ? 'CHRONIC' : (s.includes('EXPIR') ? 'EXPIRED' : 'DEFAULTER'),
        disb_date: d.disb_date,
        primary, secondary,
        primaryName: DAY_NAMES[primary] || '—', secondaryName: DAY_NAMES[secondary] || '—',
        phase: a.phase, role: a.role, cycle: a.label,
        leader: team[ROLE_COLS[a.role]] || '(unassigned)' };
    });
  // Each customer counts on BOTH of their days, so the distribution sums to 2x the headcount.
  // Day 0 holds anyone whose loan carries no disbursement date: they cannot be placed on a
  // weekday, and the live system simply dropped them from the cycle. Silently losing a
  // defaulter is the one outcome this tab must never produce, so they get their own bucket
  // and their own tab instead of disappearing.
  const dist = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const r of rows) {
    if (!r.primary) { dist[0]++; continue; }
    dist[r.primary]++;
    if (dist[r.secondary] != null) dist[r.secondary]++;
  }
  /* ================================================================================
     "Manager bike and gm should see their own list at expdef so as to work on their
     report too."

     The phone has had this since the rotation went in -- expdfMine defaults a recycling
     leader to their OWN customers and lets them switch out to the team's. The system did
     not: it handed a GMO the whole scoped book, forty teams deep, with their own name
     merely one option inside a dropdown they had to go and find. Their list was present
     and unfindable, which for a leader working a rotation is the same as absent.

     So the screen is told two things and decides for itself: who is signed in, and
     whether the teams table names them as a recycling leader anywhere. The narrowing is
     deliberately NOT done here -- the client already holds every row and recomputes the
     KPIs, the weekly distribution and the day pills from whichever list is showing, so
     the toggle costs no round trip and the whole screen agrees with itself either way.

     `iAmLeader` is asked of the teams table, not of the login role, exactly as
     isRecycleLeader does for the phone: holding a gmo/manager/bike column ANYWHERE is
     what gives somebody a rotation list, and moving them between teams re-points it with
     no other change. */
  const me = K(user && user.name);
  return { rows, count: rows.length, dist, dayNames: DAY_NAMES,
    me: user && user.name ? String(user.name).trim() : '',
    iAmLeader: !!me && teamRows.some(t => K(t.gmo) === me || K(t.manager) === me || K(t.bike) === me),
    unplaced: dist[0],
    todayIndex: rollSun(isoWeekday(nowMs)),
    teams: [...new Set(rows.map(r => r.team).filter(Boolean))].sort(),
    chronic: rows.filter(r => r.status === 'CHRONIC').length,
    expired: rows.filter(r => r.status === 'EXPIRED').length,
    arrears: rows.reduce((s, r) => s + r.arrears, 0) };
}

/* ------------------------------------------------------------------ followup + comments */
/* THE TAB RECOVERY OFFICERS LIVE IN ALL DAY.

   It was rendering twelve of its columns and carrying the rest silently: the guarantor and
   their number, the disbursement and last-transaction dates, days-in-cycle, and the last
   comment were all being fetched and then thrown away by the screen. An officer whose customer
   will not answer rings the guarantor -- and had to open a second tab to find the number.

   Two fields are not in followup_status and are assembled here:

   NEW NUMBER -- when a customer's number is dead, the officer logs a replacement against the
   follow-up. It lives on the comment, so the newest one per customer is carried up to the row.

   RECOVERED -- what has actually come back off this customer since the baseline. The rule
   already exists in expdf.js (today's own INITIAL deck, and zero rather than a fabricated
   number when that customer is not in it), so the same baseline is used here rather than a
   second, differently-computed truth appearing on a second screen. */
async function followup(db, user, args = {}, nowMs = Date.now()) {
  const today = todayKey(nowMs);
  const teamBranch = await branchByTeam(db, nowMs);
  const [raw, comments, iniSnap] = await Promise.all([
    fetchAll(() => onTeams(db.from('followup_status').select('*').order('arrears', { ascending: false }), user.teams)),
    /* Only the comments that CARRY a replacement number. This was reading every comment ever
       written -- sixty thousand rows on a real book -- to find the few hundred that have one.
       Two clauses do the same job at the database: not null, and not empty. */
    fetchAll(() => onTeams(db.from('followup_comments').select('ref, new_number, created_at')
      .not('new_number', 'is', null).neq('new_number', ''), user.teams)),
    defaulterBook(db, user, { type: 'initial', notAfter: today, teams: user.teams }),
  ]);
  const rows = scoped(user, raw);

  // Newest replacement number per customer.
  const newNo = {};
  for (const c of comments) {
    const n = String(c.new_number == null ? '' : c.new_number).trim();
    if (!n) continue;
    const k = String(c.ref);
    const at = String(c.created_at || '');
    if (!newNo[k] || at > newNo[k].at) newNo[k] = { at, n };
  }
  const baseBy = {};
  for (const d of iniSnap.rows) baseBy[String(d.ref).trim().toUpperCase()] = num(d.arrears);

  // Pure FK stubs (created so an Expected customer's comment can be stored) are not defaulters.
  const real = rows.filter(r => !(r.status == null && r.arrears == null)).map(r => {
    const arrears = num(r.arrears);
    const key = String(r.ref == null ? '' : r.ref).trim().toUpperCase();
    const initial = Object.prototype.hasOwnProperty.call(baseBy, key) ? baseBy[key] : arrears;
    return {
      ...r,
      branch: teamBranch.get(K(r.team)) || null,
      /* A defaulter who has paid says so, here as on the phone: zero or negative arrears
         with no status left officers ringing people whose debt is gone. Only the balance
         itself proves it -- a null arrears is unknown, never "paid". */
      status: (r.arrears != null && arrears <= 0) ? 'PAID' : r.status,
      new_no: (newNo[String(r.ref)] || {}).n || null,
      initial,
      recovered: Math.max(0, initial - arrears),
      // The month of the last transaction, so the screen can offer "any month" as a filter
      // without every browser having to work the same thing out from a date string.
      last_trans_month: String(r.last_trans || '').slice(0, 7) || null,
    };
  });
  return {
    rows: real, count: real.length,
    arrears: real.reduce((s, r) => s + num(r.arrears), 0),
    recovered: real.reduce((s, r) => s + num(r.recovered), 0),
    // Newest first, so the month someone actually wants is at the top of the list.
    months: [...new Set(real.map(r => r.last_trans_month).filter(Boolean))].sort().reverse(),
  };
}

async function comments(db, user, { ref }) {
  if (!ref) throw badRequest('ref is required');
  const { data: st } = await db.from('followup_status').select('team').eq('ref', String(ref)).maybeSingle();
  if (st && !teamAllowed(user, st.team)) throw forbidden(`You do not have access to team ${st.team}.`);
  /* The columns this drawer draws, newest first, capped -- the same reasoning as the phone's
     copy in call-core.js. A customer with an imported history has hundreds of notes.

     THEIR COMPLAINTS RIDE ALONG. "Show registered complaints on ... customer followup
     statuses list" -- an officer about to ring somebody needs to know the customer has an
     open complaint BEFORE the call, not after filing another one. One keyed read on a
     drawer that is already two reads deep; allowed to fail quietly, because a history that
     stops loading over its side-dish is a worse history. */
  const [{ data, error }, compRes] = await Promise.all([
    db.from('followup_comments')
      .select('comment, fu_status, promise_date, promise_amt, new_number, created_by, created_at')
      .eq('ref', String(ref)).order('created_at', { ascending: false }).limit(200),
    runQuery(() => db.from('complaints')
      .select('complainant, category, details, status, resolution, created_at')
      .eq('ref', String(ref)).order('created_at', { ascending: false }).limit(20)),
  ]);
  if (error) throw new Error(error.message);
  return { rows: data || [],
    complaints: (compRes && !compRes.error && compRes.data) ? compRes.data : [] };
}

const FU_NEED_DATE = ['AMETOA AHADI'];
const FU_NEED_COMMENT = ['AMETUMA KWA AFISA', 'REJESHO LIMELIWA', 'OTHERS'];
const FU_NEED_NUMBER = ['ANA NAMBA NYINGINE'];

async function addComment(db, user, p, nowMs) {
  const ref = String((p && p.ref) || '').trim();
  if (!ref) throw badRequest('ref is required');
  const { data: st } = await db.from('followup_status').select('team').eq('ref', ref).maybeSingle();
  if (st && !teamAllowed(user, st.team)) throw forbidden(`You do not have access to team ${st.team}.`);
  const fu = p.fuStatus || p.fu || '';
  // Same three rules as the calls app and Code.gs -- enforced server-side, not just in the UI.
  if (FU_NEED_DATE.includes(fu) && !p.promiseDate) throw badRequest('A promise date is required for "Ametoa Ahadi".');
  if (FU_NEED_COMMENT.includes(fu) && !p.comment) throw badRequest('A comment is required for that follow-up status.');
  if (FU_NEED_NUMBER.includes(fu) && !p.newNumber) throw badRequest('A new phone number is required for "Ana namba nyingine".');
  const now = new Date(nowMs).toISOString();
  await db.from('followup_status').upsert({ ref, team: p.team || null, full_name: p.fullName || null }, { onConflict: 'ref', ignoreDuplicates: true });
  const { error: cErr } = await db.from('followup_comments').insert({
    ref, docket_no: p.docketNo || null, team: p.team || null, full_name: p.fullName || null,
    comment: p.comment || null, fu_status: fu || null, promise_date: p.promiseDate || null,
    promise_amt: p.promiseAmt || null, new_number: p.newNumber || null, created_by: user.name, created_at: now,
  });
  if (cErr) throw new Error(cErr.message);
  /* A COMMENT WITHOUT A STATUS KEEPS THE STATUS -- the same rule the calls app's addComment
     applies, fixed in both places at once: writing fu_status: fu || null meant a bare comment
     ERASED the chip a card was wearing on the phone's Expected/Def lists, so the next officer
     saw nothing, assumed nobody had touched the customer, and rang them again. Only a chosen
     status replaces the status (and its promise fields, which belong to it). */
  const patch = { last_comment: p.comment || null, comment_by: user.name, comment_at: now, updated_at: now };
  if (fu) {
    patch.fu_status = fu;
    patch.promise_date = p.promiseDate || null;
    patch.promise_amt = p.promiseAmt || null;
  }
  const { error: uErr } = await db.from('followup_status').update(patch).eq('ref', ref);
  if (uErr) throw new Error(uErr.message);
  /* Recording a replacement number moves the calls app's phone index (see call-core's
     addComment for the full story): the officer dials the new number within the minute, and
     an index cached before this comment would stamp that call non-portfolio for good. Quiet
     on failure -- the comment is saved, and a missed stamp only widens a cache window. */
  if (p.newNumber) {
    await runQuery(() => db.from('settings')
      .upsert({ key: 'NEW_NUMBER_VERSION', value: String(nowMs) }, { onConflict: 'key' }));
  }
  return { ref, savedAt: now };
}

/** Promise to Pay: everyone who said AMETOA AHADI, bucketed against today so overdue
    promises surface first -- the whole point of the tab. */
/** Promise to Pay. A promise is only worth anything if you can see whether it was KEPT, so
    each row carries the arrears the customer had when they promised beside what they owe now
    -- and a customer who has left the defaulter deck entirely reads CLEARED rather than 0. */
async function promises(db, user, { from, to } = {}, nowMs) {
  const today = todayKey(nowMs);
  const teamBranch = await branchByTeam(db, nowMs);
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : null;
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : null;
  const [all, cm, curSnap] = await Promise.all([
    fetchAll(() => onTeams(db.from('followup_status').select('*').eq('fu_status', 'AMETOA AHADI'), user.teams)),
    /* Every promise ever made was being read to show the ones in a chosen window. Narrowed to
       the caller's teams and to the window itself -- the comment that CREATED a promise is
       what this needs, and one made two years ago cannot have created a promise due this
       week. A generous margin before the window keeps the creating comment in view. */
    fetchAll(() => onTeams(db.from('followup_comments')
      .select('ref, team, fu_status, promise_date, promise_amt, comment, created_by, created_at')
      .eq('fu_status', 'AMETOA AHADI')
      .gte('created_at', addDaysKey(fromKey || todayKey(nowMs), -120)), user.teams)),
    defaulterBook(db, user, { type: 'current', notAfter: today }),
  ]);
  const stillOwing = {};
  for (const d of curSnap.rows) stillOwing[K(d.ref)] = num(d.arrears);
  // The comment that CREATED the promise is where "arrears before" and "who took it" live.
  const firstCm = {};
  for (const c of cm.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!firstCm[K(c.ref)]) firstCm[K(c.ref)] = c;
  }
  const rows = scoped(user, all).map(r => {
    const k = K(r.ref);
    const cleared = !Object.prototype.hasOwnProperty.call(stillOwing, k);
    const curArr = cleared ? 0 : stillOwing[k];
    const arrBefore = num(r.arrears);
    return { ...r,
      branch: teamBranch.get(K(r.team)) || null,
      arrears_before: arrBefore, arrears_now: curArr, cleared,
      recovered: Math.max(0, arrBefore - curArr),
      taken_by: (firstCm[k] && firstCm[k].created_by) || r.comment_by || null,
      taken_at: (firstCm[k] && firstCm[k].created_at) || r.comment_at || null,
      bucket: !r.promise_date ? 'no date' : String(r.promise_date) < today ? 'overdue'
        : String(r.promise_date) === today ? 'today' : 'upcoming' };
  }).filter(r => {
    if (fromKey && !(r.promise_date && String(r.promise_date) >= fromKey)) return false;
    if (toKey && !(r.promise_date && String(r.promise_date) <= toKey)) return false;
    return true;
  });
  const order = { overdue: 0, today: 1, upcoming: 2, 'no date': 3 };
  rows.sort((a, b) => (order[a.bucket] - order[b.bucket]) || String(a.promise_date || '').localeCompare(String(b.promise_date || '')));
  const counts = { overdue: 0, today: 0, upcoming: 0, 'no date': 0 };
  for (const r of rows) counts[r.bucket]++;
  return { rows, count: rows.length, counts, from: fromKey, to: toKey,
    cleared: rows.filter(r => r.cleared).length,
    recovered: rows.reduce((s, r) => s + r.recovered, 0),
    teams: [...new Set(rows.map(r => r.team).filter(Boolean))].sort(),
    promised: rows.reduce((s, r) => s + num(r.promise_amt), 0) };
}

/** Followup Report: who logged what, and what is still untouched. Counts by follow-up
    status and by officer over the comment history in the window. */
async function followupReport(db, user, { from, to }, nowMs) {
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : addDaysKey(todayKey(nowMs), -7);
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : todayKey(nowMs);
  const [fu, cm] = await Promise.all([
    fetchAll(() => onTeams(db.from('followup_status')
      .select('ref, team, full_name, status, arrears, fu_status'), user.teams)),
    fetchAll(() => onTeams(db.from('followup_comments')
      .select('ref, team, fu_status, comment, created_by, created_at')
      .gte('created_at', fromKey).lte('created_at', toKey + 'T23:59:59.999Z'), user.teams)),
  ]);
  const mineFu = scoped(user, fu).filter(r => !(r.status == null && r.arrears == null));
  const mineCm = scoped(user, cm);
  /* "Kwa hali / By follow-up status - should pick all 3 defaulter categories (defaulters
      expired and chronic) the whole Followup Report"

     It always counted all three -- this read is the whole followup_status table and never
     filtered on category -- but it could not SHOW that it did, so a board that looked short
     was indistinguishable from a board that was missing two thirds of the book. Splitting the
     count three ways answers the question directly, and if expired and chronic come back as
     zeroes that is a gap in the uploads made visible rather than hidden inside one total. */
  const catOf = v => {
    const k = K(v);
    return k.includes('CHRON') ? 'chronic' : k.includes('EXPIR') ? 'expired' : 'defaulters';
  };
  const teamBranch = await branchByTeam(db);
  const byStatus = {}, byOfficer = {}, byTeam = {};
  for (const r of mineFu) {
    const k = K(r.fu_status) || '(NOT TOUCHED)';
    if (!byStatus[k]) byStatus[k] = { status: k, customers: 0, arrears: 0, defaulters: 0, expired: 0, chronic: 0 };
    byStatus[k].customers++; byStatus[k].arrears += num(r.arrears);
    byStatus[k][catOf(r.status)]++;
    const t = r.team || '(no team)';
    if (!byTeam[t]) byTeam[t] = { team: t, branch: teamBranch.get(K(t)) || null, customers: 0, touched: 0, arrears: 0 };
    byTeam[t].customers++; byTeam[t].arrears += num(r.arrears);
    if (r.fu_status) byTeam[t].touched++;
  }
  for (const c of mineCm) {
    const who = c.created_by || '(unknown)';
    if (!byOfficer[who]) byOfficer[who] = { officer: who, comments: 0, customers: {} };
    byOfficer[who].comments++; byOfficer[who].customers[String(c.ref)] = 1;
  }
  // The report the supervisor actually reads is a MATRIX: one row per officer, one column per
  // follow-up status, so "who is logging what" is answerable at a glance instead of by
  // cross-referencing two summary tables. And under it, every individual follow-up -- the log
  // is the evidence; the counts above are only the index into it.
  const statuses = [...new Set(mineCm.map(c => K(c.fu_status)).filter(Boolean))].sort();
  const matrix = {};
  for (const c of mineCm) {
    const who = c.created_by || '(unknown)';
    const b = bucket(matrix, who, { total: 0, by: {} });
    b.total++;
    const st = K(c.fu_status) || '—';
    b.by[st] = (b.by[st] || 0) + 1;
  }
  const byOfficerStatus = Object.values(matrix)
    .map(b => ({ officer: b.key, total: b.total, ...Object.fromEntries(statuses.map(s => [s, b.by[s] || 0])) }))
    .sort((a, b) => b.total - a.total);

  const log = mineCm.slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(c => ({ at: c.created_at, by: c.created_by || '(unknown)', team: c.team,
      branch: teamBranch.get(K(c.team)) || null, ref: c.ref,
      full_name: c.full_name, fu_status: c.fu_status, promise_date: c.promise_date,
      promise_amt: num(c.promise_amt), comment: c.comment }));

  return {
    from: fromKey, to: toKey,
    byStatus: Object.values(byStatus).sort((a, b) => b.customers - a.customers),
    byTeam: Object.values(byTeam).sort((a, b) => a.team.localeCompare(b.team)),
    byOfficer: Object.values(byOfficer).map(o => ({ officer: o.officer, comments: o.comments, customers: Object.keys(o.customers).length }))
      .sort((a, b) => b.comments - a.comments),
    statuses, byOfficerStatus, rows: log,
    officers: [...new Set(log.map(r => r.by))].sort(),
    teams: [...new Set(log.map(r => r.team).filter(Boolean))].sort(),
    totals: { customers: mineFu.length, touched: mineFu.filter(r => r.fu_status).length, comments: mineCm.length,
      // The same three-way split across the whole report, so the board's columns have a total
      // to reconcile against.
      defaulters: mineFu.filter(r => catOf(r.status) === 'defaulters').length,
      expired: mineFu.filter(r => catOf(r.status) === 'expired').length,
      chronic: mineFu.filter(r => catOf(r.status) === 'chronic').length },
  };
}

/* ------------------------------------------------------------------ operational registers */
/* SCOPED AT THE DATABASE, not after the fact.

   This is the shared reader behind Abnormal Payments, Restructures and Demand Notices, and it
   pulled EVERY row of the table across the wire and then threw away the ones the signed-in
   person may not see. An officer holding one team downloaded all forty and kept a fortieth --
   the same mistake, on tables that only ever grow, that once turned 0.147 GB of data into
   81 GB of transfer in a month.

   The filter is EXACTLY what scoped() would have applied. teamAllowed() returns false for a
   row with no team once a user is scoped to any team at all, so an `in` filter keeps precisely
   the same rows -- it just no longer fetches the rest first. scoped() still runs afterwards,
   deliberately: it stays the single definition of who may see what, and this is only an
   optimisation of how much has to travel to reach the same answer. An ALL-teams user (teams
   null) is unfiltered, as they always were. */
async function listTable(db, user, table, order = 'created_at') {
  const rows = await fetchAll(() => {
    let q = db.from(table).select('*').order(order, { ascending: false });
    if (user && user.teams && user.teams.length) q = q.in('team', upperTeams(user.teams));
    return q;
  });
  const mine = scoped(user, rows);
  return { rows: mine, count: mine.length };
}

/** The complaint register is an accountability record, so it is date-ranged like the rest of
    the registers and carries its own controlled vocabularies -- a free-text category column
    cannot be counted, and counting complaints by category is the entire point of keeping one. */
const CX_CATEGORIES = ['Malipo / Payment', 'Riba / Interest', 'Mtaji / Principal', 'Afisa / Officer conduct',
  'Muda / Turnaround', 'Simu / Phone or app', 'Nyingine / Other'];
const CX_CHANNELS = ['Simu / Call', 'Ujumbe / SMS', 'WhatsApp', 'Ana kwa ana / Walk-in', 'Kiongozi / Via leader'];
const CX_STATUSES = ['Open', 'In progress', 'Resolved'];
const cxOpen = s => K(s) !== 'CLOSED' && K(s) !== 'RESOLVED';

async function complaints(db, user, { from, to } = {}, nowMs) {
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : addDaysKey(todayKey(nowMs), -30);
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : todayKey(nowMs);
  /* SCOPED AND WINDOWED AT THE DATABASE. This read every complaint ever logged and then threw
     away everything outside a thirty-day window and everything outside the viewer's teams --
     two filters the query could have applied, on a table that only ever grows. The JS filter
     stays as the single definition of the window; it now just has far less to reject. */
  const all = await fetchAll(() => onTeams(db.from('complaints').select('*')
    .gte('created_at', fromKey).lte('created_at', toKey + 'T23:59:59.999Z')
    .order('created_at', { ascending: false }), user.teams));
  const teamRows = await readTeamsAll(db, nowMs);
  const teamBranch = new Map(teamRows.map(t => [K(t.team), t.branch || null]));
  const rows = scoped(user, all).filter(r => {
    const d = dayOf(r.created_at);
    return d >= fromKey && d <= toKey;
  }).map(r => ({ ...r, branch: teamBranch.get(K(r.team)) || null }));
  const today = todayKey(nowMs);
  return { rows, count: rows.length, from: fromKey, to: toKey,
    open: rows.filter(r => cxOpen(r.status)).length,
    resolved: rows.filter(r => !cxOpen(r.status)).length,
    loggedToday: rows.filter(r => dayOf(r.created_at) === today).length,
    categories: CX_CATEGORIES, channels: CX_CHANNELS, statuses: CX_STATUSES,
    teams: teamRows.map(t => t.team).filter(t => teamAllowed(user, t)).sort() };
}

/** One saver for both new and existing complaints -- v1 let you correct any field afterwards,
    and a register you cannot correct gets worked around on paper instead. Every save writes a
    complaint_log row: the table existed from the start but nothing wrote to it, so the "who
    changed this, and when" question the register exists to answer had no data behind it. */
async function saveComplaint(db, user, p, nowMs) {
  if (!p || !String(p.complainant || '').trim()) throw badRequest('A complainant name is required.');
  if (p.team && !teamAllowed(user, p.team)) throw forbidden(`You do not have access to team ${p.team}.`);
  const at = new Date(nowMs).toISOString();
  const status = CX_STATUSES.includes(p.status) ? p.status : 'Open';
  const fields = {
    ref: p.ref || null, team: p.team || null, complainant: String(p.complainant).trim(),
    phone: p.phone || null, category: p.category || null, channel: p.channel || null,
    details: p.details || null, resolution: p.resolution || null, status,
  };
  let id = p.id || null, action;
  if (id) {
    const { data: prev } = await db.from('complaints').select('*').eq('id', id).maybeSingle();
    if (!prev) throw badRequest('That complaint no longer exists.');
    if (!teamAllowed(user, prev.team)) throw forbidden(`You do not have access to team ${prev.team}.`);
    // Resolving is a distinct event from editing, and stamps who closed it.
    if (!cxOpen(status) && cxOpen(prev.status)) { fields.resolved_by = user.name; fields.resolved_at = at; }
    const { error } = await db.from('complaints').update(fields).eq('id', id);
    if (error) throw new Error(error.message);
    action = cxOpen(prev.status) && !cxOpen(status) ? 'resolved' : 'edited';
  } else {
    // created_at carries both the date and the time it came in. Back-dating a complaint should
    // move the date; registering one today must NOT throw away the time of day, which stamping
    // midnight did -- it also silently reordered the register against same-day entries.
    const stamp = (p.date && p.date !== todayKey(nowMs)) ? p.date + 'T12:00:00Z' : at;
    const { data, error } = await db.from('complaints').insert({
      ...fields, logged_by: user.name, created_at: stamp,
    }).select('*');
    if (error) throw new Error(error.message);
    id = data && data[0] && data[0].id;
    action = 'registered';
  }
  const { error: lErr } = await db.from('complaint_log').insert({
    complaint_id: id, team: fields.team, action, status,
    note: fields.resolution || fields.details || null, created_by: user.name, created_at: at,
  });
  if (lErr) throw new Error(lErr.message);
  return { id, action };
}
async function complaintLog(db, user, { id }) {
  if (!id) throw badRequest('id is required');
  const { data: cx } = await db.from('complaints').select('team').eq('id', id).maybeSingle();
  if (cx && !teamAllowed(user, cx.team)) throw forbidden(`You do not have access to team ${cx.team}.`);
  const rows = await fetchAll(() => db.from('complaint_log').select('*')
    .eq('complaint_id', id).order('created_at', { ascending: false }));
  return { rows, count: rows.length };
}
// Kept so an older cached page still resolves a complaint instead of erroring.
async function resolveComplaint(db, user, p, nowMs) {
  if (!p || !p.id) throw badRequest('id is required');
  const { data: prev } = await db.from('complaints').select('*').eq('id', p.id).maybeSingle();
  if (!prev) throw badRequest('That complaint no longer exists.');
  return saveComplaint(db, user, { ...prev, id: p.id, status: p.status || 'Resolved',
    resolution: p.resolution || null }, nowMs);
}
const addComplaint = saveComplaint;

/** Loan restructuring. A restructure is a written offer: the customer pays something now, and
    whatever is left -- optionally with fresh interest -- is rescheduled into N weekly
    installments. Every number is derived, so NONE of it is taken from the client:

      remaining = arrears − first payment
      interest  = remaining × RESTRUCTURE_INTEREST_PCT (only if applied)
      total     = remaining + interest
      per       = total ÷ count, rounded to the nearest 500 (the note sizes people actually pay)

    The last installment absorbs the rounding so the schedule adds up to the total exactly.
    Only defaulters who have missed RESTRUCTURE_MIN_DC installments qualify -- restructuring
    someone who missed one payment just discounts the loan. */
const RX_ROUND = 500;
async function restructureStrategy(db) {
  const months = Math.max(1, await settingNum(db, 'RESTRUCTURE_MAX_MONTHS', 4));
  const interestPct = Math.max(0, await settingNum(db, 'RESTRUCTURE_INTEREST_PCT', 12));
  const minDc = Math.max(1, await settingNum(db, 'RESTRUCTURE_MIN_DC', 4));
  const { data: appr } = await db.from('settings').select('value').eq('key', 'RESTRUCTURE_APPROVERS').maybeSingle();
  const approvers = String((appr && appr.value) || '').split(',').map(x => K(x)).filter(Boolean);
  return { maxMonths: months, maxInstallments: months * 4, interestPct, minDc,
    approvers: approvers.length ? approvers : ['MANAGER', 'ADMIN'] };
}
function canApproveRestructure(user, strat) {
  if ((user.tabs || []).includes('settings')) return true;
  return strat.approvers.includes(K(user.role));
}
function restructureCompute(arrears, firstAmt, count, interestOn, interestPct) {
  arrears = Math.max(0, num(arrears));
  firstAmt = Math.min(Math.max(0, num(firstAmt)), arrears);
  const remaining = arrears - firstAmt;
  const interest = interestOn ? Math.round(remaining * (interestPct / 100)) : 0;
  const total = remaining + interest;
  count = Math.max(1, Math.floor(num(count)));
  // Rounding to the nearest 500 can land on ZERO when the count is large against a small
  // total, which would print a schedule of 0, 0, 0, <everything>. An installment is never
  // nothing: floor it at the rounding unit and let addRestructure reject a count that the
  // total cannot actually carry.
  const per = total > 0 ? Math.max(RX_ROUND, Math.round(total / count / RX_ROUND) * RX_ROUND) : 0;
  return { arrears, first: firstAmt, remaining, interest, total, count, per,
    last: total - per * (count - 1) };
}
/** Weekly dates from the first payment date, with the last one carrying the remainder. */
function restructureSchedule(total, count, per, startKey) {
  count = Math.max(1, Math.floor(num(count)));
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ n: i + 1, date: startKey ? addDaysKey(startKey, 7 * i) : null,
      amount: i === count - 1 ? total - per * (count - 1) : per });
  }
  return out;
}

/* THE RESTRUCTURING CONTRACT -- the one document here a customer actually signs.

   The figures were already being worked out and stored; there was simply nothing to put in
   front of the customer. Built the same way as the demand notice, from ONE set of numbers, so
   what is on the paper and what is in the books cannot drift: the schedule comes from
   restructureSchedule() rather than being re-derived for printing.

   Swahili, because the person signing it reads Swahili. Laid out for A4 with the company's
   stamp and signature, and with two signature lines -- the customer's and the guarantor's --
   because a restructuring that the guarantor has not agreed to is not worth the paper. */
function restructureContractHtml(t) {
  const img = (src, style, alt) => src ? `<img src="${esc_(src)}" style="${style}" alt="${alt}">` : '';
  const rows = t.schedule.map(s => `<tr><td style="text-align:center">${s.n}</td>`
    + `<td>${esc_(s.date || '—')}</td>`
    + `<td style="text-align:right">${fmtM(s.amount)}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="sw"><head><meta charset="UTF-8">
<title>Mkataba wa Marekebisho ya Mkopo — ${esc_(t.ref)}</title>
<style>
  @page{size:A4;margin:16mm}
  body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.55;color:#000;margin:0}
  .hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:10px}
  .hd .co{font-size:15pt;font-weight:bold;letter-spacing:.5px}
  .hd .sub{font-size:9.5pt}
  h1{font-size:13.5pt;text-align:center;margin:18px 0 4px;text-transform:uppercase;letter-spacing:.5px}
  .ref{text-align:center;font-size:10pt;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;margin:10px 0}
  th,td{border:1px solid #000;padding:5px 7px;font-size:11pt}
  th{background:#eee;text-align:left}
  .kv td{border:0;padding:2px 0;font-size:11.5pt}
  .kv td:first-child{width:42%;color:#333}
  .tot{font-weight:bold;background:#f4f4f4}
  .sig{display:flex;gap:26px;margin-top:26px}
  .sig div{flex:1}
  .line{border-bottom:1px solid #000;height:44px;margin-bottom:4px}
  .fine{font-size:9.5pt;color:#333;margin-top:14px;border-top:1px solid #999;padding-top:8px}
</style></head><body>
<div class="hd">${img(t.logo, 'height:52px', 'logo')}
  <div><div class="co">${esc_(t.brand)}</div><div class="sub">${esc_(t.motto || '')}</div></div></div>

<h1>Mkataba wa Marekebisho ya Marejesho</h1>
<div class="ref">Kumb. Na. ${esc_(t.ref)} &nbsp;·&nbsp; Tarehe: ${esc_(t.date)} &nbsp;·&nbsp; Timu: ${esc_(t.team)}</div>

<table class="kv">
  <tr><td>Jina la mteja / Customer</td><td><b>${esc_(t.name)}</b></td></tr>
  <tr><td>Namba ya simu / Contact</td><td>${esc_(t.contact || '—')}</td></tr>
  <tr><td>Mdhamini / Guarantor</td><td>${esc_(t.guarantor || '—')} ${esc_(t.guarantorContact || '')}</td></tr>
  <tr><td>Deni lililokuwepo / Arrears at agreement</td><td><b>TZS ${fmtM(t.arrears)}</b></td></tr>
  <tr><td>Malipo ya kwanza / First payment</td><td>TZS ${fmtM(t.first)}</td></tr>
  <tr><td>Salio / Remaining</td><td>TZS ${fmtM(t.remaining)}</td></tr>
  ${t.interest ? `<tr><td>Riba / Interest (${esc_(t.interestPct)}%)</td><td>TZS ${fmtM(t.interest)}</td></tr>` : ''}
  <tr><td>Jumla ya kulipa / Total payable</td><td><b>TZS ${fmtM(t.total)}</b></td></tr>
  <tr><td>Idadi ya awamu / Installments</td><td>${esc_(t.count)} (kila wiki / weekly)</td></tr>
</table>

<table>
  <thead><tr><th style="width:12%;text-align:center">Awamu</th><th>Tarehe / Date</th>
    <th style="text-align:right;width:32%">Kiasi / Amount (TZS)</th></tr></thead>
  <tbody>${rows}
    <tr class="tot"><td colspan="2">JUMLA / TOTAL</td>
      <td style="text-align:right">${fmtM(t.total)}</td></tr></tbody>
</table>

<p>Mimi, <b>${esc_(t.name)}</b>, ninakubali kulipa deni langu kwa mpangilio ulioonyeshwa hapo juu.
Nakubali kwamba nikishindwa kulipa awamu yoyote kwa tarehe yake, mkataba huu unaweza kusitishwa
na ${esc_(t.brand)} kuendelea na hatua za awali za urejeshaji wa deni, ikiwemo notisi ya madai.</p>
<p style="font-size:10.5pt;color:#333">I agree to repay the balance shown above on the dates shown.
If any installment is missed, this agreement may be cancelled and normal recovery action,
including a demand notice, may continue.</p>

<div class="sig">
  <div><div class="line"></div>Sahihi ya mteja / Customer<br><b>${esc_(t.name)}</b></div>
  <div><div class="line"></div>Sahihi ya mdhamini / Guarantor<br><b>${esc_(t.guarantor || '')}</b></div>
  <div><div class="line">${img(t.sign, 'max-height:40px', 'signature')}</div>
    Kwa niaba ya / For ${esc_(t.brand)}<br><b>${esc_(t.officer || '')}</b>
    ${img(t.stamp, 'max-height:64px;margin-top:6px', 'stamp')}</div>
</div>

<div class="fine">Mkataba huu umetolewa na ${esc_(t.brand)} tarehe ${esc_(t.date)}.
Hali ya ombi / Status: ${esc_(t.status || 'Pending')}.</div>
</body></html>`;
}

/** The contract for one restructuring, ready to print. Reads the stored row rather than
    recomputing, so a contract printed a week after approval says exactly what was approved. */
async function restructureContract(db, user, { id, ref } = {}) {
  const all = await fetchAll(() => db.from('restructures').select('*'));
  const row = id ? all.find(r => String(r.id) === String(id))
    : all.filter(r => K(r.ref) === K(ref)).sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  if (!row) throw badRequest('That restructuring request could not be found.');
  if (!teamAllowed(user, row.team)) throw forbidden(`You do not have access to team ${row.team}.`);

  // Read the same way the demand notice reads them, so both documents carry the same brand,
  // the same stamp and the same signature -- one company, one letterhead.
  const setRows = await fetchAll(() => db.from('settings').select('*'));
  const get = k => { const r = setRows.find(x => x.key === k); return (r && r.value) || ''; };
  const schedule = restructureSchedule(num(row.total), num(row.installments), num(row.inst_amt), row.start_date);
  return {
    row, schedule,
    html: restructureContractHtml({
      ref: row.ref, name: row.full_name, team: row.team, contact: row.contact,
      guarantor: row.guarantor, guarantorContact: row.guarantor_contact,
      arrears: num(row.arrears), first: num(row.first_inst), remaining: num(row.remaining),
      interest: num(row.interest_amt), interestPct: get('RESTRUCTURE_INTEREST_PCT') || '',
      total: num(row.total), count: num(row.installments), schedule,
      date: String(row.created_at || '').slice(0, 10), status: row.status,
      officer: row.approved_by || row.requested_by || user.name,
      brand: get('CALL_BRAND') || 'HOPE MICROCREDIT CO. LTD',
      motto: 'MKOPO CHAP CHAP',
      logo: get('BRAND_LOGO'), stamp: get('BRAND_STAMP'), sign: get('BRAND_SIGN'),
    }),
  };
}

async function restructures(db, user, _args, nowMs) {
  const [r, strat, teamBranch] = await Promise.all([listTable(db, user, 'restructures'), restructureStrategy(db), branchByTeam(db, nowMs)]);
  const rows = r.rows.map(x => ({ ...x,
    branch: teamBranch.get(K(x.team)) || null,
    schedule: restructureSchedule(num(x.total), num(x.installments), num(x.inst_amt), x.start_date) }));
  return { rows, count: rows.length, strategy: strat,
    canApprove: canApproveRestructure(user, strat),
    pending: rows.filter(x => K(x.status) === 'PENDING').length,
    approved: rows.filter(x => K(x.status) === 'APPROVED').length,
    rejected: rows.filter(x => K(x.status) === 'REJECTED').length };
}

/** Look a customer up by REF and say whether they can be restructured at all. */
async function restructureEligible(db, user, { ref }, nowMs) {
  if (!ref) throw badRequest('A customer REF# is required.');
  const snap = await defaulterBook(db, user, { type: 'current', notAfter: todayKey(nowMs) });
  const found = snap.rows.find(d => K(d.ref) === K(ref));
  if (!found) return { found: false };
  if (!teamAllowed(user, found.team)) throw forbidden(`You do not have access to team ${found.team}.`);
  const strat = await restructureStrategy(db);
  const dc = num(found.dc) || paidCount(found);
  return { found: true, ref: found.ref, full_name: found.full_name, team: found.team,
    contact: found.contact, guarantor: found.guarantor_name, guarantor_contact: found.guarantor_contact,
    arrears: num(found.arrears), dc, minDc: strat.minDc, eligible: dc >= strat.minDc, strategy: strat };
}

async function addRestructure(db, user, p, nowMs) {
  if (!p || !p.ref) throw badRequest('Pick a customer (REF#).');
  const elig = await restructureEligible(db, user, { ref: p.ref }, nowMs);
  if (!elig.found) throw badRequest('That REF# is not in the current Defaulters list.');
  const strat = elig.strategy;
  if (!elig.eligible) {
    throw badRequest(`Only defaulters with ${strat.minDc}+ missed installments can be restructured — this one has ${elig.dc}.`);
  }
  const count = Math.floor(num(p.installments ?? p.count));
  if (count < 1) throw badRequest('Enter how many weekly installments.');
  if (count > strat.maxInstallments) {
    throw badRequest(`Maximum ${strat.maxInstallments} weekly installments (${strat.maxMonths} months). Reduce the count.`);
  }
  if (num(p.firstInst ?? p.first) > elig.arrears) throw badRequest('The first installment cannot exceed the arrears.');
  // Recomputed from the CUSTOMER's own arrears, never from what the browser sent.
  const c = restructureCompute(elig.arrears, p.firstInst ?? p.first, count, !!p.interestOn, strat.interestPct);
  if (c.total <= 0) throw badRequest('Nothing left to reschedule after the first installment.');
  // Spread too thin, the final installment would come out zero or negative -- the schedule
  // would not add up to the total, which is the one thing the customer signs.
  if (c.last <= 0) {
    throw badRequest(`TZS ${Math.round(c.total).toLocaleString('en-US')} cannot be split into ${c.count} installments of at least TZS ${RX_ROUND}. Reduce the count.`);
  }
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.startDate || p.start))
    ? (p.startDate || p.start) : addDaysKey(todayKey(nowMs), 7);
  const { data, error } = await db.from('restructures').insert({
    ref: elig.ref, team: elig.team, full_name: elig.full_name, contact: elig.contact,
    guarantor: elig.guarantor, guarantor_contact: elig.guarantor_contact,
    arrears: c.arrears, dc: elig.dc, first_inst: c.first, remaining: c.remaining,
    interest_on: p.interestOn ? 'YES' : 'NO', interest_amt: c.interest,
    total: c.total, installments: c.count, inst_amt: c.per, start_date: startDate,
    status: 'Pending', requested_by: user.name, notes: p.notes || null,
    created_at: new Date(nowMs).toISOString(),
  }).select('*');
  if (error) throw new Error(error.message);
  const row = (data && data[0]) || null;
  return { row, computed: c, schedule: restructureSchedule(c.total, c.count, c.per, startDate) };
}

async function decideRestructure(db, user, p, nowMs) {
  if (!p || !p.id) throw badRequest('id is required');
  const strat = await restructureStrategy(db);
  // Approving a restructure writes off interest and rewrites a customer's obligations. Anyone
  // could do it here before, which made the Pending state decorative.
  if (!canApproveRestructure(user, strat)) {
    throw forbidden(`Only ${strat.approvers.join(' / ')} (or an admin) can approve or reject a restructuring offer.`);
  }
  const { data: row } = await db.from('restructures').select('team, status').eq('id', p.id).maybeSingle();
  if (!row) throw badRequest('That offer no longer exists.');
  if (!teamAllowed(user, row.team)) throw forbidden(`You do not have access to team ${row.team}.`);
  if (K(row.status) !== 'PENDING') throw badRequest(`This offer is already ${row.status}.`);
  const approve = String(p.decision || '').toLowerCase() === 'approve';
  if (!approve && !String(p.reason || '').trim()) throw badRequest('Give a reason when rejecting.');
  const { error } = await db.from('restructures').update({
    status: approve ? 'Approved' : 'Rejected',
    approved_by: user.name, approved_at: new Date(nowMs).toISOString(),
    reject_reason: approve ? null : String(p.reason).trim(),
  }).eq('id', p.id);
  if (error) throw new Error(error.message);
  return { id: p.id, status: approve ? 'Approved' : 'Rejected' };
}

/* ------------------------------------------------------------------ legal / demand notices

   A demand notice is the last step before the auctioneers, and it is a legal document: it
   states what was lent, what came back, what is still owed, the late-payment fine, and the
   number of days the customer has left. Getting the arithmetic wrong here is not a reporting
   error -- it is a demand for the wrong amount, in writing, with the company's stamp on it.
   So every figure is derived here, on the server, from the customer's own row:

     total loan          first installment + 11 x other        (the 12-week schedule)
     principal           total loan / 1.36                     (36% interest stripped)
     principal remaining total loan - what has actually been paid
     fine                weeks late x rate x weekly installment
     total demand        principal remaining + fine, rounded up to the next 500

   The fine RATE depends on the disbursement year -- loans written in 2024 and earlier carry
   2%, later ones 5% -- and it only starts after a two-week grace period past the first missed
   due date. A customer who has missed one payment and is not yet past expiry owes no fine at
   all; charging them one would be indefensible. */
const LEGAL_GRACE_DAYS = 14;
function roundUp500(v) { const n = num(v); return n % 500 === 0 ? n : Math.ceil(n / 500) * 500; }

function legalFine(d, noticeMs) {
  const disb = d.disb_date ? Date.parse(String(d.disb_date) + 'T00:00:00Z') : NaN;
  const other = num(d.other_inst);
  const paidCount = paidCount0(d);
  const disbYear = isNaN(disb) ? new Date(noticeMs).getUTCFullYear() : new Date(disb).getUTCFullYear();
  const rate = disbYear <= 2024 ? 0.02 : 0.05;
  const none = { fine: 0, weeks: 0, paidCount, rate };
  const missed = 12 - paidCount;
  if (missed <= 0 || isNaN(disb)) return none;
  const firstMissedDue = disb + 7 * (paidCount + 1) * 86400000;
  const expiry = d.expire_date ? Date.parse(String(d.expire_date) + 'T00:00:00Z') : NaN;
  const expired = !isNaN(expiry) && noticeMs > expiry;
  // One missed payment on a loan that has not expired yet is not yet a fineable default.
  if (missed < 2 && !expired) return none;
  const graceEnd = firstMissedDue + LEGAL_GRACE_DAYS * 86400000;
  if (noticeMs < graceEnd) return none;
  const weeks = Math.ceil(Math.floor((noticeMs - graceEnd) / 86400000) / 7);
  return { fine: weeks * rate * other, weeks, paidCount, rate };
}
/** paidCount reads D.S first; this is the same rule, kept separate so legal never silently
    inherits a change made for the credit-analyst book. */
function paidCount0(d) { return paidCount(d); }

function legalAmounts(d, fine) {
  const initial = num(d.initial_inst), other = num(d.other_inst), paid = num(d.t_payment);
  const totalLoan = initial + 11 * other;
  const principalRemaining = totalLoan - paid;
  return { totalLoan, principal: roundUp500(totalLoan / 1.36), principalRemaining,
    totalPaid: paid, weeklyInst: roundUp500(other),
    totalDemand: roundUp500(principalRemaining + fine) };
}

/* DELIBERATELY UNSCOPED, and the line below is why. This looks a customer up by reference and
   then tells the caller plainly that they exist but belong to another team -- a 403, not a
   shrug. Reading it team-scoped would turn "not yours" into "no such customer", which is a
   worse answer to give somebody holding the reference in their hand. The team check is the
   line after, and it is what actually protects the row. */
async function findDefaulter(db, user, ref, nowMs) {
  const snap = await defaulterBook(db, { teams: null }, { type: 'current', notAfter: todayKey(nowMs) });
  const found = snap.rows.find(d => K(d.ref) === K(ref));
  if (!found) return null;
  if (!teamAllowed(user, found.team)) throw forbidden(`You do not have access to team ${found.team}.`);
  return found;
}

async function legalPreview(db, user, { ref, noticeDate }, nowMs) {
  if (!ref) throw badRequest('A customer REF# is required.');
  const d = await findDefaulter(db, user, ref, nowMs);
  if (!d) return { found: false };
  const noticeMs = /^\d{4}-\d{2}-\d{2}$/.test(String(noticeDate))
    ? Date.parse(noticeDate + 'T00:00:00Z') : nowMs;
  const f = legalFine(d, noticeMs);
  const fine = roundUp500(f.fine);
  const a = legalAmounts(d, fine);
  return { found: true, ref: d.ref, full_name: d.full_name, team: d.team, contact: d.contact,
    guarantor: d.guarantor_name, guarantor_contact: d.guarantor_contact,
    arrears: num(d.arrears), paidCount: f.paidCount, weeks: f.weeks, rate: f.rate,
    ratePct: Math.round(f.rate * 1000) / 10, fine,
    disb_date: d.disb_date, expire_date: d.expire_date, landmark: d.nearest_landmark,
    ...a, noticeDate: new Date(noticeMs).toISOString().slice(0, 10) };
}

/** HMCL/<initials>/<dd>/<mm>/<yyyy>, with -2, -3 ... when the same person is served again on
    the same day. Stored, never recomputed: regenerating it later against a corrected name
    would produce a different reference for a letter already in the customer's hands. */
async function nextNoticeId(db, fullName, noticeKey) {
  const initials = String(fullName || '').trim().split(/\s+/)
    .map(p => p.charAt(0).toUpperCase()).join('') || 'XX';
  const [y, m, dd] = String(noticeKey).split('-');
  const base = `HMCL/${initials}/${dd}/${m}/${y}`;
  const rows = await fetchAll(() => db.from('demand_notices').select('notice_id'));
  const used = [];
  for (const r of rows) {
    const id = String(r.notice_id || '').trim();
    if (id === base) used.push(1);
    else if (id.startsWith(base + '-')) {
      const n = parseInt(id.slice(base.length + 1), 10);
      if (!isNaN(n)) used.push(n);
    }
  }
  return used.length ? `${base}-${Math.max(...used) + 1}` : base;
}

async function addDemandNotice(db, user, p, nowMs) {
  if (!p || !p.ref) throw badRequest('Pick a customer (REF#).');
  const d = await findDefaulter(db, user, p.ref, nowMs);
  if (!d) throw badRequest('That REF# is not in the current Defaulters list.');
  const noticeKey = /^\d{4}-\d{2}-\d{2}$/.test(String(p.noticeDate)) ? p.noticeDate : todayKey(nowMs);
  const days = Math.max(1, Math.floor(num(p.noticeDays) || 7));
  const f = legalFine(d, Date.parse(noticeKey + 'T00:00:00Z'));
  const fine = roundUp500(f.fine);
  const a = legalAmounts(d, fine);
  const noticeId = await nextNoticeId(db, d.full_name, noticeKey);
  const { error } = await db.from('demand_notices').insert({
    notice_id: noticeId, ref: d.ref, team: d.team, full_name: d.full_name, contact: d.contact,
    notice_date: noticeKey, notice_days: days, paid_count: f.paidCount, fine,
    principal_remaining: a.principalRemaining, total_demand: a.totalDemand,
    arrears_at_notice: num(d.arrears), other_inst: num(d.other_inst),
    issued_by: user.name, created_at: new Date(nowMs).toISOString(),
  });
  if (error) throw new Error(error.message);
  const brand = await fetchAll(() => db.from('settings').select('*'));
  const get = k => { const r = brand.find(x => x.key === k); return (r && r.value) || ''; };
  return { noticeId, ref: d.ref, fine, ...a, paidCount: f.paidCount, ratePct: Math.round(f.rate * 1000) / 10,
    html: demandNoticeHtml({
      noticeId, noticeDate: noticeKey, days,
      name: d.full_name, contact: d.contact, team: d.team,
      location: d.nearest_landmark || 'Dar es Salaam',
      disb: d.disb_date, expiry: d.expire_date,
      guarantorName: String(p.guarantorName || '').trim() || d.guarantor_name || '',
      guarantorContact: String(p.guarantorContact || '').trim() || d.guarantor_contact || '',
      officer: user.name, fine, ratePct: Math.round(f.rate * 1000) / 10, paidCount: f.paidCount, ...a,
      logo: get('BRAND_LOGO'), stamp: get('BRAND_STAMP'), sign: get('BRAND_SIGN'),
    }) };
}

const esc_ = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtM = n => Math.round(num(n)).toLocaleString('en-US');
/** The letter itself, in Swahili, laid out for A4. Kept as one template so what is stored and
    what is printed come from a single set of numbers. */
function demandNoticeHtml(t) {
  const daysWord = String(t.days) === '7' ? 'SABA' : String(t.days);
  const commission = Math.round(t.totalDemand * 0.1);
  const grand = t.totalDemand + 50000 + commission;
  const img = (src, style, alt) => src ? `<img src="${esc_(src)}" style="${style}" alt="${alt}">` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc_(t.noticeId)}</title><style>
@page{margin:14mm 16mm}body{font-family:Verdana,Arial,sans-serif;font-size:9.3pt;color:#000;line-height:1.35;text-align:justify}
.blue{border-top:3px solid #0B3BA7;margin-bottom:12px}.bbot{border-bottom:3px solid #0B3BA7;margin-top:16px}
.head{text-align:right;margin-bottom:14px}
.subj{font-weight:bold;text-decoration:underline;text-align:center;margin:10px 0}
table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #000;padding:5px 7px;font-size:9.3pt;vertical-align:top}th{background:#f0f0f0}
ol{padding-left:18px}.sig{margin-top:22px}
</style></head><body><div class="blue"></div>
<div class="head">${img(t.logo, 'height:52px;float:left', 'logo')}<b>HOPE MICROCREDIT COMPANY LIMITED</b><br>+255 659 077 770<br>info@hopemicrocredit.co.tz<br>www.hopemicrocredit.co.tz<br>P.O.Box 31623, Kijitonyama<br>Kinondoni, Dar es Salaam<br><br><b>${esc_(t.noticeDate)}</b></div>
<p><b>Kumb.Na. ${esc_(t.noticeId)}</b></p><br>
<p><b>${esc_(t.name)},</b><br>${esc_(t.contact)},<br>${esc_(t.location)} - ${esc_(t.team)}.</p>
<p class="subj">YAH: NOTISI YA KUKUTAKA ULIPE DENI LA MKOPO, SHILINGI ${fmtM(t.totalDemand)}/= NDANI YA SIKU ${daysWord} TU.</p>
<p>Tafadhali, rejea kichwa cha habari tajwa hapo juu. Kampuni ya Hope Microcredit inakuandikia notisi hii ya kukutaka ulipe deni lako ndani ya Siku ${esc_(t.days)} tangu ulipopewa notisi hii.</p>
<ol>
<li>Kwamba tarehe ${esc_(t.disb)} ulipatiwa mkopo wa Tsh. ${fmtM(t.principal)}/= uliopaswa kurejesha kila wiki Tsh ${fmtM(t.weeklyInst)}/= kwa wiki 12 (miezi 3), kumalizika tarehe ${esc_(t.expiry)}.</li>
<li>Kwamba jumla ya mkopo na riba ilikuwa Tsh ${fmtM(t.totalLoan)}/=.</li>
<li>Kwamba mpaka sasa umerejesha Tsh ${fmtM(t.totalPaid)}/= sawa na marejesho ${t.paidCount} kati ya 12.</li>
<li>Hivyo unadaiwa Tsh. ${fmtM(t.principalRemaining)}/= deni la msingi, pamoja na faini ya ${t.ratePct}% kwa kila rejesho lililochelewa; jumla ya faini ni Tsh. ${fmtM(t.fine)}/=, na jumla kuu ya deni ni Tsh. ${fmtM(t.totalDemand)}/=.</li>
<li>Notisi hii ni kukutaka ufanye malipo ya deni hilo lote ndani ya SIKU ${esc_(t.days)} TU.</li>
<li>Kushindwa kulipa kunaweza kupelekea kufikishwa mahakamani au kukabidhi deni kwa kampuni ya udalali na ufilisi, na utalipa gharama zote zifuatazo:</li>
</ol>
<table><tr><th>SN</th><th>MAELEZO</th><th>KIASI</th></tr>
<tr><td>i.</td><td>Deni lote la mkopo wako</td><td>Tsh. ${fmtM(t.totalDemand)}/=</td></tr>
<tr><td>ii.</td><td>Gharama ya dalali kukufikia</td><td>50,000/=</td></tr>
<tr><td>iii.</td><td>Kamisheni ya dalali 10% ya deni</td><td>${fmtM(commission)}/=</td></tr>
<tr><td>iv.</td><td>Faini ya kuchelewesha (${t.ratePct}%)</td><td>${fmtM(t.fine)}/=</td></tr>
<tr><th colspan="2">JUMLA</th><th>${fmtM(grand)}/=</th></tr></table>
<p><b>NB:</b> Malipo yafanyike kupitia MIXX BY YAS piga *150*01# &gt; 4 (Lipa Bili) &gt; 3 (Namba ya Kampuni 373337) &gt; Ingiza Kumbukumbu No <b>${esc_(t.ref || t.noticeRef || '')}</b> &gt; hakikisha jina <b>${esc_(t.name)}</b> kabla ya kuthibitisha.</p>
<p>Baada ya SIKU ${esc_(t.days)} hakutakuwa na notisi nyingine. Kupokea notisi hii hakumzuii mdai kuendelea kufuatilia deni kwa njia nyingine ikiwemo simu au kutembelewa na maafisa.</p>
<p><b>Kwa maelezo zaidi piga simu: +255 659 077 770</b></p>
<div class="sig"><p><b>Wako Katika Ujenzi wa Taifa</b><br>${img(t.sign, 'height:42px;display:block;margin:2px 0', 'sahihi')}<b>${esc_(t.officer)}</b><br>MWANASHERIA<br>HOPE MICROCREDIT COMPANY LIMITED</p>${img(t.stamp, 'height:88px;margin-top:2px', 'muhuri')}</div>
<p><b>NAKALA KWA MDHAMINI WA MKOPAJI</b><br>JINA: ${esc_(t.guarantorName)}<br>SIMU: ${esc_(t.guarantorContact)}</p>
<p><b>NAKALA KWA SERIKALI YA MTAA</b></p>
<div class="bbot"></div></body></html>`;
}

/* DID THE NOTICE WORK?

   The tab listed notices as issued and stopped there: what was owed when it was served, and
   nothing after. So the one question the register exists to answer -- does serving a demand
   notice actually bring money back -- had no figures behind it.

   arrears_at_notice was already stored on every notice. What was missing was the other end of
   the comparison: what that customer owes NOW. Put the two side by side and the difference is
   what the notice achieved.

   The "now" figure is today's current defaulter deck, the same book every other screen reads,
   so a recovery claimed here is the same recovery the dashboard counts. A customer who has
   left the deck entirely owes nothing on it, which is the strongest outcome a notice can have
   and must not be read as "no data". */
/* ------------------------------------------------------------------ where is this customer?

   An officer on the phone with a customer needs one thing: everything the company currently
   knows about them. Until now that meant opening tabs one at a time and searching each --
   Expected, then Defaulters, then Follow-up, then the pipeline -- while the customer waited.

   One reference number, one answer, across every book at once.

   THE SEARCH RUNS IN THE DATABASE, not here. Each book is asked "any row whose ref, name or
   phone looks like this", over its indexes, and sends back the handful that match. The
   alternative -- fetch every book and filter in JavaScript -- is the same mistake that made
   the Settings tab take a minute to open, and this is a screen somebody uses while a customer
   is holding.

   Team scoping still applies to every book. A search box is not a way around it. */
const SEARCH_BOOKS = [
  { key: 'expected',   table: 'repayment_snapshots', label: 'Expected Repayment',
    cols: 'ref, full_name, contact, team, arrears, payment_expected, todays_status, snapshot_date, snapshot_type' },
  { key: 'defaulters', table: 'defaulter_snapshots',  label: 'Defaulters',
    cols: 'ref, full_name, contact, team, arrears, status, ds, snapshot_date, snapshot_type' },
  { key: 'followup',   table: 'followup_status',      label: 'Follow-up',
    cols: 'ref, full_name, contact, team, arrears, fu_status, promise_date, last_comment' },
  { key: 'loans',      table: 'loans',                label: 'Loan pipeline',
    cols: 'docket_no, full_name, contact, team, stage, principal_amt, approved_date, disb_date',
    refCol: 'docket_no' },
  { key: 'payments',   table: 'received_payments',    label: 'Received payments',
    cols: 'ref_no, customer_name, customer_no, team, amount_paid, paid_at, transaction_id',
    refCol: 'ref_no', nameCol: 'customer_name', phoneCol: 'customer_no' },
  { key: 'restructures', table: 'restructures',       label: 'Restructuring',
    cols: 'ref, full_name, contact, team, arrears, total, installments, status, created_at' },
  { key: 'notices',    table: 'demand_notices',       label: 'Demand notices',
    cols: 'ref, full_name, contact, team, notice_id, notice_date, total_demand, arrears_at_notice' },
  { key: 'complaints', table: 'complaints',           label: 'Complaints',
    cols: 'ref, complainant, phone, team, category, status, created_at',
    nameCol: 'complainant', phoneCol: 'phone' },
];
const SEARCH_PER_BOOK = 25;

async function customerSearch(db, user, { q } = {}) {
  const term = String(q == null ? '' : q).trim();
  // The wildcards a LIKE understands are stripped, because a person typing % means the
  // character, not "everything". Doing that FIRST matters: "%%%" strips to nothing, and a
  // search for nothing wrapped in wildcards matches every customer in the company.
  const clean = term.replace(/[%_]/g, '');

  // Two characters matches half the book and answers nothing. Say so rather than returning a
  // thousand rows and letting the officer scroll while somebody waits on the phone.
  if (clean.length < 3) return { q: term, tooShort: true, books: [], total: 0 };

  // A phone number is written a dozen ways. Searching for the digits finds all of them.
  const digits = clean.replace(/\D/g, '');
  const like = '%' + clean + '%';

  const books = await Promise.all(SEARCH_BOOKS.map(async b => {
    const refCol = b.refCol || 'ref', nameCol = b.nameCol || 'full_name', phoneCol = b.phoneCol || 'contact';
    const clauses = [`${refCol}.ilike.${like}`, `${nameCol}.ilike.${like}`, `${phoneCol}.ilike.${like}`];
    // Nine digits of a Tanzanian number, however it was typed in.
    if (digits.length >= 6) clauses.push(`${phoneCol}.ilike.%${digits.slice(-9)}%`);
    let rows = [];
    try {
      const { data, error } = await db.from(b.table).select(b.cols).or(clauses.join(',')).limit(SEARCH_PER_BOOK);
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      // One book that will not answer must not take the whole search down. The officer gets
      // everything else, and the book that failed says so instead of silently reading empty.
      return { key: b.key, label: b.label, rows: [], failed: true };
    }
    return { key: b.key, label: b.label, rows: scoped(user, rows), failed: false };
  }));

  const found = books.filter(b => b.rows.length || b.failed);
  return { q: term, tooShort: false, books: found,
    total: found.reduce((s, b) => s + b.rows.length, 0),
    capped: found.some(b => b.rows.length >= SEARCH_PER_BOOK) };
}

/* ------------------------------------------------------------------ the noticeboard

   Management puts something on every screen in the company at once -- a picture, a sentence,
   or both -- and it stays there until each person waves it away.

   IT IS PUBLIC. It has to reach the sign-in screen, where nobody has identified themselves
   yet, so it is served without an access code (api_announcement, beside api_brand). Anything
   posted here is readable by anyone who can reach the site. That is a noticeboard, not a
   message, and the guards below are what stop it becoming something worse.

   The announcement table has been in the schema since the start and nothing ever wrote to it. */
const ANNOUNCE_MAX_TEXT = 500;
const ANNOUNCE_MAX_IMAGE = 600 * 1024;
async function announceSave(db, user, p = {}, nowMs = Date.now()) {
  // Whoever loads the company's reports is who posts to the company's noticeboard.
  if (!(user.tabs || []).includes('upload')) throw forbidden('Upload permission is required to post an announcement.');

  const text = String(p.text == null ? '' : p.text).trim().slice(0, ANNOUNCE_MAX_TEXT);
  let image = String(p.image == null ? '' : p.image).trim();
  if (image) {
    // Only a picture, and only one carried in the request itself. A URL would let a
    // noticeboard point every screen in the company at somebody else's server.
    if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(image)) {
      throw badRequest('The announcement image must be a picture file (PNG, JPG, GIF or WEBP).');
    }
    if (image.length > ANNOUNCE_MAX_IMAGE) {
      throw badRequest('That image is too large. Keep it under about 600 KB — it is loaded by every '
        + 'phone in the field, most of them on mobile data.');
    }
  }
  // Taking the picture off does not end the announcement if words remain. Two separate things
  // were posted; removing one is not removing both.
  const on = p.on === false ? false : !!(text || image);
  const { error } = await db.from('announcement').upsert({
    id: true, text: text || null, image_url: image || null, is_on: on,
    updated_at: new Date(nowMs).toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return { on, text, hasImage: !!image, ts: nowMs };
}

/* ------------------------------------------------------------------ the bell

   How a supervisor finds out a complaint was logged without opening the complaints tab.

   Two streams, one list: complaints raised and follow-up comments written. Team-scoped like
   everything else, newest first. "Unseen" is a per-CODE stamp, so marking them read on one
   person's screen does not mark them read on everybody's. */
const NOTIF_LIMIT = 60;
async function notifications(db, user, _args, nowMs) {
  return notifCore(db, user, notifKey_(user), nowMs);
}
const notifKey_ = user => notifKeyFor(user.code || user.name);
/** Marks everything currently visible as read, for THIS code only. */
async function notifSeen(db, user, _p, nowMs = Date.now()) {
  return notifSeenCore(db, notifKey_(user), nowMs);
}

async function demandNotices(db, user, _args, nowMs = Date.now()) {
  const [r, cur, teamBranch] = await Promise.all([
    listTable(db, user, 'demand_notices'),
    defaulterBook(db, user, { type: 'current', notAfter: todayKey(nowMs), teams: user.teams }),
    branchByTeam(db, nowMs),
  ]);
  const nowBy = {};
  for (const d of cur.rows) nowBy[K(d.ref)] = num(d.arrears);
  const seen = cur.rows.length > 0;

  const rows = r.rows.map(x => {
    const at = num(x.arrears_at_notice);
    const key = K(x.ref);
    const known = Object.prototype.hasOwnProperty.call(nowBy, key);
    // Off the deck = cleared. But only if there IS a deck today: with nothing uploaded, every
    // customer would look cleared and the tab would report a triumph that never happened.
    const current = known ? nowBy[key] : (seen ? 0 : null);
    return { ...x,
      branch: teamBranch.get(K(x.team)) || null,
      arrears_now: current,
      recovered_since: current == null ? null : Math.max(0, at - current),
      // What a person working the notice needs to see at a glance.
      notice_state: current == null ? 'Hakuna deki / No deck'
        : current <= 0 ? 'Amemaliza / Cleared'
        : current < at ? 'Amepunguza / Reducing'
        : 'Hajalipa / No movement',
    };
  });
  return { ...r, rows,
    demanded: rows.reduce((s, x) => s + num(x.total_demand), 0),
    fines: rows.reduce((s, x) => s + num(x.fine), 0),
    atNotice: rows.reduce((s, x) => s + num(x.arrears_at_notice), 0),
    recoveredSince: rows.reduce((s, x) => s + num(x.recovered_since), 0),
    cleared: rows.filter(x => x.notice_state.indexOf('Cleared') >= 0).length,
    asOf: cur.date || null };
}

/* =====================================================================================
   ABNORMAL PAYMENTS -- and who is supposed to be chasing each one.

     "the columns in the system should be GMO TEAM PMO CUSTOMER NO PAYMENT NO REF NO
      CUSTOMER NAME TRANSACTION ID PAID REF ID PAYMENT SENDER NAME
      where pmo is of either early collection, collection or recovery depending on the
      customer stage"

   REF ID was the missing one. It has always been in the table and the importer has always
   read it -- it simply was never put on the screen, so a column the sheet carries could not be
   seen anywhere in the system.

   THE PMO COLUMN NAMES A STAGE, AND THE STAGE DECIDES WHOSE JOB IT IS:

     still performing, on the expected book   EARLY COLLECTION
     fallen behind, in the defaulter register COLLECTION
     expired or chronic                       RECOVERY

   The sheet carries this column, and whatever it says is kept -- untouched, always. But a
   blank PMO cell on a flagged payment is the worst kind of blank: an unexplained amount with
   nobody named against it, which is exactly the row that gets left. So a blank is FILLED from
   the customer's actual stage, and named to the person the teams table holds for that stage
   where there is one.

   ONLY WHEN IT CAN BE ANSWERED. A reference that appears in neither book is left blank rather
   than guessed at -- an unknown customer wrongly labelled "early collection" would send
   somebody to the wrong desk, which is worse than an empty cell that says "find out". */
const ABN_STAGE = [
  { stage: 'RECOVERY', label: 'RECOVERY', col: 'recovery' },
  { stage: 'COLLECTION', label: 'COLLECTION', col: 'collection' },
  { stage: 'EARLY COLLECTION', label: 'EARLY COLLECTION', col: 'expected' },
];
const abnKey = r => K(r.ref_no || r.ref_id || '');

/* =====================================================================================
   WHAT MAKES A PAYMENT ABNORMAL -- WRITTEN DOWN AT LAST.

     "I uploaded received payments but not a single abnormal payment was flagged"

   Because nothing flagged anything. The screen has always said "amounts not in multiples of
   TZS 500 / 1,000" -- and that sentence was the ONLY place the rule existed. No code applied
   it. Abnormal Payments was a table you uploaded a separate sheet into, so it could only ever
   show what somebody had already worked out somewhere else, and uploading the payments
   themselves did nothing at all.

   The rule now runs. A received payment whose amount is not a whole multiple of the step is
   flagged, and the step is a SETTING (ABNORMAL_STEP, default 500) because it is a company
   policy, not a fact about arithmetic -- 79,500 and 100,000 are clean at 500; 79,543 is not.

   ADDITIVE, AND THE UPLOAD PATH IS UNTOUCHED. Rows uploaded to abnormal_payments still appear
   exactly as they did, still first. Derived rows are added beside them and marked, so the two
   are never confused -- and where a payment appears in BOTH (the sheet was uploaded as well),
   the UPLOADED row wins and the derived one is dropped, matched on transaction id. Somebody
   typed the uploaded one; it is not this code's place to duplicate their work.

   POSTGRES: one read, TEAM-SCOPED and DATE-WINDOWED at the database -- the same discipline as
   every other read on this screen. received_payments only grows, so an unbounded scan here
   would have undone the whole load pass. The window is a parameter, 60 days by default.
   ===================================================================================== */
const ABN_STEP_KEY = 'ABNORMAL_STEP';
const ABN_STEP_DEFAULT = 500;
const ABN_WINDOW_DAYS = 60;

/** The window both screens look through. Shared, because the Abnormal Payments tab and the
    dashboard tile must never be able to disagree about how far back "flagged" reaches -- two
    different answers to the same question on two screens is exactly the fault the commission
    total had. */
function abnormalWindow(nowMs, args) {
  return {
    from: /^\d{4}-\d{2}-\d{2}$/.test(String(args && args.from))
      ? args.from : addDaysKey(todayKey(nowMs), -ABN_WINDOW_DAYS),
    to: /^\d{4}-\d{2}-\d{2}$/.test(String(args && args.to)) ? args.to : todayKey(nowMs),
  };
}

/** Not a whole multiple of `step`. Zero and blank are not flagged: an amount nobody recorded is
    a gap in the file, not an irregular payment. */
export function isAbnormalAmount(amount, step) {
  const a = Number(amount);
  const st = Number(step) > 0 ? Number(step) : ABN_STEP_DEFAULT;
  if (!a || !isFinite(a) || a <= 0) return false;
  return Math.abs(a % st) > 1e-9;
}

async function abnormal(db, user, args, nowMs) {
  const { from, to } = abnormalWindow(nowMs, args);

  const [base, cfg, paid] = await Promise.all([
    listTable(db, user, 'abnormal_payments'),
    settingsMany(db, [ABN_STEP_KEY]),
    /* Scoped and windowed IN THE QUERY. This table only ever grows.

       `ref_id` arrives with db/migrations/2026-08-10-received-ref-id.sql, and migrations here
       are run by hand. PostgREST rejects the WHOLE read for one unknown column -- so asking for
       it on a database that has not run that file took the entire Abnormal Payments screen down
       with "column received_payments.ref_id does not exist". The write path was already guarded
       against exactly this and the read path was not, which is the whole lesson: an optional
       column is optional in BOTH directions. */
    (async () => {
      const cols = 'paid_at, team, customer_name, customer_no, transaction_id, ref_no, amount_paid, payment_no, sender_name';
      const read = c => fetchAll(() => onTeams(db.from('received_payments').select(c)
        .gte('paid_at', from).lte('paid_at', to), user.teams));
      try { return await read(cols + ', ref_id'); }
      catch (e) {
        // Only an unknown ref_id falls back. A real failure stays a real failure.
        if (!/ref_id/.test(String((e && e.message) || e))) throw e;
        return read(cols);
      }
    })(),
  ]);
  const step = cfg.num(ABN_STEP_KEY, ABN_STEP_DEFAULT);

  // An uploaded row for the same transaction wins -- somebody typed it.
  const already = new Set(base.rows
    .map(r => K(r.transaction_id)).filter(Boolean));
  const derived = scoped(user, paid)
    .filter(r => isAbnormalAmount(r.amount_paid, step))
    .filter(r => !already.has(K(r.transaction_id)))
    .map(r => ({
      id: 'rcv:' + (r.transaction_id || r.ref_id || r.ref_no || Math.random()),
      team: r.team, gmo: null, pmo: null,
      contact_no: r.customer_no, phone_number: r.payment_no,
      ref_no: r.ref_no, ref_id: r.ref_id,
      customer_name: r.customer_name, sender_name: r.sender_name,
      transaction_id: r.transaction_id, paid: num(r.amount_paid),
      payment: null, created_at: r.paid_at,
      // So the screen can say which rows the system worked out and which were uploaded.
      source: 'received',
    }));
  for (const r of base.rows) r.source = r.source || 'upload';

  base.rows = base.rows.concat(derived)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  base.count = base.rows.length;
  base.step = step;
  base.from = from; base.to = to;
  base.uploaded = base.count - derived.length;
  base.derived = derived.length;
  base.scanned = paid.length;

  const blanks = base.rows.filter(r => !String(r.pmo == null ? '' : r.pmo).trim());
  if (!blanks.length) return { ...base, pmoFilled: 0 };

  /* Two narrow, team-scoped reads -- only the columns the stage question needs. The defaulter
     register says who has fallen behind and how far; the expected deck says who is still
     performing. A reference in neither is left alone. */
  const [fu, exp, teamRows] = await Promise.all([
    fetchAll(() => {
      let q = db.from('followup_status').select('ref, status, team');
      if (user.teams && user.teams.length) q = q.in('team', upperTeams(user.teams));
      return q;
    }),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'today' },
      { notAfter: todayKey(nowMs), teams: user.teams, columns: 'ref, team' }),
    readTeamsAll(db),
  ]);

  const stageOf = {};
  for (const r of exp.rows) { const k = K(r.ref); if (k) stageOf[k] = 'EARLY COLLECTION'; }
  // The defaulter register wins over the expected deck: a customer on both has fallen behind.
  for (const r of fu) {
    const k = K(r.ref);
    if (!k) continue;
    const st = K(r.status);
    stageOf[k] = (st.includes('CHRON') || st.includes('EXPIR')) ? 'RECOVERY'
      : (st.includes('DEFAULT') ? 'COLLECTION' : (stageOf[k] || 'COLLECTION'));
  }
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;

  let filled = 0;
  for (const r of blanks) {
    const stage = stageOf[abnKey(r)];
    if (!stage) continue;                      // in neither book -- say nothing rather than guess
    const spec = ABN_STAGE.find(x => x.stage === stage);
    const who = String((teamBy[K(r.team)] || {})[spec.col] || '').trim();
    // The person where the teams table names one, else the stage itself -- the role is still
    // the useful half of the answer.
    r.pmo = who || spec.label;
    r.pmo_stage = stage;
    filled++;
  }
  return { ...base, pmoFilled: filled };
}

async function received(db, user, { from, to }, nowMs) {
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : weekMondayKey(nowMs);
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : todayKey(nowMs);
  const rows = scoped(user, await fetchAll(() => db.from('received_payments').select('*').gte('paid_at', fromKey).lte('paid_at', toKey)));
  return { from: fromKey, to: toKey, rows, count: rows.length,
    amount: rows.reduce((s, r) => s + num(r.amount_paid), 0) };
}

/* ------------------------------------------------------------------ analytics tabs */
/** Portfolio at Risk: the current deck bucketed by how long each customer has been in
    arrears (dc = days count), plus a status split. Buckets follow the classic PAR bands. */
const PAR_BANDS = [
  { key: '1-30', lo: 1, hi: 30 }, { key: '31-60', lo: 31, hi: 60 },
  { key: '61-90', lo: 61, hi: 90 }, { key: '91-180', lo: 91, hi: 180 },
  { key: '180+', lo: 181, hi: Infinity },
];
/** PAR is read two ways and the live system showed BOTH: by how long a customer has been in
    arrears (the ageing bands above) and by how big their loan is (the principal bands below).
    The second is the one the meeting acts on -- it says where the overdue money is
    concentrated -- and it was missing here entirely. */
const PRINCIPAL_BANDS = [
  { label: '< 500K', lo: 0, hi: 500000 },
  { label: '500K – 1M', lo: 500000, hi: 1000000 },
  { label: '1M – 2M', lo: 1000000, hi: 2000000 },
  { label: '2M – 3M', lo: 2000000, hi: 3000000 },
  { label: '3M – 5M', lo: 3000000, hi: 5000000 },
  { label: '≥ 5M', lo: 5000000, hi: Infinity },
];
/** Principal behind a defaulter row with the interest stripped: the schedule runs 12
    installments and carries 36% interest, so principal = (first + 11 × other) ÷ 1.36. Falls
    back to the outstanding balance when the schedule columns are blank. */
function principalOf(r) {
  const total = num(r.initial_inst) + 11 * num(r.other_inst);
  return total > 0 ? Math.round(total / 1.36) : num(r.balance);
}
/** Installments paid, read the way the sheet did: "3/6" in D.S, else derived from what has
    actually been paid against the schedule. */
function paidCount(r) {
  const m = String(r.ds == null ? (r.due_summary == null ? '' : r.due_summary) : r.ds).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Math.min(12, Math.max(0, Number(m[1])));
  const initial = num(r.initial_inst), other = num(r.other_inst), paid = num(r.t_payment);
  let pc = 0;
  if (other > 0 && paid >= initial) pc = 1 + Math.floor((paid - initial) / other);
  return Math.min(12, Math.max(0, pc));
}

async function par(db, user, _args, nowMs) {
  const snap = await defaulterBook(db, user, { type: 'current', notAfter: todayKey(nowMs) });
  const rows = scoped(user, snap.rows);
  const bands = PAR_BANDS.map(b => ({ band: b.key, customers: 0, arrears: 0 }));
  const pbands = PRINCIPAL_BANDS.map(b => ({ band: b.label, customers: 0, arrears: 0, balance: 0, loanSum: 0 }));
  const teamBranch = await branchByTeam(db);
  const byStatus = {}, byTeam = {};
  let totArrears = 0, totBalance = 0, totLoan = 0;
  for (const r of rows) {
    const days = num(r.days_elapsed) || num(r.dc);
    const i = PAR_BANDS.findIndex(b => days >= b.lo && days <= b.hi);
    if (i >= 0) { bands[i].customers++; bands[i].arrears += num(r.arrears); }
    const arr = num(r.arrears), bal = num(r.balance), loan = principalOf(r);
    const j = PRINCIPAL_BANDS.findIndex(b => loan >= b.lo && loan < b.hi);
    if (j >= 0) { pbands[j].customers++; pbands[j].arrears += arr; pbands[j].balance += bal; pbands[j].loanSum += loan; }
    totArrears += arr; totBalance += bal; totLoan += loan;
    const st = r.status || '(none)';
    if (!byStatus[st]) byStatus[st] = { status: st, customers: 0, arrears: 0 };
    byStatus[st].customers++; byStatus[st].arrears += arr;
    const t = r.team || '(no team)';
    if (!byTeam[t]) byTeam[t] = { team: t, customers: 0, arrears: 0, balance: 0, loanSum: 0 };
    byTeam[t].customers++; byTeam[t].arrears += arr; byTeam[t].balance += bal; byTeam[t].loanSum += loan;
  }
  const finish = b => ({ customers: b.customers, arrears: b.arrears, balance: b.balance,
    avgLoan: b.customers ? Math.round(b.loanSum / b.customers) : 0,
    par: pctOf(b.arrears, b.balance), share: pctOf(b.arrears, totArrears) });
  return { date: snap.date, weekday: currentWeekday(nowMs), bands,
    byBand: pbands.map(b => ({ band: b.band, ...finish(b) })),
    byStatus: Object.values(byStatus).sort((a, b) => b.arrears - a.arrears),
    byTeam: Object.values(byTeam).map(t => ({ team: t.team, branch: teamBranch.get(K(t.team)) || null, ...finish(t) })).sort((a, b) => b.arrears - a.arrears),
    totals: { customers: rows.length, arrears: totArrears, balance: totBalance,
      avgLoan: rows.length ? Math.round(totLoan / rows.length) : 0, par: pctOf(totArrears, totBalance) } };
}

/** Weekly report: Mon-Fri collection per day plus the week's recovery and sales, all
    scoped -- the same numbers the dashboard shows, laid out by day. */
/* WHAT A WEEK-WIDE READ ACTUALLY NEEDS.
 *
 * A range read is five to seven days of the WHOLE BOOK, so every column left out is dropped
 * that many times over. These reads asked for `*` -- every column of every customer for every
 * day of the week -- and at thirty thousand customers that is what turned the dashboard, the
 * weekly report and the Presentation into HTTP 504 within the same hour.
 *
 * These are exactly the columns the arithmetic touches: team for scoping, snapshot_date and
 * snapshot_type to sort the days out, and the money. collectedOf reads payment_expected,
 * arrears and todays_status and nothing else; uncollectedOf is built on collectedOf. The batch
 * keys are added automatically by snapshotsInRange, so a re-upload still supersedes correctly.
 *
 * Narrowing is opt-in ON PURPOSE -- latestSnapshot is shared with the phone's lists, which need
 * names and numbers, and a single hard-coded list would silently rob one screen to feed
 * another. So these are passed only by callers that have been read and can say what they use.
 */
const WEEK_EXP_COLS = 'team, payment_expected, arrears, todays_status, snapshot_date, snapshot_type';
const WEEK_DEF_COLS = 'team, arrears, snapshot_date, snapshot_type, weekday';
/* The customer-level columns the weekly report's Count 1-6 section reads: the reference to
   pair a customer across the two decks, the arrears on each side, and everything paidCount()
   looks at. `due_summary` is deliberately NOT here -- it is a repayment_snapshots column, and
   asking defaulter_snapshots for it would fail the WHOLE read rather than return a blank. */
const WEEK_CREDIT_COLS = 'ref, team, arrears, ds, initial_inst, other_inst, t_payment';

async function weekly(db, user, { weekOf }, nowMs) {
  // Snapped to its Monday rather than trusted to be one, so a date arrived at any other way
  // reads as the week it falls in instead of as a week starting mid-way through.
  const asOf = asOfWeek(nowMs, weekOf);
  const mon = asOf.weekOf;
  const fri = addDaysKey(mon, 4);
  const [expAll, defAll, loansAll, rcvAll] = await Promise.all([
    expectedTotalsInRange(db, { type: 'today', from: mon, to: fri, teams: user.teams }),
    defaulterTotalsInRange(db, { from: mon, to: fri, teams: user.teams }),
    fetchAll(() => db.from('loans').select('team, principal_amt, loan_amt, approved_date').in('stage', SALES_STAGES).gte('approved_date', mon).lte('approved_date', addDaysKey(mon, 6))),
    fetchAll(() => db.from('received_payments').select('team, amount_paid, paid_at').gte('paid_at', mon).lte('paid_at', addDaysKey(mon, 6))),
  ]);
  const days = [];
  for (let i = 0; i < 5; i++) {
    const date = addDaysKey(mon, i);
    /* THE BATCH RULE, WHICH THIS STRIP WAS THE ONE PLACE NOT TO APPLY.
       Every other read in the system takes the latest upload_batch within a date, so a
       corrected re-upload supersedes rather than doubles. These five tiles summed EVERY batch
       -- so on any day somebody uploaded twice, the strip showed roughly double while the team
       section underneath it, which does apply the rule, showed the truth. Two figures for the
       same money on the same screen, and only after a re-upload, which is exactly when
       somebody is already looking for a discrepancy. */
    const dayRows = pickLatestBatchRows(scoped(user, expAll.filter(r => String(r.snapshot_date) === date)));
    /* PAIRED ON DATE, TYPE **AND WEEKDAY**. The decks are per weekday; an initial MON deck
       against a current TUE deck compares two different populations and reports the gap
       between them as recovery. That is the mistake that once produced -194 million, and it
       was still here -- which is why the RECOVERED card (which does match on weekday) and
       this row disagreed on the same book. */
    const dwd = WD5[i];
    const ini = pickLatestBatchRows(scoped(user, defAll.filter(r => String(r.snapshot_date) === date && r.snapshot_type === 'initial' && r.weekday === dwd)));
    const cur = pickLatestBatchRows(scoped(user, defAll.filter(r => String(r.snapshot_date) === date && r.snapshot_type === 'current' && r.weekday === dwd)));
    const exp = tExpected(dayRows);
    const col = tCollected(dayRows);
    days.push({
      date, weekday: ['MON', 'TUE', 'WED', 'THU', 'FRI'][i],
      customers: tCustomers(dayRows), expected: exp, collected: col, uncollected: tUncollected(dayRows),
      pct: exp > 0 ? Math.round((col / exp) * 1000) / 10 : null,
      recovered: (ini.length && cur.length) ? tArrears(ini) - tArrears(cur) : 0,
      received: scoped(user, rcvAll.filter(r => String(r.paid_at) === date)).reduce((s, r) => s + num(r.amount_paid), 0),
    });
  }
  const sales = scoped(user, loansAll);

  /* The weekly report is read PER TEAM, in five sections -- Sales, Count 1-6, Collection,
     Recovery and Ongezeko la deni (debt movement). The day strip above answers "how did the
     week go"; these answer "which team". Ongezeko compares Monday's initial deck against the
     week-end current one, so a positive change means debt FELL. */
  const [teamRows, monIni, endCur] = await Promise.all([
    readTeamsAll(db),
    /* THE ONE PART OF THIS REPORT THAT IS NOT A SUM. "Ongezeko la deni" and Count 1-6 compare
       each CUSTOMER's Monday arrears against their arrears at the end of the week, so these two
       have to stay customer rows -- a team total cannot say whether one person cleared. They
       are two single decks rather than a week of them, and they are now narrowed to the seven
       columns that are actually read instead of select('*'). */
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: 'MON' }, { onDate: mon, columns: WEEK_CREDIT_COLS }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current' }, { notAfter: addDaysKey(mon, 6), columns: 'ref, team, arrears' }),
  ]);
  const perTarget = await settingNum(db, 'SALES_TARGET_WEEKLY', await settingNum(db, 'SALES_TARGET', 100000000));
  const T = {};
  const gt = team => bucket(T, String(team || '(no team)').trim() || '(no team)',
    { sales: 0, expected: 0, collected: 0, uncollected: 0, recovered: 0, recToday: 0,
      mondayDebt: 0, curDebt: 0, c16: 0, cleared: 0, reduced: 0, bad: 0, stat: 0 });
  for (const r of sales) gt(r.team).sales += num(r.principal_amt) || num(r.loan_amt);
  for (const d of days) {
    const dayRows = scoped(user, expAll.filter(r => String(r.snapshot_date) === d.date));
    for (const r of pickLatestBatchRows(dayRows)) {
      const b = gt(r.team);
      b.expected += num(r.expected_amt); b.collected += num(r.collected_amt);
      b.uncollected += num(r.uncollected_amt);
    }
    // Same population on both sides -- see the note above.
    const ini = pickLatestBatchRows(scoped(user, defAll.filter(r => String(r.snapshot_date) === d.date && r.snapshot_type === 'initial' && r.weekday === d.weekday)));
    const cur = pickLatestBatchRows(scoped(user, defAll.filter(r => String(r.snapshot_date) === d.date && r.snapshot_type === 'current' && r.weekday === d.weekday)));
    if (!ini.length || !cur.length) continue;
    /* TODAY'S OWN RECOVERY, KEPT SEPARATE FROM THE WEEK'S.
       "On wiki report add leo rec b/se we only seeing total week rec at call app without
        noticing todays progress in app"
       The week's figure cannot answer "are we moving today" -- by Thursday it is mostly
       Monday and Tuesday, and a day of nothing is invisible inside it. Accumulated in the
       same pass, off the same paired decks, so the two can never disagree about the day. */
    const isToday = d.date === todayKey(nowMs);
    for (const r of ini) { const b = gt(r.team); b.recovered += num(r.arrears_amt); if (isToday) b.recToday += num(r.arrears_amt); }
    for (const r of cur) { const b = gt(r.team); b.recovered -= num(r.arrears_amt); if (isToday) b.recToday -= num(r.arrears_amt); }
  }
  const myMonIni = scoped(user, monIni.rows), myEndCur = scoped(user, endCur.rows);
  for (const r of myMonIni) gt(r.team).mondayDebt += num(r.arrears);
  for (const r of myEndCur) gt(r.team).curDebt += num(r.arrears);
  const endArrBy = {}, endHas = {};
  for (const r of myEndCur) { endArrBy[K(r.ref)] = num(r.arrears); endHas[K(r.ref)] = true; }
  for (const r of myMonIni) {
    if (paidCount(r) >= CREDIT_HALF) continue;
    const k = K(r.ref), initA = num(r.arrears);
    const cur = endHas[k] ? endArrBy[k] : 0;
    const b = gt(r.team);
    b.c16++;
    const st = creditState(initA, cur, !!endHas[k]);
    if (st === 'Cleared') b.cleared++; else if (st === 'Reduced') b.reduced++; else if (st === 'Bad') b.bad++; else b.stat++;
  }
  const leadBy = {};
  for (const t of teamRows) leadBy[K(t.team)] = t;
  const teamsOut = Object.values(T).map(b => ({
    team: b.key, branch: (leadBy[K(b.key)] || {}).branch || null, lead: leadBy[K(b.key)] || {},
    sales: b.sales, salesPct: pctOf(b.sales, perTarget),
    expected: b.expected, collected: b.collected, uncollected: b.uncollected,
    collPct: pctOf(b.collected, b.expected),
    recovered: b.recovered, recPct: pctOf(b.recovered, b.uncollected),
    recToday: b.recToday,
    mondayDebt: b.mondayDebt, curDebt: b.curDebt, debtDelta: b.mondayDebt - b.curDebt,
    c16: b.c16, cleared: b.cleared, reduced: b.reduced, bad: b.bad, stat: b.stat,
    success: pctOf(b.cleared + b.reduced, b.c16),
  })).sort((a, b) => b.sales - a.sales);
  const sum = f => teamsOut.reduce((s, r) => s + (r[f] || 0), 0);
  const teamTotals = {
    sales: sum('sales'), expected: sum('expected'), collected: sum('collected'),
    uncollected: sum('uncollected'), recovered: sum('recovered'), recToday: sum('recToday'),
    mondayDebt: sum('mondayDebt'), curDebt: sum('curDebt'),
    c16: sum('c16'), cleared: sum('cleared'), reduced: sum('reduced'), bad: sum('bad'), stat: sum('stat'),
  };
  teamTotals.debtDelta = teamTotals.mondayDebt - teamTotals.curDebt;
  teamTotals.salesPct = pctOf(teamTotals.sales, perTarget * Math.max(teamsOut.length, 1));
  teamTotals.collPct = pctOf(teamTotals.collected, teamTotals.expected);
  teamTotals.recPct = pctOf(teamTotals.recovered, teamTotals.uncollected);
  teamTotals.success = pctOf(teamTotals.cleared + teamTotals.reduced, teamTotals.c16);
  teamTotals.companyTarget = perTarget * Math.max(teamsOut.length, 1);

  /* WRITTEN DOWN AT THE TIME. A record that depends on somebody remembering to press a button
     is a record with holes in it, and the holes are always the weeks nobody was paying
     attention -- which are the weeks worth having. This report is opened constantly, so every
     time it is, the week, month and year it falls in are stamped with what they look like now,
     copying each leader's NAME AND POSITION as text. See api/_lib/performance.js. */
  recordPerformance(db, teamsOut, teamRows, mon, nowMs);

  return { weekOf: mon, weekEnd: fri, days,
    // What was ASKED for, so the week bar can say when a choice was overruled and why.
    weekRequested: asOf.requested, weekFuture: asOf.future, pastWeek: asOf.past,
    teams: teamsOut, teamTotals, perTarget, teamCount: teamsOut.length,
    // The leader columns as they stand, so a hand-stamp records the same names the automatic
    // one does rather than reading the table a second time and possibly a moment later.
    teamRows,
    leadCols: TEAM_ROLE_COLS.slice(),
    hasMonday: myMonIni.length > 0, hasWeekEnd: myEndCur.length > 0, weekEndDate: endCur.date,
    totals: {
      expected: days.reduce((s, d) => s + d.expected, 0),
      collected: days.reduce((s, d) => s + d.collected, 0),
      uncollected: days.reduce((s, d) => s + d.uncollected, 0),
      recovered: days.reduce((s, d) => s + d.recovered, 0),
      /* Leo. Zero when the shown week is not the current one -- a past week has no "today" in
         it, and printing Friday's figure under that heading would be a different number
         wearing the same label. */
      recoveredToday: (days.find(d => d.date === todayKey(nowMs)) || { recovered: 0 }).recovered,
      isCurrentWeek: days.some(d => d.date === todayKey(nowMs)),
      received: days.reduce((s, d) => s + d.received, 0),
      salesCount: sales.length,
      salesAmount: sales.reduce((s, r) => s + (num(r.principal_amt) || num(r.loan_amt)), 0),
    } };
}
/** The supervisory roles a weekly report can be grouped by -- the teams table's own columns. */
const TEAM_ROLE_COLS = ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike'];
/* THE OFFLINE SHEET'S OTHER HALF -- added by 2026-08-09-team-contacts.sql, and optional like
   every migration here. Every role that has a name column now has a number column beside it,
   because a demand notice that tells a customer to ring a number nobody answers is worse than
   no notice at all, and because the sheet the PMO already keeps has always carried both.

   `legal` and `collection` are names, not numbers: the legal officer had no column at all, and
   a collection officer's name normally lives on their access code -- one person holds thirty
   teams -- so this is here for the teams whose collection officer is not an app user. */
const TEAM_PHONE_OF = {
  opm: 'opm_no', recovery: 'recovery_no', gmo: 'gmo_no', manager: 'manager_no',
  credit: 'credit_no', expected: 'expected_no', bike: 'bike_no',
  legal: 'legal_no', collection: 'collection_no',
};
/* `branch` -- 2026-08-19-team-branch.sql. A team belongs to one branch; customer service picks
   a branch at registration without needing to know which of its teams will end up serving the
   customer, so the branch has to live somewhere, and this is the same optional-column pattern
   as region and zone right beside it. */
/* A STAFF ID BESIDE EVERY ROLE -- 2026-08-19-team-staff-ids.sql, "my final thought of the
   teams and staff table." Plain reference numbers, round-tripped like everything else in this
   list; nothing in this codebase reads any of them for a calculation. `credit_id` is the one
   column here that already existed (2026-08-04) for a narrower purpose since retired -- see the
   migration file for why bringing its STORAGE back is not un-retiring that. */
const TEAM_ID_OF = {
  opm: null, recovery: 'recovery_id', gmo: 'gmo_id', manager: 'manager_id',
  credit: 'credit_id', expected: 'early_col_id', bike: 'bike_id',
  legal: 'legal_id', collection: 'collection_id',
};
const TEAM_OPTIONAL_COLS = ['region', 'zone', 'branch', 'legal', 'collection']
  .concat(Object.values(TEAM_PHONE_OF))
  .concat(Object.values(TEAM_ID_OF).filter(Boolean));

/** Leader Reports / Team Progress: per-team initial vs current arrears, recovered and
    progress %, mirroring the live Team Progress sheet. */
async function teamProgress(db, user, _args, nowMs) {
  const wd = currentWeekday(nowMs);
  const [ini, cur] = await Promise.all([
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: wd }, { notAfter: todayKey(nowMs) }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: wd }, { notAfter: todayKey(nowMs) }),
  ]);
  const teamsRows = await readTeamsAll(db);
  const paired = ini.rows.length && cur.rows.length && String(ini.date) === String(cur.date);
  const by = {};
  const bump = (team, field, v) => {
    const t = team || '(no team)';
    if (!by[t]) by[t] = { team: t, initArrears: 0, curArrears: 0, initCust: 0, curCust: 0, recovery: null, gmo: null, manager: null, branch: null };
    by[t][field] += v;
  };
  for (const r of scoped(user, ini.rows)) { bump(r.team, 'initArrears', num(r.arrears)); bump(r.team, 'initCust', 1); }
  for (const r of scoped(user, cur.rows)) { bump(r.team, 'curArrears', num(r.arrears)); bump(r.team, 'curCust', 1); }
  for (const t of teamsRows) {
    if (!by[t.team]) continue;
    by[t.team].recovery = t.recovery || null; by[t.team].gmo = t.gmo || null; by[t.team].manager = t.manager || null;
    by[t.team].branch = t.branch || null;
  }
  const rows = Object.values(by).map(r => ({
    ...r,
    recovered: paired ? r.initArrears - r.curArrears : 0,
    cleared: Math.max(0, r.initCust - r.curCust),
    progress: paired && r.initArrears > 0 ? Math.round(((r.initArrears - r.curArrears) / r.initArrears) * 1000) / 10 : null,
  })).sort((a, b) => b.recovered - a.recovered);
  return { weekday: wd, date: cur.date, paired, rows,
    note: paired ? null : `No matching initial ${wd} deck -- Recovered shows 0 rather than a whole-book figure.` };
}

/** Leader Reports. Per-team numbers answer "how is this team doing"; a leader report answers
    "how is this PERSON doing" -- and most supervisors carry several teams, so their real
    performance is the roll-up across all of them. The same teams therefore appear under a
    different name in each section: one OPM's three teams, one GMO's five, and so on.

    Teams with no one named in a role collect under "(unassigned)" rather than vanishing --
    an unstaffed role is exactly the thing a leader report should make visible. */
async function leaderReports(db, user, _args, nowMs) {
  const tp = await teamProgress(db, user, {}, nowMs);
  const teamRows = await readTeamsAll(db);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;

  const sections = TEAM_ROLE_COLS.map(roleCol => {
    const by = {};
    for (const r of tp.rows) {
      const who = officerOf(teamBy, r.team, roleCol);
      const b = bucket(by, who, { teams: 0, teamList: [], initArrears: 0, curArrears: 0,
        recovered: 0, initCust: 0, curCust: 0, cleared: 0 });
      b.teams++; b.teamList.push(r.team);
      b.initArrears += r.initArrears; b.curArrears += r.curArrears;
      b.recovered += r.recovered; b.initCust += r.initCust; b.curCust += r.curCust;
      b.cleared += r.cleared;
    }
    const rows = Object.values(by).map(b => ({
      leader: b.key, teams: b.teams, teamList: b.teamList.sort().join(', '),
      initArrears: b.initArrears, curArrears: b.curArrears, recovered: b.recovered,
      initCust: b.initCust, curCust: b.curCust, cleared: b.cleared,
      progress: pctOf(b.recovered, b.initArrears),
    })).sort((a, b) => b.recovered - a.recovered);
    const sum = f => rows.reduce((s, r) => s + (r[f] || 0), 0);
    return { role: roleCol, label: roleCol.toUpperCase(), rows,
      totals: { teams: sum('teams'), initArrears: sum('initArrears'), curArrears: sum('curArrears'),
        recovered: sum('recovered'), initCust: sum('initCust'), curCust: sum('curCust'),
        cleared: sum('cleared'), progress: pctOf(sum('recovered'), sum('initArrears')) },
      unstaffed: rows.filter(r => r.leader === '(unassigned)').reduce((s, r) => s + r.teams, 0) };
  }).filter(s => s.rows.length);

  /* A BLANK PAGE IS NOT AN ANSWER. Progress here is measured by comparing THIS weekday's
     initial deck against its current one -- both are needed, and if either is missing there is
     genuinely nothing to show. Saying so is the difference between "the system is broken" and
     "upload the other half of Friday". */
  const why = sections.length ? (tp.note || '')
    : (!tp.rows || !tp.rows.length
        ? `Hakuna deki la ${tp.weekday || 'siku hii'} bado / no deck uploaded for this weekday yet. `
          + 'Progress compares the INITIAL deck against the CURRENT one, so both are needed before anything can be shown.'
        : 'Timu hazina majina ya viongozi / no leader names are set on the teams table, so there is '
          + 'nobody to group these teams under. Fill in the recovery / GMO / manager columns under Teams.');

  return { weekday: tp.weekday, date: tp.date, paired: tp.paired, note: why,
    rows: tp.rows, sections,
    totals: { teams: tp.rows.length,
      initArrears: tp.rows.reduce((s, r) => s + r.initArrears, 0),
      curArrears: tp.rows.reduce((s, r) => s + r.curArrears, 0),
      recovered: tp.rows.reduce((s, r) => s + r.recovered, 0) } };
}

/** My Commission. Commission is earned by PEOPLE, not teams, and it comes from two separate
    jobs that pay on different rules:

      RECOVERY   the Recovery officer of the customer's team earns a PERCENTAGE of whatever
                 that customer's arrears fell by that day. The percentage can be set by
                 disbursement YEAR (older loans pay more so nobody ignores them) or by STATUS
                 (defaulter / expired / chronic) -- CMS_MODE picks which.
      COLLECTION the Expected officer earns a FLAT TZS amount per client who came in PAID or
                 OVERPAID that day (CMS_PAID_TZS / CMS_OVER_TZS).

    Both are computed day by day and summed, never from a week-level total: a customer who
    recovered on Tuesday and slipped back on Thursday earned Tuesday's commission, and a
    week-level subtraction would erase it.

    Officers see only their own row; anyone with settings/upload sees the whole company. */
function cmsPairs(txt) {
  const out = {};
  for (let p of String(txt == null ? '' : txt).split(',')) {
    p = p.trim(); if (!p) continue;
    const m = p.match(/^([A-Za-z0-9*]+)[\s:=-]*([0-9]+(?:\.[0-9]+)?)\s*%?$/);
    if (!m) throw badRequest('Rates must look like "2024:5, 2025:2.5" — could not read "' + p + '".');
    let k = String(m[1]).toUpperCase();
    if (k.startsWith('CHRON')) k = 'CHRONIC';
    else if (k.startsWith('EXPIR')) k = 'EXPIRED';
    else if (k.startsWith('DEFAULT')) k = 'DEFAULTER';
    out[k] = parseFloat(m[2]);
  }
  return out;
}
async function cmsCfg(db) {
  const rows = await fetchAll(() => db.from('settings').select('*'));
  const get = k => { const r = rows.find(x => x.key === k); return r ? r.value : ''; };
  let mode = String(get('CMS_MODE') || 'year');
  if (mode !== 'status') mode = 'year';
  let yearRates = {}, statusRates = {};
  try { yearRates = cmsPairs(get('CMS_YEAR_RATES')); } catch { /* a malformed rate must not break the page */ }
  try { statusRates = cmsPairs(get('CMS_STATUS_RATES')); } catch { /* same */ }
  return { mode, yearRaw: String(get('CMS_YEAR_RATES') || ''), statusRaw: String(get('CMS_STATUS_RATES') || ''),
    yearRates, statusRates,
    paidTzs: num(get('CMS_PAID_TZS')) || 0, overTzs: num(get('CMS_OVER_TZS')) || 0,
    // What an officer is told about WHEN and HOW the money reaches them. A commission figure
    // with no word about payday is the question every officer asks next, and they ask it of
    // somebody rather than of the screen.
    payText: String(get('COMM_PAY_TEXT') || '') };
}
function cmsRateFor(cfg, row) {
  if (cfg.mode === 'status') {
    const s = K(row.status);
    if (s.includes('CHRON')) return cfg.statusRates.CHRONIC || 0;
    if (s.includes('EXPIR')) return cfg.statusRates.EXPIRED || 0;
    return cfg.statusRates.DEFAULTER || 0;
  }
  const y = String(row.disb_date || '').slice(0, 4);
  if (cfg.yearRates[y] != null) return cfg.yearRates[y];
  return cfg.yearRates['*'] || 0;
}
async function commission(db, user, _args, nowMs) {
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs), sun = addDaysKey(mon, 6), fri = addDaysKey(mon, 4);
  const prevMon = addDaysKey(mon, -7), prevFri = addDaysKey(prevMon, 4);
  /* =====================================================================================
     RECOVERY COMMISSION, ON THE DECK RULE AT LAST.

       "Recovery commissions aint adding up though I set values already"

     Two faults, and either one alone kept the figure at zero:

     1. THE PAIRING. This asked for an initial deck and a current deck ON THE SAME
        snapshot_date, inside this week. But that is not how decks arrive: the initial deck
        is uploaded once, when the week's book is drawn up, and the current deck is refreshed
        through the week -- each at its own date. "A deck is a team AND a weekday, each read
        at its own date" is the rule every other screen already follows; this one demanded a
        coincidence and paid nothing when it did not happen.

     2. THE RATE. cmsRateFor rates a row by its STATUS (status mode) or its DISB DATE year
        (year mode) -- and the week read carried NEITHER column, so year mode rated every
        customer at the '*' fallback or zero, whatever the owner had typed into the rates
        box. The values were set; nothing ever read the row fields they apply to.

     Now: the baseline is the initial book (each deck at its own date, rate columns aboard),
     brought forward to the week's start by the last current deck BEFORE Monday -- so
     recovery already banked last week is not paid twice. Then the week's current decks are
     walked date by date: each deck observed is compared against the running state of ITS OWN
     team-and-weekday book, and every positive drop is that day's recovery, at that
     customer's own rate. A customer gone from their deck entirely is fully recovered; a team
     that uploaded nothing that day is simply unobserved, never "all recovered". A customer
     who slips back keeps the commission of the day they recovered, exactly as promised.
     ===================================================================================== */
  const [cfg, teamRows, defWeek, iniBook, preBook, expWeek, codeRows, pmoCfg, prevExp] = await Promise.all([
    cmsCfg(db),
    readTeamsAll(db),
    /* The week's current decks, per customer -- ref to pair, weekday to know which book,
       status and disb_date so a NEW customer first seen mid-week can still be rated. */
    snapshotsInRange(db, 'defaulter_snapshots', { snapshot_type: 'current' }, mon, sun, user.teams,
      WEEK_DEF_COLS + ', ref, status, disb_date'),
    /* The initial book: every team-and-weekday deck at its own date, however old. */
    defaulterBook(db, user, { type: 'initial', notAfter: today,
      columns: 'ref, team, weekday, arrears, status, disb_date, snapshot_date, upload_batch, created_at' }),
    /* Where each book already stood when this week began. */
    defaulterBook(db, user, { type: 'current', notAfter: addDaysKey(mon, -1),
      columns: 'ref, team, weekday, arrears, snapshot_date, upload_batch, created_at' }),
    /* THE COLLECTION SIDE IS PURE ARITHMETIC, so it reads team-day totals like every other
       board. The recovery side above cannot: it works out what each CUSTOMER owed against
       what they still owe, and a team total cannot answer that. */
    expectedTotalsInRange(db, { type: 'today', from: mon, to: fri, teams: user.teams }),
    fetchAll(() => db.from('access_codes').select('name, role, teams')),
    settingsMany(db, [PMO_ROLE_KEY, PMO_BONUS_KEY]),
    /* LAST week, for the bonus condition -- "whoever leads, having beaten the percentage they
       got the previous week". Without last week's figures the condition cannot be checked at
       all, and a bonus awarded without checking it is just a bonus. */
    expectedTotalsInRange(db, { type: 'today', from: prevMon, to: prevFri, teams: user.teams }),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const myDef = scoped(user, defWeek), myExp = scoped(user, expWeek);
  const onDate = (rows, d, type) => pickLatestBatchRows(rows.filter(r =>
    String(r.snapshot_date) === d && (!type || r.snapshot_type === type)));

  const blank = { recovered: 0, recComm: 0, paid: 0, over: 0, colComm: 0 };

  /* The running state of every book: weekday|ref -> what they owed at the last observation,
     plus the row that carries their rate and team. */
  /* Rows with NO TEAM are excluded from the recovery walk on purpose: commission is a payroll
     figure, paid to a team's recovery officer, and a customer filed under no team can pay
     nobody. (The '(unassigned)' bucket still exists -- it is for teams whose recovery ROLE is
     unstaffed, which is a different and fixable fact.) It also keeps the two storage paths --
     database-resolved decks and the in-memory fallback -- answering identically, because a
     deck is a TEAM and a weekday, and a row with no team is in no deck. */
  const running = new Map();
  const bkey = r => K(r.weekday) + '|' + K(r.ref);
  for (const r of scoped(user, iniBook.rows || [])) {
    if (r.ref && r.team) running.set(bkey(r), { arr: num(r.arrears), team: r.team, rate: r });
  }
  for (const r of scoped(user, preBook.rows || [])) {
    if (!r.ref || !r.team) continue;
    const got = running.get(bkey(r));
    if (got) got.arr = num(r.arrears);
    else running.set(bkey(r), { arr: num(r.arrears), team: r.team, rate: r });
  }

  /* Walk the week's current decks in date order. Drops land on the date of the deck that
     showed them, which is what makes "today" a real figure rather than a week share. */
  const recByDay = new Map();                              // date -> officer -> {recovered, recComm}
  for (let i = 0; i < 7; i++) {
    const d = addDaysKey(mon, i);
    if (d > today) break;
    /* Resolved per WEEKDAY then per team (inside pickLatestBatch) -- two different weekday
       decks of the same team can land on the same date in two batches, and picking across
       them would throw one whole deck away. Same order every deck reader uses. */
    const atD = myDef.filter(r => String(r.snapshot_date) === d);
    if (!atD.length) continue;
    const rowsD = [...new Set(atD.map(r => K(r.weekday)))]
      .flatMap(wd => pickLatestBatchRows(atD.filter(r => K(r.weekday) === wd)));
    if (!rowsD.length) continue;
    // A deck is a team AND a weekday: only the books actually uploaded today are observed.
    const decksHere = new Set(rowsD.map(r => K(r.weekday) + '|' + K(r.team)));
    const nowArr = new Map();
    for (const r of rowsD) if (r.ref) nowArr.set(bkey(r), num(r.arrears));
    const acc = recByDay.get(d) || recByDay.set(d, {}).get(d);
    for (const [k, st] of running) {
      const wd = k.slice(0, k.indexOf('|'));
      if (!decksHere.has(wd + '|' + K(st.team))) continue;      // this book was not observed today
      const cur = nowArr.has(k) ? nowArr.get(k) : 0;            // gone from the deck = recovered
      const drop = st.arr - cur;
      st.arr = cur;
      if (drop <= 0) continue;
      const b = bucket(acc, officerOf(teamBy, st.team, 'recovery'), blank);
      b.recovered += drop;
      b.recComm += drop * cmsRateFor(cfg, st.rate) / 100;
    }
    // First seen mid-week (no initial ever uploaded): enters the book, nothing attributed yet.
    for (const r of rowsD) {
      if (r.ref && r.team && !running.has(bkey(r))) running.set(bkey(r), { arr: num(r.arrears), team: r.team, rate: r });
    }
  }

  function colDay(dateKey, acc) {
    for (const r of onDate(myExp, dateKey)) {
      const paid = num(r.paid_n), over = num(r.over_n);
      if (!paid && !over) continue;
      const b = bucket(acc, officerOf(teamBy, r.team, 'expected'), blank);
      b.paid += paid; b.over += over;
      b.colComm += paid * cfg.paidTzs + over * cfg.overTzs;
    }
  }
  const dayAcc = {}, weekAcc = {};
  const foldRec = (acc, src) => { for (const [name, v] of Object.entries(src || {})) {
    const b = bucket(acc, name, blank); b.recovered += v.recovered; b.recComm += v.recComm;
  } };
  foldRec(dayAcc, recByDay.get(today));
  for (const [, src] of recByDay) foldRec(weekAcc, src);
  colDay(today, dayAcc);
  for (let i = 0; i < 5; i++) colDay(addDaysKey(mon, i), weekAcc);

  const isAdmin = (user.tabs || []).includes('upload') || (user.tabs || []).includes('settings');
  const pack = acc => Object.values(acc)
    .filter(b => isAdmin || K(b.key) === K(user.name))
    .map(b => ({ officer: b.key, recovered: b.recovered, recComm: Math.round(b.recComm),
      paid: b.paid, over: b.over, colComm: Math.round(b.colComm),
      total: Math.round(b.recComm + b.colComm) }))
    .sort((a, b) => b.total - a.total);

  const day = pack(dayAcc), week = pack(weekAcc);

  /* ---- PMO COLLECTION: paid on the percentage, and nothing else ---- */
  const pmoRoleName = pmoCfg.get(PMO_ROLE_KEY, PMO_ROLE_DEFAULT);
  const bonusTzs = pmoCfg.num(PMO_BONUS_KEY, 0);
  const pmoRoster = codeRows
    .filter(c => isPmoRole(c.role, pmoRoleName))
    .filter(c => c.teams && c.teams.length)
    .filter(c => !user.teams || c.teams.some(t => teamAllowed(user, t)))
    .map(c => ({ name: c.name, teams: c.teams }));
  const pmoDays = WD5.map((_w, i) => addDaysKey(mon, i));
  const byDay = new Map();
  for (const d of pmoDays) byDay.set(d, onDate(myExp, d));
  byDay.set(today, onDate(myExp, today));
  const pmoRows = pmoBoard(pmoRoster, byDay, today, pmoDays);

  /* Last week's percentage per officer, so "beat your own previous week" can be checked rather
     than assumed. Same computation, a week earlier. */
  const prevMine = scoped(user, prevExp);
  const prevByDay = new Map();
  const prevDays = WD5.map((_w, i) => addDaysKey(prevMon, i));
  for (const d of prevDays) prevByDay.set(d, pickLatestBatchRows(prevMine.filter(r => String(r.snapshot_date) === d)));
  const prevRows = pmoBoard(pmoRoster, prevByDay, prevDays[0], prevDays);
  const prevPct = {};
  for (const r of prevRows) prevPct[K(r.officer)] = r.weekPct;

  /* THE WEEKLY BONUS: to whoever leads the week, AND ONLY IF they beat their own previous
     week. Both halves matter -- leading a week that was worse than your own last one is not
     what the plan rewards. An officer with no previous week to compare against (their first
     week, or a week with no uploads) cannot have beaten it, so they do not qualify; that is
     the cautious direction, and it is said on screen rather than left to be wondered about. */
  const ranked = pmoRows.filter(r => r.weekPct != null);
  const leader = ranked.length ? ranked[0] : null;
  const leaderPrev = leader ? prevPct[K(leader.officer)] : null;
  const bonusWon = !!(leader && leaderPrev != null && leader.weekPct > leaderPrev);
  const pmo = pmoRows.map(r => ({ ...r,
    prevWeekPct: prevPct[K(r.officer)] == null ? null : prevPct[K(r.officer)],
    isLeader: !!(leader && K(r.officer) === K(leader.officer)),
    bonus: (bonusWon && leader && K(r.officer) === K(leader.officer)) ? bonusTzs : 0,
    // Only an admin sees everybody's money; an officer sees their own, exactly as the
    // recovery and collection boards above already work.
  })).filter(r => isAdmin || K(r.officer) === K(user.name));

  /* WHY IS THIS BOARD EMPTY? A screen that shows nothing and says nothing sends somebody to
     the telephone. The two ways it can legitimately be empty are "no access code carries that
     role" and "the codes that do carry it have no teams", and they need different fixes -- so
     the answer says which, and lists the roles that ARE in use so a spelling can be compared
     rather than guessed at. */
  const pmoDiag = {
    roleWanted: pmoRoleName,
    withRole: codeRows.filter(c => isPmoRole(c.role, pmoRoleName)).length,
    withTeams: pmoRoster.length,
    rolesSeen: [...new Set(codeRows.map(c => String(c.role || '').trim()).filter(Boolean))].sort(),
  };

  const pmoDay = pmo.reduce((s, r) => s + num(r.commission), 0);
  const pmoWeek = pmo.reduce((s, r) => s + num(r.weekCommission) + num(r.bonus), 0);

  return { mode: cfg.mode, yearRates: cfg.yearRaw, statusRates: cfg.statusRaw,
    pmo, pmoDiag, pmoBands: PMO_BANDS, pmoRole: pmoRoleName,
    pmoBonus: { tzs: bonusTzs, set: bonusTzs > 0, won: bonusWon,
      leader: leader ? leader.officer : null,
      leaderPct: leader ? leader.weekPct : null, leaderPrevPct: leaderPrev,
      why: !leader ? 'hakuna takwimu za wiki hii / no figures for this week yet'
        : leaderPrev == null ? 'hakuna wiki iliyopita ya kulinganisha / no previous week to compare against'
        : bonusWon ? null : 'kiongozi hajapita asilimia yake ya wiki iliyopita / the leader has not beaten their own previous week' },
    pmoTotals: { day: pmo.reduce((s, r) => s + r.commission, 0),
      week: pmo.reduce((s, r) => s + r.weekCommission + r.bonus, 0) },
    paidTzs: cfg.paidTzs, overTzs: cfg.overTzs, payText: cfg.payText, isAdmin, me: user.name,
    weekday: currentWeekday(nowMs), date: today, weekOf: mon,
    day, week,
    /* THE COMPANY TOTAL HAD A WHOLE BOARD MISSING FROM IT.

         "the total collected commissions aint computing for several roles"

       Three schemes pay commission on this screen, and they pay three different people:

         RECOVERY   the recovery officer, a percentage of what each customer's arrears fell by
         EARLY      the early-collection officer, a flat amount per PAID and per OVERPAID
         PMO        the PMO collection officer, a band percentage on the week, plus the bonus

       The headline added up only the first two. The PMO board was computed, printed lower down
       the same screen, and then left out of the number at the top -- so "company total" was
       short by an entire category of officer, and the more the PMO side earned the more wrong
       it got. Nobody could see it, because the figure it should have equalled was three boards
       further down the page.

       The three are DIFFERENT PEOPLE ON DIFFERENT SCHEMES, so adding them is a total, not a
       double count. The split is sent beside it so a figure that looks wrong can be taken
       apart on screen instead of in somebody's head. */
    totals: {
      day: day.reduce((s, r) => s + r.total, 0) + pmoDay,
      week: week.reduce((s, r) => s + r.total, 0) + pmoWeek,
      recovered: day.reduce((s, r) => s + r.recovered, 0),
      split: {
        recDay: day.reduce((s, r) => s + r.recComm, 0),
        colDay: day.reduce((s, r) => s + r.colComm, 0),
        pmoDay,
        recWeek: week.reduce((s, r) => s + r.recComm, 0),
        colWeek: week.reduce((s, r) => s + r.colComm, 0),
        pmoWeek,
      },
    } };
}
/** The rate editor lives on the commission page itself, so cause and effect are one click
    apart -- typing a rate and seeing the numbers move is the whole point. */
async function commissionSave(db, user, p) {
  requireAdmin(user);
  const set = async (key, value) => {
    const { error } = await db.from('settings').upsert({ key, value: String(value == null ? '' : value) }, { onConflict: 'key' });
    noteSettingsWritten(db);
    if (error) throw new Error(error.message);
  };
  const out = {};
  if (p.mode != null) { out.mode = String(p.mode) === 'status' ? 'status' : 'year'; await set('CMS_MODE', out.mode); }
  // Validate BEFORE writing anything: a malformed year list must not half-save.
  if (p.yearRates != null) { cmsPairs(p.yearRates); out.yearRates = String(p.yearRates); }
  if (p.statusRates != null) { cmsPairs(p.statusRates); out.statusRates = String(p.statusRates); }
  if (out.yearRates != null) await set('CMS_YEAR_RATES', out.yearRates);
  if (out.statusRates != null) await set('CMS_STATUS_RATES', out.statusRates);
  if (p.paidTzs != null) { out.paidTzs = Math.max(0, num(p.paidTzs) || 0); await set('CMS_PAID_TZS', out.paidTzs); }
  if (p.overTzs != null) { out.overTzs = Math.max(0, num(p.overTzs) || 0); await set('CMS_OVER_TZS', out.overTzs); }
  /* THE WEEKLY BONUS BELONGS WHERE THE RATES ARE.
     The rule was built and the amount left deliberately unset, to be typed into Settings under
     PMO_WEEKLY_BONUS -- which meant the one person deciding what a week is worth had to leave
     the board showing it, find a raw key by name, and type a number with no context beside it.
     Every other rate on this panel is set here; this is a rate. */
  if (p.weeklyBonus != null) {
    out.weeklyBonus = Math.max(0, num(p.weeklyBonus) || 0);
    await set(PMO_BONUS_KEY, out.weeklyBonus);
  }
  // The payout note officers read under their own figure. Capped so a settings box cannot
  // become a place to paste a page of text onto everybody's commission screen.
  if (p.payText != null) { out.payText = String(p.payText).slice(0, 300); await set('COMM_PAY_TEXT', out.payText); }
  return out;
}

/** The rotation engine: which supervisory ROLE owns a defaulter right now, and therefore
    which named person on their team. Ported from assignFor_/assignStrategy_ in Code.gs --
    the escalation policy is a business decision, so every parameter lives in settings:

      ACTIVE  (still within term)  -> rotate ASSIGN_ACTIVE  every ASSIGN_BUCKET_DAYS days
      EXPIRED (past expiry)        -> step   ASSIGN_EXPIRED  one role per week, then hold
      CHRONIC (past grace weeks)   -> rotate ASSIGN_CHRONIC  weekly, forever

    Recycling a customer between BIKE / MANAGER / GMO is the whole point: the same officer
    calling the same person every week stops working, so ownership moves on a clock. */


/** Defaulter Assignment: the current deck, each customer routed to the role that owns them
    this week and named against that team's actual person, joined to whoever last followed
    up -- so a leader sees both who SHOULD be calling and whether anyone HAS. */
async function assignments(db, user, _args, nowMs) {
  const [snap, fu, teamRows, strat] = await Promise.all([
    defaulterBook(db, user, { type: 'current', notAfter: todayKey(nowMs) }),
    /* SCOPED AT THE DATABASE, like every other read in this system. This one was not: an
       officer with one team read the follow-up register for all forty and threw away
       thirty-nine. `team` is stored uppercase on every write path, so this matches exactly
       what the JS filter downstream would have kept -- it just no longer downloads the rest. */
    fetchAll(() => {
      let q = db.from('followup_status').select('ref, fu_status, comment_by, comment_at, promise_date, team');
      if (user.teams && user.teams.length) q = q.in('team', upperTeams(user.teams));
      return q;
    }),
    readTeamsAll(db),
    assignStrategy(db),
  ]);
  const byRef = {};
  for (const f of fu) byRef[String(f.ref)] = f;
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;

  const rows = scoped(user, snap.rows).map(r => {
    const f = byRef[String(r.ref)] || {};
    const a = assignFor(r, strat, nowMs);
    const team = teamBy[K(r.team)] || {};
    const leader = team[ROLE_COLS[a.role]] || '';
    return { ref: r.ref, full_name: r.full_name, contact: r.contact, guarantor_contact: r.guarantor_contact,
      team: r.team, branch: team.branch || null, arrears: num(r.arrears), status: r.status, ds: r.ds, dc: r.dc,
      days_elapsed: r.days_elapsed, phase: a.phase, role: a.role, cycle: a.label,
      leader: leader || '(unassigned)', assigned: !!leader,
      fu_status: f.fu_status || '', officer: f.comment_by || '', touched_at: f.comment_at || '',
      promise_date: f.promise_date || '' };
  }).sort((a, b) => b.arrears - a.arrears);

  const untouched = rows.filter(r => !r.fu_status);
  const byRole = {}, byLeader = {};
  for (const r of rows) {
    if (!byRole[r.role]) byRole[r.role] = { role: r.role, customers: 0, arrears: 0, touched: 0 };
    byRole[r.role].customers++; byRole[r.role].arrears += r.arrears; if (r.fu_status) byRole[r.role].touched++;
    const k = r.leader;
    if (!byLeader[k]) byLeader[k] = { leader: k, role: r.role, customers: 0, arrears: 0, touched: 0 };
    byLeader[k].customers++; byLeader[k].arrears += r.arrears; if (r.fu_status) byLeader[k].touched++;
  }
  return { date: snap.date, weekday: currentWeekday(nowMs), rows, count: rows.length,
    untouched: untouched.length, untouchedArrears: untouched.reduce((s, r) => s + r.arrears, 0),
    unassigned: rows.filter(r => !r.assigned).length,
    strategy: strat,
    byRole: Object.values(byRole).sort((a, b) => b.arrears - a.arrears),
    byLeader: Object.values(byLeader).sort((a, b) => b.arrears - a.arrears) };
}

/** Credit Analysts. An analyst is judged on their COUNT 1-6 book -- defaulters who have paid
    fewer than 6 of 12 installments, i.e. have not yet passed the halfway mark and are still
    winnable -- and on sales. Each customer in that book lands in one of four states measured
    Monday-initial vs current:

      Cleared  gone from the current deck, or nothing left owing
      Reduced  arrears fell
      Bad      arrears rose
      Static   arrears unchanged

    Success % = (cleared + reduced) ÷ count 1-6, and Overall % averages success with sales %,
    which is the single number the analyst is ranked on. The analyst for a customer is the
    CREDIT column of their team, so a reassignment in Teams & Staff re-points this too.

    The weekly SCORECARD is anchored to Monday's initial deck on purpose -- "progress since
    Monday" only means something against a fixed weekly baseline. The PORTFOLIO list below is
    built from TODAY's current deck instead, because that is who the analyst has to call
    today: someone who started defaulting on Wednesday must appear, and someone who cleared on
    Tuesday must not. */
const CREDIT_HALF = 6;
function creditState(initArr, curArr, inCurrent) {
  if (!inCurrent || curArr <= 0) return 'Cleared';
  if (curArr < initArr) return 'Reduced';
  if (curArr > initArr) return 'Bad';
  return 'Static';
}
async function credit(db, user, _args, nowMs) {
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs);
  const wd = currentWeekday(nowMs);
  const [teamRows, curSnap, monSnap, todaySnap, loansAll] = await Promise.all([
    readTeamsAll(db),
    /* EVERY DECK, ONE ROW PER CUSTOMER. The credit book pairs current against initial BY REF
       -- customer by customer -- so the weekday pin never protected the arithmetic here; it
       only hid analysts' customers whose deck happened to be filed under another day. */
    defaulterBook(db, user, { type: 'current', notAfter: today }),
    defaulterBook(db, user, { type: 'initial', onDate: mon }),
    defaulterBook(db, user, { type: 'initial', notAfter: today }),
    fetchAll(() => onTeams(db.from('loans').select('team, approved_date, approved_by, created_by, principal_amt, loan_amt').in('stage', SALES_STAGES), user.teams)),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  /* ANALYSTS ARE NAMED, NEVER NUMBERED.

       "I also wanted to display credit analysts by their names everywhere since they are in
        the teams and staff table, dont use IDs in the approved report"
       "so even remove the credit id column in teams and staff - not using it"

     The names live in ONE place -- the credit column of Teams & Staff -- and that is the only
     place any screen reads them from. An approvals file that happens to name the analyst in
     words is honoured when those words match somebody on that list; anything else (a bare ID,
     a code nobody recognises) falls to the team's own credit officer. No screen in this
     system prints an analyst ID at any point. */
  const analystNames = {};
  for (const t of teamRows || []) {
    if (t.credit) analystNames[K(t.credit)] = String(t.credit).trim();
  }
  const analystOf = team => officerOf(teamBy, team, 'credit');
  /** The analyst a loan belongs to: the file's own words when they name a known analyst,
      otherwise the team's credit officer. Never an ID, never the customer-care agent. */
  const analystForLoan = l => analystNames[K(l.approved_by || '')] || analystOf(l.team);

  const defCur = scoped(user, curSnap.rows);
  // Until Monday's baseline is uploaded, fall back to today's initial rather than showing nothing.
  const defIni = monSnap.rows.length ? scoped(user, monSnap.rows) : scoped(user, todaySnap.rows);

  const curArrBy = {}, curPaidBy = {}, inCur = {};
  for (const d of defCur) { const k = K(d.ref); curArrBy[k] = num(d.arrears); curPaidBy[k] = paidCount(d); inCur[k] = true; }
  const iniArrBy = {};
  for (const d of defIni) iniArrBy[K(d.ref)] = num(d.arrears);

  const A = {};
  const ga = name => bucket(A, name, { teams: {}, cnt: 0, cntCur: 0, cleared: 0, reduced: 0, bad: 0, stat: 0,
    recovered: 0, sales: 0, salesCnt: 0 });
  for (const d of defIni) {
    if (paidCount(d) >= CREDIT_HALF) continue;
    const k = K(d.ref), initA = num(d.arrears);
    const cur = inCur[k] ? curArrBy[k] : 0;
    const st = creditState(initA, cur, !!inCur[k]);
    const a = ga(analystOf(d.team));
    if (d.team) a.teams[K(d.team)] = String(d.team).trim();
    a.cnt++;
    if (inCur[k]) a.cntCur++;
    if (st === 'Cleared') a.cleared++; else if (st === 'Reduced') a.reduced++; else if (st === 'Bad') a.bad++; else a.stat++;
    a.recovered += Math.max(0, initA - cur);
  }
  /* A SALE BELONGS TO THE ANALYST WHO APPROVED IT.

       "I also wanted to display credit analysts by their names everywhere since they are in
        the teams and staff table, dont use IDs in the approved report"

     nameForId above was written for exactly this and then never called -- the comment
     described the rule while the code below credited every sale to whoever happens to hold
     the team's credit column today. So an analyst who approved a loan on another team's book
     saw it counted against a colleague, and a reassignment silently moved history.

     The approval itself decides now, and it is shown BY NAME: the ID in the file resolved
     through the CREDIT ID beside that analyst in Teams & Staff, then the team's own credit
     officer, then the raw ID rather than dropping a real sale. The same chain the dashboard
     board uses, so the two screens cannot disagree.

     The defaulter loop above is deliberately left on the team: a customer in the count 1-6
     book belongs to the team that carries them, not to whoever approved them long ago. */
  /* A SALE BELONGS TO THE ANALYST WHO APPROVED IT, named from Teams & Staff. The defaulter
     loop above stays on the TEAM: a customer in the count 1-6 book belongs to the team that
     carries them now, not to whoever approved them long ago. */
  for (const l of scoped(user, loansAll)) {
    const a = ga(analystForLoan(l));
    a.sales += num(l.principal_amt) || num(l.loan_amt); a.salesCnt++;
  }

  const perTarget = await settingNum(db, 'SALES_TARGET_WEEKLY', await settingNum(db, 'SALES_TARGET', 100000000));
  const rows = Object.values(A).map(a => {
    const teamList = Object.values(a.teams).filter(Boolean);
    const success = pctOf(a.cleared + a.reduced, a.cnt);
    const salesPct = pctOf(a.sales, perTarget * Math.max(teamList.length, 1));
    return { analyst: a.key, teams: teamList.length, teamList: teamList.join(', '),
      cnt: a.cnt, cntCur: a.cntCur, cleared: a.cleared, reduced: a.reduced, stat: a.stat, bad: a.bad,
      recovered: a.recovered, sales: a.sales, salesCnt: a.salesCnt, success, salesPct,
      overall: Math.round(((success || 0) + (salesPct || 0)) / 2 * 10) / 10 };
  }).filter(r => r.cnt > 0 || r.sales > 0).sort((a, b) => b.overall - a.overall);

  const avgOverall = rows.length ? Math.round(rows.reduce((s, r) => s + r.overall, 0) / rows.length * 10) / 10 : 0;
  for (const r of rows) r.below = r.overall < avgOverall;

  const portfolio = defCur.filter(d => paidCount(d) < CREDIT_HALF).map(d => {
    const k = K(d.ref), cur = num(d.arrears);
    // No Monday record means new this week -- 0 recovered rather than silently dropped.
    const initA = Object.prototype.hasOwnProperty.call(iniArrBy, k) ? iniArrBy[k] : cur;
    return { ref: d.ref, full_name: d.full_name, team: d.team, branch: (teamBy[K(d.team)] || {}).branch || null, contact: d.contact,
      /* THE GUARANTOR, which is who an officer rings when the customer will not answer -- and
         was the one column missing from a list whose entire purpose is ringing people. */
      guarantor_name: d.guarantor_name, guarantor_contact: d.guarantor_contact,
      analyst: analystOf(d.team), paid: curPaidBy[k], initArr: initA, curArr: cur,
      recovered: Math.max(0, initA - cur), state: creditState(initA, cur, true) };
  }).sort((a, b) => b.recovered - a.recovered);

  const tot = { cnt: 0, cntCur: 0, cleared: 0, reduced: 0, bad: 0, stat: 0, recovered: 0, sales: 0 };
  for (const r of rows) for (const f of Object.keys(tot)) tot[f] += r[f] || 0;
  const teamCount = Math.max(Object.keys(teamBy).length, 1);
  tot.success = pctOf(tot.cleared + tot.reduced, tot.cnt);
  tot.salesPct = pctOf(tot.sales, perTarget * teamCount);
  tot.overall = Math.round(((tot.success || 0) + (tot.salesPct || 0)) / 2 * 10) / 10;

  return { rows, portfolio, count: rows.length, totals: tot, avgOverall, perTarget, teamCount,
    threshold: CREDIT_HALF - 1, baselineDate: monSnap.rows.length ? monSnap.date : todaySnap.date,
    usedMondayBaseline: monSnap.rows.length > 0,
    hasInitial: defIni.length > 0, hasCurrent: defCur.length > 0,
    analystCount: rows.filter(r => r.cnt > 0).length,
    analysts: [...new Set(portfolio.map(p => p.analyst))].sort() };
}

/* =====================================================================================
   BULK SMS EXPORT -- one Excel sheet, shaped for the outside SMS gateway this company
   already pastes a mail-merge sheet into.

     "we always have an external service to bulk sms our customers that require preparing
      an excel sheet, so I wish I always get it automatic from system too... The excel for
      bulk sms must start with the 2 columns named Contact No Contact Person exactly"

   TWO AUDIENCES, chosen by the caller:
     'defaulters'  every current defaulter, once each.
     'portfolio'   defaulters FIRST, then this week's Expected (Monday-Friday) who are not
                   already a defaulter, deduplicated by ref -- "the excel has some Monday to
                   Friday expected who were already in defaulters so add with data cleanup by
                   ref no, then the rest who weren't defaulters".

   SIX COLUMNS, FIXED:
     A  Contact No       the customer's own phone -- what the gateway sends to.
     B  Contact Person   the customer's name -- "so calling customer name is #b#".
     C  Team             not named in the request -- the one column between B and the D/E/F
                          the owner DID name (ref, arrears, HOPE phone), so it carries the
                          team rather than sitting blank. Easy to drop in the download if it
                          turns out not to be wanted.
     D  Ref No            "I placed ref nos in d"
     E  Arrears            "arreas in e"
     F  HOPE Phone No      "our hope phone numbers at F" -- ROUTED, not copied from one column.

   THE ROUTING ("1-6" is paidCount < CREDIT_HALF; "the rest" is everyone past it) -- EVERY
   bucket is a CHAIN of team columns tried in order, PMO_RECOVERY_NO only ever the very last
   resort, never the first answer: "not first, there is no company wide, each team must have
   one, if no recovery officer at all default to collection officer".
     defaulter,     1-6    -> the customer's team's CREDIT analyst
     defaulter,     rest   -> the team's RECOVERY officer, else the team's COLLECTION officer
     expected-only, 1-6    -> the customer's team's EARLY COLLECTION officer
     expected-only, rest   -> the customer's team's COLLECTION officer
   Only once EVERY column in the chain is blank for that team does a row fall through to
   PMO_RECOVERY_NO rather than an empty cell -- the same fallback demandContact already uses,
   for the same reason: a message naming nobody is worse than one naming the PMO, but a
   TEAM'S OWN officer is always tried first. */
/** Which HOPE numbers a row routes to, IN ORDER, named rather than resolved -- shared by
    smsBuild_'s row-building (which turns the chain into an actual number, falling back to
    PMO_RECOVERY_NO only once every link is blank) and its gap-checking (which asks whether the
    team has ANY link covered before ever reporting a gap). The first name in the chain is what
    smsGaps prompts for when nothing in the chain is on file -- the "proper" officer for that
    bucket, not whichever one happens to fill the gap. */
/** The four chains, in a fixed order -- every row's HOPE Phone comes from exactly one of
    these, chosen by smsBucketFor. Numbered, not named, because the NUMBER is what travels back
    to the client alongside each row (see smsBuild_'s own comment on why): four short integers
    repeated 9,000-odd times cost nothing, four copies of ['recovery','collection'] would not
    be much more, but a resolved phone string recomputed by a second server round trip is
    exactly the cost this whole scheme exists to avoid paying twice. */
const SMS_BUCKET_CHAINS = [
  ['credit'],                    // 0: defaulter, 1-6 paid
  ['recovery', 'collection'],    // 1: defaulter, rest -- team's own recovery, else its collection officer
  ['expected'],                  // 2: expected-only, 1-6 paid
  ['collection'],                // 3: expected-only, rest
];
function smsBucketFor(r, isDefaulter) {
  const winnable = paidCount(r) < CREDIT_HALF;
  if (isDefaulter) return winnable ? 0 : 1;
  return winnable ? 2 : 3;
}
const SMS_ROLE_LABEL = { credit: 'Credit Analyst', recovery: 'Recovery Officer', expected: 'Early Collection', collection: 'Collection Officer' };

/** ONE FETCH FOR THE DOWNLOAD, AND NEVER A SECOND ONE FOR A FIX.
    The first cut of this had smsExport and smsGaps each doing their own Promise.all of
    readTeamsAll + defaulterBook + the PMO setting, so the Upload page's "check, then download"
    made the defaulter book pay for itself twice in a row -- fine on a small book, but "error
    504" on the real one (9,297 rows): the second fetch alone was enough to walk the sixty-second
    function budget off the edge. Merging that into one pass (both callers below share it; rows
    and gaps come out of the same loop) fixed the plain download.

    It did NOT fix "Save & download" in the gap-fill form, which pressed the exact same button a
    second time after saving new numbers -- so it paid for the whole defaulter book AGAIN, in a
    fresh request with its own fresh 60s clock, and "error 504" came right back the moment
    someone actually used the feature it was built for.

    Fetching the book again was never necessary: filling a gap changes a handful of numbers on
    teams, a small table, not one row of the defaulter book itself. So smsExport now sends back
    exactly enough for the Upload page to re-resolve the HOPE Phone column ON THE CLIENT after a
    save -- the bucket each row belongs to (an index into SMS_BUCKET_CHAINS) and the phone
    numbers of every team involved -- and "Save & download" recomputes column F in the browser,
    in a loop over rows already sitting in memory, and downloads. No second request, so nothing
    left to time out. */
async function smsBuild_(db, user, { audience = 'defaulters' } = {}, nowMs) {
  const today = todayKey(nowMs);
  const [teamRows, book, pmoNoRaw] = await Promise.all([
    readTeamsAll(db),
    // Narrowed to what routing and the six export columns actually read -- '*' (every column
    // defaulter_snapshots has, guarantor and disbursement details included) was being fetched
    // and parsed for 9,297 rows to use six of its fields, on the one request left that still
    // has to pay for the whole book.
    defaulterBook(db, user, { type: 'current', notAfter: today,
      columns: 'ref, team, weekday, full_name, contact, arrears, ds' }),
    settingGet(db, 'PMO_RECOVERY_NO'),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const pmo = pmoNoRaw ? String(pmoNoRaw).trim() : '';

  const rawNumberFor = (team, role) => {
    const t = teamBy[K(team)] || {};
    const col = TEAM_PHONE_OF[role];
    return col && t[col] ? String(t[col]).trim() : '';
  };
  /** The chain, tried in order; PMO_RECOVERY_NO only once every link in it is blank. */
  const resolveChain = (team, chain) => {
    for (const role of chain) { const v = rawNumberFor(team, role); if (v) return v; }
    return pmo;
  };

  let pmoNeeded = false;
  const gapBy = new Map();       // "TEAM|primaryRole" -> { team, role, name }
  const noteGap = (r, chain) => {
    if (chain.some(role => rawNumberFor(r.team, role))) return;   // some link in the chain covers this row
    const primary = chain[0];
    const t = teamBy[K(r.team)] || {};
    const key = K(r.team) + '|' + primary;
    if (!gapBy.has(key)) gapBy.set(key, { team: r.team, role: primary, name: (t[primary] && String(t[primary]).trim()) || '' });
    if (!pmo) pmoNeeded = true;   // nothing in the chain AND no company backstop -- this row would be blank
  };
  const teamPhonesOut = {};    // TEAM -> { credit_no, recovery_no, expected_no, collection_no }, only teams a row touches
  const notePhones = team => {
    if (teamPhonesOut[team]) return;
    const t = teamBy[K(team)] || {};
    const slot = {};
    for (const role of ['credit', 'recovery', 'expected', 'collection']) {
      const col = TEAM_PHONE_OF[role];
      if (t[col]) slot[col] = String(t[col]).trim();
    }
    teamPhonesOut[team] = slot;
  };
  const buckets = [];           // parallel to `out`, one SMS_BUCKET_CHAINS index per row
  const rowFor = (r, isDefaulter) => {
    const bucket = smsBucketFor(r, isDefaulter);
    const chain = SMS_BUCKET_CHAINS[bucket];
    noteGap(r, chain);
    notePhones(r.team);
    buckets.push(bucket);
    const phone = resolveChain(r.team, chain);
    /* "our customers aint demanded decimals, all amounts sent in the messages must be capped
       500" -- 45,333 reads as 45,500 in the text, 67,800 as 68,000, and a figure already an
       exact multiple of 500 (50,000) is left alone. Same roundUp500 the legal demand notice
       already rounds a total to, so the arrears a customer is TOLD on the phone/SMS and the
       arrears a demand notice prints are never two different roundings of the same number. */
    return [r.contact || '', r.full_name || '', r.team || '', r.ref || '', roundUp500(r.arrears), phone];
  };

  const out = [];
  const seen = new Set();
  for (const r of scoped(user, book.rows)) {
    const k = K(r.ref);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(rowFor(r, true));
  }

  if (audience === 'portfolio') {
    const mon = weekMondayKey(nowMs), fri = addDaysKey(mon, 4);
    const expRaw = await fetchAll(() => onTeams(db.from('repayment_snapshots')
      .select(withBatchKeys(EXPECTED_TAB_COLS + ', snapshot_date')).eq('snapshot_type', 'today')
      .gte('snapshot_date', mon).lte('snapshot_date', fri), user.teams));
    const byDay = {};
    for (const r of scoped(user, expRaw)) (byDay[r.snapshot_date] || (byDay[r.snapshot_date] = [])).push(r);
    for (const d of Object.keys(byDay)) {
      for (const r of pickLatestBatchRows(byDay[d])) {
        const k = K(r.ref);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(rowFor(r, false));
      }
    }
  }

  const teamGaps = [...gapBy.values()]
    .map(g => ({ team: g.team, role: g.role, roleLabel: SMS_ROLE_LABEL[g.role],
      nameField: g.role, phoneField: TEAM_PHONE_OF[g.role], name: g.name }))
    .sort((a, b) => a.team.localeCompare(b.team) || a.role.localeCompare(b.role));

  return { rows: out, buckets, teamPhones: teamPhonesOut, pmo,
    gaps: { pmoNeeded, pmoNo: pmo, teamGaps, count: teamGaps.length + (pmoNeeded ? 1 : 0) } };
}

/** THE DOWNLOAD ITSELF -- and, riding along in the same single pass, the same GAPS smsGaps
    reports on its own, and the bucket/teamPhones ingredients the Upload page needs to fix a
    gap WITHOUT a second request (see smsBuild_'s own comment above for why that matters). */
async function smsExport(db, user, { audience = 'defaulters' } = {}, nowMs) {
  const { rows, buckets, teamPhones, pmo, gaps } = await smsBuild_(db, user, { audience }, nowMs);
  return {
    audience, count: rows.length,
    headers: ['Contact No', 'Contact Person', 'Team', 'Ref No', 'Arrears', 'HOPE Phone No'],
    rows, buckets, teamPhones, pmo, gaps,
  };
}

/** THE SAME GAPS, ON THEIR OWN. "the sms file should promt to input no of a user role and name
    if not present so that to save it and make sure all clients go with numbers" -- the fallback
    in smsExport (a role with no number recorded falls to PMO_RECOVERY_NO) keeps the column from
    ever being BLANK, but a sheet where half the "HOPE Phone" column is really just the same PMO
    number standing in for a missing credit analyst is not what was asked for. Kept as its own
    dispatched function for anything that wants the gap list without the six-column export
    riding along -- the Upload page itself no longer calls this before a download; it reads
    .gaps off smsExport's own response instead, for the reason smsBuild_ explains above. */
async function smsGaps(db, user, { audience = 'defaulters' } = {}, nowMs) {
  const { gaps } = await smsBuild_(db, user, { audience }, nowMs);
  return { audience, ...gaps };
}

/** Call agents -- the CUSTOMER SERVICE agents named on loan applications, not the HOPE Calls
    app users. Each application in the Unassigned and Assigned reports carries a CREATED BY
    agent id, and this counts what each of them brought in. The per-agent PHONE statistics are
    a different question entirely and live on the Call Reports tab.

    Only TRACK# 1 customers count. A track of 2 or more is a repeat customer, and an agent did
    not win that application -- crediting it would reward the same relationship twice. A blank
    track counts, because the earliest reports had no such column. */
const CS_STAGES = ['unassigned', 'assigned'];
function isTrack1(r) {
  const v = r.track_no;
  if (v == null || String(v).trim() === '') return true;
  return (num(v) || 0) < 2;
}
async function callAgents(db, user) {
  const [loanRows, agentRows] = await Promise.all([
    fetchAll(() => db.from('loans').select('team, stage, track_no, created_by, principal_amt, loan_amt, requested_amt').in('stage', CS_STAGES)),
    fetchAll(() => db.from('call_agents').select('*').order('user_id', { ascending: true })),
  ]);
  const names = {};
  for (const a of agentRows) names[K(a.user_id)] = a.names || '';
  const by = {};
  for (const l of scoped(user, loanRows)) {
    if (!isTrack1(l)) continue;
    const id = String(l.created_by || '').trim() || '—';
    const b = bucket(by, K(id), { id, unassigned: 0, assigned: 0, amount: 0 });
    if (l.stage === 'assigned') b.assigned++; else b.unassigned++;
    b.amount += num(l.requested_amt) || num(l.principal_amt);
  }
  const rows = Object.values(by).map(b => ({ id: b.id, names: names[b.key] || '',
    unassigned: b.unassigned, assigned: b.assigned, total: b.unassigned + b.assigned,
    amount: b.amount })).sort((a, b) => b.total - a.total);
  const sum = f => rows.reduce((s, r) => s + r[f], 0);
  return { rows, count: rows.length, agents: agentRows,
    totals: { unassigned: sum('unassigned'), assigned: sum('assigned'),
      total: sum('total'), amount: sum('amount') },
    // An id that appears on applications but is not in the roster shows as bare id, which is
    // the signal to add them rather than a reason to hide the row.
    unnamed: rows.filter(r => !r.names && r.id !== '—').map(r => r.id) };
}
/** Removing a complaint entirely. Every other register can lose a row -- teams, roles, access
    codes, officer accounts, call agents -- and this one could not, so a complaint logged
    against the wrong customer stayed in the register and in every count built off it.

    Admin only, and the audit trail is written BEFORE the row goes: what was deleted, by whom,
    and when. A register you can quietly empty is not a register. */
async function deleteComplaint(db, user, p = {}, nowMs = Date.now()) {
  requireAdmin(user);
  const id = String(p.id || '').trim();
  if (!id) throw badRequest('Which complaint? An id is required.');
  const rows = await fetchAll(() => db.from('complaints').select('*').eq('id', id));
  const row = rows[0];
  if (!row) throw badRequest('That complaint could not be found.');
  if (!teamAllowed(user, row.team)) throw forbidden(`You do not have access to team ${row.team}.`);

  /* The trail is written FIRST, and deliberately not as a child row of the complaint:
     complaint_log cascades on delete, so a note written against a row that is about to
     disappear disappears with it. Recording the deletion under a null complaint_id keeps it. */
  await db.from('complaint_log').insert({
    complaint_id: null, team: row.team, action: 'DELETED', status: row.status || null,
    note: `Deleted complaint ${id} — ${String(row.complainant || row.ref || '').slice(0, 80)}`,
    created_by: user.name, created_at: new Date(nowMs).toISOString(),
  });
  const { error } = await db.from('complaints').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { id, deleted: true };
}

async function saveCallAgent(db, user, p) {
  requireAdmin(user);
  const id = String((p && p.userId) || '').trim();
  if (!id) throw badRequest('An agent id is required — it must match CREATED BY on the application report.');
  if (p.remove) {
    const { error } = await db.from('call_agents').delete().eq('user_id', id);
    if (error) throw new Error(error.message);
    return { userId: id, removed: true };
  }
  const { error } = await db.from('call_agents').upsert(
    { user_id: id, names: String((p && p.names) || '').trim() || null, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return { userId: id };
}

/* =======================================================================================
   STAFF, BY PERSON RATHER THAN BY TEAM.

   "one staff with 10 teams if changed i have to edit one by one team"

   That is exactly what the Teams & Staff tab made you do. The teams table is one row per
   TEAM with a column per role, so moving a GMO off ten teams and onto ten others was twenty
   edits, each one a chance to miss a row -- and a missed row leaves that team pointing at
   somebody who has left, silently, on every board that resolves an officer from it.

   AND THE COLLECTION OFFICERS WERE NOT THERE AT ALL. They are the one kind of staff whose
   teams do not live on the teams table: a PMO collection officer holds thirty-odd teams, which
   is a list on the PERSON (their access code) rather than their name repeated in thirty-odd
   rows. That was the right storage decision and it is unchanged -- but it meant Catherine and
   Kamaria were invisible on the screen that is supposed to show who does what.

   So the roster reads BOTH and presents one list, and the editor writes back to whichever
   place that role actually lives in. The person doing the work does not have to know there
   are two.
   ======================================================================================= */

/** The roles that live as a column on the teams table, in the order the tab shows them. */
const STAFF_TEAM_ROLES = TEAM_ROLE_COLS;
/** And the one that does not. Its teams are an array on the access code. */
const STAFF_COLLECTION_ROLE = 'collection';

/** Everybody, with the teams they hold -- merged from the teams table's role columns and from
    the access codes that carry the collection role. */
async function staffRoster(db, user) {
  const [teamRows, codeRows, cfg, book] = await Promise.all([
    fetchAll(() => db.from('teams').select('*').order('team', { ascending: true })),
    fetchAll(() => db.from('access_codes').select('code, name, role, teams')),
    settingsMany(db, [PMO_ROLE_KEY]),
    appPhoneBook(db),
  ]);
  const pmoRoleName = cfg.get(PMO_ROLE_KEY, PMO_ROLE_DEFAULT);
  const mine = teamRows.filter(t => teamAllowed(user, t.team));
  const allTeams = mine.map(t => t.team);

  /* The person's number rides along: the app's registration first (that is where these people
     actually update themselves -- see appPhoneBook), the sheet's own number column as the
     fallback, and `phoneFrom` says which one answered so the screen can say so. */
  const withPhone = (row, sheetNo) => {
    const hit = book.get(K(row.name));
    row.phone = hit ? hit.phone : (String(sheetNo || '').trim() || null);
    row.phoneFrom = hit ? 'app' : (row.phone ? 'sheet' : null);
    return row;
  };

  const out = [];
  for (const roleCol of STAFF_TEAM_ROLES) {
    const by = new Map();
    for (const t of mine) {
      const who = String(t[roleCol] || '').trim();
      if (!who) continue;
      if (!by.has(K(who))) by.set(K(who), { name: who, teams: [], no: null });
      const v = by.get(K(who));
      v.teams.push(t.team);
      if (!v.no && t[roleCol + '_no']) v.no = t[roleCol + '_no'];
    }
    for (const v of by.values()) {
      out.push(withPhone({ name: v.name, role: roleCol, roleLabel: roleCol.toUpperCase(),
        teams: v.teams.sort(), source: 'teams' }, v.no));
    }
  }
  /* The collection officers, from their access codes. A code with NO teams means "every team"
     everywhere else in this system, and such a person is not a collection officer with a
     distributed portfolio -- they are left off the board for the same reason, and showing them
     here with an empty team list would invite somebody to "fix" it by ticking all forty. */
  const collNo = new Map();
  for (const t of mine) {
    if (t.collection && t.collection_no && !collNo.has(K(t.collection))) {
      collNo.set(K(t.collection), t.collection_no);
    }
  }
  for (const c of codeRows) {
    if (!isPmoRole(c.role, pmoRoleName)) continue;
    if (!c.teams || !c.teams.length) continue;
    const held = upperTeams(c.teams).filter(t => teamAllowed(user, t));
    out.push(withPhone({ name: c.name || c.code, role: STAFF_COLLECTION_ROLE,
      roleLabel: pmoRoleName, code: c.code, teams: held.sort(), source: 'access_code' },
      collNo.get(K(c.name || c.code))));
  }

  return {
    staff: out.sort((a, b) => (a.roleLabel + a.name).localeCompare(b.roleLabel + b.name)),
    allTeams,
    roles: STAFF_TEAM_ROLES.map(r => ({ key: r, label: r.toUpperCase(), source: 'teams' }))
      .concat([{ key: STAFF_COLLECTION_ROLE, label: pmoRoleName, source: 'access_code' }]),
    collectionRole: pmoRoleName,
  };
}

/** ONE PERSON, ONE SAVE, HOWEVER MANY TEAMS.
 *
 *  `teams` is the WHOLE list this person now holds -- not an addition to it. A team they used
 *  to hold and no longer does is cleared, which is the half that made this worth building: a
 *  reassignment left half-done is a team pointing at somebody who has left, and nothing on any
 *  screen says so.
 *
 *  Only rows that actually CHANGE are written. A save that rewrote all forty teams would touch
 *  every other role on them for no reason, and on a database having a bad minute that is forty
 *  chances to fail instead of two.
 */
async function saveStaffTeams(db, user, p) {
  requireAdmin(user);
  const role = String((p && p.role) || '').trim().toLowerCase();
  const name = String((p && p.name) || '').trim();
  if (!name) throw badRequest('A staff name is required.');
  const want = new Set(upperTeams((p && p.teams) || []));

  if (role === STAFF_COLLECTION_ROLE) {
    /* Their teams are a list on their access code, so this is ONE write however many teams
       they hold -- which is the whole reason that storage was chosen. */
    const codes = await fetchAll(() => db.from('access_codes').select('code, name, role, teams'));
    const cfg = await settingsMany(db, [PMO_ROLE_KEY]);
    const pmoRoleName = cfg.get(PMO_ROLE_KEY, PMO_ROLE_DEFAULT);
    const wanted = String((p && p.code) || '').trim();
    const row = codes.find(c => (wanted ? c.code === wanted : K(c.name) === K(name))
      && isPmoRole(c.role, pmoRoleName));
    if (!row) {
      throw badRequest(`No ${pmoRoleName} access code found for "${name}". `
        + 'A collection officer is an access code with that role -- create the code first, '
        + 'under Settings, then set their teams here.');
    }
    const teams = [...want].sort();
    const { error } = await db.from('access_codes').update({ teams }).eq('code', row.code);
    if (error) throw new Error(error.message);
    return { role, name: row.name || name, teams, changed: 1, cleared: 0 };
  }

  if (!STAFF_TEAM_ROLES.includes(role)) {
    throw badRequest(`Unknown role "${role}". Expected one of: `
      + STAFF_TEAM_ROLES.concat([STAFF_COLLECTION_ROLE]).join(', '));
  }

  const teamRows = await readTeamsAll(db);
  const writes = [];
  let cleared = 0;
  for (const t of teamRows) {
    if (!teamAllowed(user, t.team)) continue;          // never edit a team you cannot see
    const held = K(t[role]) === K(name);
    const shouldHold = want.has(K(t.team));
    if (shouldHold && !held) writes.push({ team: t.team, [role]: name });
    else if (!shouldHold && held) { writes.push({ team: t.team, [role]: null }); cleared++; }
  }
  for (const batch of chunk_(writes, 200)) {
    const { error } = await db.from('teams').upsert(batch, { onConflict: 'team' });
    noteTeamsWritten(db);
    if (error) throw new Error(error.message);
  }
  return { role, name, teams: [...want].sort(), changed: writes.length, cleared };
}

function chunk_(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* ------------------------------------------------------------------ reference / admin */
/* =======================================================================================
   WHERE A LEADER'S PHONE NUMBER ACTUALLY LIVES.

     "read phone numbers in leaders table directly from call app users b/se thats where i
      mostly update leaders data and their teams"

   The leaders sheet is uploaded now and then; the call app is where the same people sign in
   EVERY DAY, with the number they actually carry. So the sheet's number columns go stale the
   moment somebody changes a SIM, while call_users has the fresh one -- registration writes it.

   The rule: A NUMBER FROM THE APP BEATS A NUMBER FROM THE SHEET, matched by the person's
   name. No match, or a registration without a number, and the sheet's column stands -- the
   overlay only ever replaces a number with a fresher one, never with a blank.

   Where two registrations share a name, the leader's row wins over an officer's, and the
   most recent registration wins within that -- the newest SIM is the one to ring.
   ======================================================================================= */
async function appPhoneBook(db) {
  const rows = await fetchAll(() =>
    db.from('call_users').select('name, phone, is_leader, registered_at, active'));
  const exact = new Map();
  for (const r of rows) {
    const k = K(r.name).replace(/\s+/g, ' ');
    const phone = String(r.phone || '').trim();
    if (!k || !phone || r.active === false) continue;
    const prev = exact.get(k);
    const better = !prev
      || (!!r.is_leader && !prev.leader)
      || (!!r.is_leader === prev.leader && String(r.registered_at || '') > prev.at);
    if (better) exact.set(k, { phone, leader: !!r.is_leader, at: String(r.registered_at || '') });
  }
  /* THE SAME PERSON UNDER TWO LENGTHS OF NAME.

       registered in the app:  CAREEN            677123160
       named on the sheet:     CAREEN GODFREY    -- and the roster showed no number at all

     People register with the name they answer to; the sheet carries the full one. An
     exact-match lookup calls those two different people, so the freshest number in the
     system went unused for exactly the people it was fetched for.

     So when the exact name finds nothing, a CONTAINED name is accepted: every word of the
     shorter name must appear in the longer one, with a single letter matching as an
     initial -- JUMA GEORGE answers for JUMA G. And only when exactly ONE registration
     fits: two Careens is not a match, it is a question, and a phone number is the wrong
     place to guess. */
  const wordFits = (a, b) => a === b
    || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
  const entries = [...exact.entries()].map(([k, v]) => [k.split(' '), v]);
  return {
    get(name) {
      const k = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
      const hit = exact.get(k);
      if (hit) return hit;
      const words = k.split(' ').filter(Boolean);
      if (!words.length) return undefined;
      let found, n = 0;
      for (const [bw, v] of entries) {
        const [shorter, longer] = words.length <= bw.length ? [words, bw] : [bw, words];
        if (shorter.every(w => longer.some(x => wordFits(w, x)))) {
          found = v;
          if (++n > 1) return undefined;
        }
      }
      return n === 1 ? found : undefined;
    },
  };
}

/** The role-name columns that have a number column beside them, sheet-side. */
const PHONE_ROLE_COLS = ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike',
  'legal', 'collection'];

/** One team row, its numbers refreshed from the app where the named person is registered. */
function overlayPhones(t, book) {
  let out = t;
  for (const c of PHONE_ROLE_COLS) {
    const hit = t[c] ? book.get(K(t[c])) : null;
    if (hit && hit.phone !== t[c + '_no']) {
      if (out === t) out = { ...t };
      out[c + '_no'] = hit.phone;
    }
  }
  return out;
}

async function teams(db, user) {
  const [rows, roleRows, book] = await Promise.all([
    fetchAll(() => db.from('teams').select('*').order('team', { ascending: true })),
    fetchAll(() => db.from('roles').select('*').order('role', { ascending: true })),
    appPhoneBook(db),
  ]);
  // Roles live beside the teams because they answer the same question -- who does what -- and
  // a role's tab list was previously readable but not editable from anywhere in the UI, so
  // onboarding a new kind of officer meant a trip to the SQL editor.
  let mine = rows.filter(r => teamAllowed(user, r.team)).map(r => overlayPhones(r, book));
  // The team code is what field officers sign in with. Same rule as access codes: a read-only
  // supervisor sees that a team HAS a code, never what it is.
  if (user.readOnly) mine = mine.map(r => (r.team_code ? { ...r, team_code: '••••' } : r));
  return { rows: mine, count: rows.length,
    // ALL_TABS, not ADMIN_TABS -- a role is exactly as likely to need a HOPE Loan tab
    // (customer_service, manager, team, gmo, finance, gm) as a HOPE PMO one, and the checkbox
    // list this feeds was quietly unable to grant any of the seven until now.
    roles: roleRows, allTabs: ALL_TABS.slice() };
}
async function saveRole(db, user, p) {
  requireAdmin(user);
  const role = String((p && p.role) || '').trim().toUpperCase();
  if (!role) throw badRequest('A role name is required.');
  // ALL_TABS, not ADMIN_TABS -- the checkbox list above now offers HOPE Loan's seven
  // alongside HOPE PMO's, and a role saved with one ticked was being silently stripped back
  // out here before this file's own smsGaps/saveTeam-shaped audit went looking for it.
  const tabs = String((p && p.tabs) || '').split(/[;,]/).map(x => x.trim().toLowerCase())
    .filter(x => ALL_TABS.includes(x));
  const { error } = await db.from('roles').upsert({ role, tabs }, { onConflict: 'role' });
  if (error) throw new Error(error.message);
  return { role, tabs };
}
async function deleteRole(db, user, p) {
  requireAdmin(user);
  const role = String((p && p.role) || '').trim().toUpperCase();
  if (!role) throw badRequest('A role name is required.');
  if (role === 'ADMIN') throw badRequest('The ADMIN role cannot be deleted.');
  // Codes inherit their tabs from the role when their own list is blank, so deleting a role
  // still in use would silently strip those people back to the default tab set.
  const codes = await fetchAll(() => db.from('access_codes').select('code, role'));
  const inUse = codes.filter(c => K(c.role) === role);
  if (inUse.length) {
    throw badRequest(`${inUse.length} access code(s) still use the ${role} role. Move them to another role first.`);
  }
  const { error } = await db.from('roles').delete().eq('role', role);
  if (error) throw new Error(error.message);
  return { role };
}
async function settingsList(db, user) {
  requireAdmin(user);
  const rows = await fetchAll(() => db.from('settings').select('*').order('key', { ascending: true }));
  return { rows };
}
async function settingSet(db, user, p) {
  requireAdmin(user);
  if (!p || !p.key) throw badRequest('key is required');
  const { error } = await db.from('settings').upsert({ key: p.key, value: String(p.value == null ? '' : p.value) }, { onConflict: 'key' });
  noteSettingsWritten(db);
  if (error) throw new Error(error.message);
  /* The open/closed switch is read from a half-minute cache on every request. An admin who
     flips it and then goes to check must see the effect, not wonder for thirty seconds
     whether it took -- so writing any setting drops the cache. */
  clearSystemOpenCache(db);
  return { key: p.key };
}

/** A setting that should not be there. Every other register in this system can lose a row --
    teams, roles, access codes, officer accounts, call agents, complaints -- and this one could
    not, so a key typed wrongly once stayed forever, and a feature switch left behind by an
    old build kept quietly applying. */
async function settingDelete(db, user, p) {
  requireAdmin(user);
  const key = String((p && p.key) || '').trim();
  if (!key) throw badRequest('Which setting? A key is required.');
  const { error } = await db.from('settings').delete().eq('key', key);
  if (error) throw new Error(error.message);
  clearSystemOpenCache(db);
  return { key, deleted: true };
}

/** The switch itself, given its own function so the Settings page can offer a real toggle
    rather than asking an admin to type YES into a key-value row and hope they spelled it the
    way the server reads it. */
async function systemOpenSet(db, user, p) {
  requireAdmin(user);
  const open = !!(p && (p.open === true || readsAsOpen(p.open)));
  const { error } = await db.from('settings')
    .upsert({ key: 'SYSTEM_OPEN', value: open ? 'YES' : 'NO' }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  clearSystemOpenCache(db);
  return { open };
}

/** What the Settings page shows beside the toggle. Admins only -- everybody else learns the
    answer from /api/me, which they can reach without an admin's permission. */
async function systemOpenGet(db, user) {
  requireAdmin(user);
  return { open: await isSystemOpen(db) };
}
async function accessCodes(db, user) {
  requireAdmin(user);
  const [rows, roleRows] = await Promise.all([
    fetchAll(() => db.from('access_codes').select('code, name, role, teams, tabs').order('name', { ascending: true })),
    fetchAll(() => db.from('roles').select('*').order('role', { ascending: true })),
  ]);
  /* A code IS a password. A read-only supervisor sees who holds access and with what role and
     scope -- never the secrets themselves. Checking the system and collecting its keys are
     different jobs, and this screen only serves the first to them. */
  const out = user.readOnly ? rows.map(r => ({ ...r, code: '••••' })) : rows;
  // allTabs rides along so the Extra-tabs field on this same screen can be a checkbox list
  // instead of free text -- "ticking the nav pannels ... because writing could error".
  return { rows: out, count: rows.length, roles: roleRows, allTabs: ALL_TABS.slice() };
}
/** Add or edit one code from the UI, so a new officer does not require an upload or SQL.
    'ALL' / blank teams means every team -- the same convention auth.js reads. */
async function saveAccessCode(db, user, p) {
  requireAdmin(user);
  const code = String((p && p.code) || '').trim();
  if (!code) throw badRequest('code is required');
  if (!p.name || !p.role) throw badRequest('name and role are required');
  // The code IS the password, so changing it has to be possible -- that is the only way to
  // rotate one that has been shared around. It is the primary key, and nothing references
  // access_codes, so a rename is an insert under the new code followed by dropping the old.
  const oldCode = String((p && p.oldCode) || '').trim();
  if (oldCode && oldCode !== code) {
    if (oldCode === user.code) throw badRequest('You cannot change the code you are signed in with — sign in with another admin code first.');
    const { data: clash } = await db.from('access_codes').select('code').eq('code', code).maybeSingle();
    if (clash) throw badRequest(`The code "${code}" is already in use.`);
  }
  const list = v => {
    const s = String(v == null ? '' : v).trim();
    if (!s || s.toUpperCase() === 'ALL') return null;
    const items = s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
    return items.length ? items : null;
  };
  /* WHO THIS CODE USED TO BE, read before it is overwritten -- a rename is only visible as the
     difference between the two, and after the upsert the old name is gone. Looked up by primary
     key on a table of a few dozen rows, and only when there is something for it to feed. */
  const nextName = String(p.name).trim();
  const nextRole = String(p.role).trim();
  const nextTeams = list(p.teams);
  let prevName = null;
  if (roleColumnOf(nextRole)) {
    const { data: was } = await db.from('access_codes').select('name')
      .eq('code', oldCode || code).maybeSingle();
    prevName = was ? was.name : null;
  }

  const { error } = await db.from('access_codes').upsert({
    code, name: nextName, role: nextRole,
    teams: nextTeams, tabs: list(p.tabs) || [],
  }, { onConflict: 'code' });
  if (error) throw new Error(error.message);
  if (oldCode && oldCode !== code) {
    // Only after the new row exists -- a failure here leaves a duplicate, which an admin can
    // see and delete, rather than deleting the old one first and locking someone out entirely.
    const { error: dErr } = await db.from('access_codes').delete().eq('code', oldCode);
    if (dErr) throw new Error(dErr.message);
  }
  /* AND NOW THE OTHER HALF OF THE SAME FACT. After the code is safely saved, never before: if
     this throws, the admin has still got the code change they asked for and a message saying
     the roster did not follow, rather than a lost save. */
  const staff = await syncStaffFromCode(db, user,
    { name: nextName, prevName, role: nextRole, teams: nextTeams });

  return { code, renamedFrom: (oldCode && oldCode !== code) ? oldCode : null, staff };
}
/* =======================================================================================
   AN ACCESS CODE AND THE TEAMS TABLE ARE ONE FACT KEPT IN TWO PLACES.

     "Updating User accesscode for a role should auto update the names and teams accessed
      in the teams and staff"

   Who somebody is, and which teams they hold, is written down twice: on their access code
   (name, role, teams -- what they may SEE) and in the teams table's role columns (who the
   GMO of KONGOWE is -- who they ARE on every report). Nothing kept the two in step, so an
   admin who edited a code was editing half of the truth:

     rename a person on their code   -> Teams & Staff still shows the old name, and every
                                        report still credits the work to it
     change which teams the code has -> Teams & Staff never hears about it at all

   The second half is why this is worth doing rather than just noting. The teams table is
   what the weekly boards, the officer boards and the recycling rotation all read. A name
   that drifts between the two registers is an officer whose work stops being counted, and
   nothing anywhere says so -- it just quietly reads zero.

   THREE RULES, and each one exists to stop a specific accident:

   1. A ROLE THAT IS NOT A COLUMN IS LEFT ALONE. ADMIN, PMO and any custom role have no
      teams-table column to write, so nothing is written. A PMO collection officer already
      keeps their teams on the code itself -- that IS the register for them.

   2. "ALL TEAMS" NEVER ASSIGNS. A code with no team list means every team, and writing that
      through would make one person the GMO of all seventy-eight. Blank means unscoped, not
      "in charge of everything", so the team list is only followed when it is explicit.

   3. NOBODY ELSE'S NAME IS TOUCHED. A team is cleared only where it still holds THIS
      person's name -- the same rule saveStaffTeams uses. Removing a team from Asha's code
      must never blank the officer who took it over from her.
   ======================================================================================= */

/** The teams-table column a code's role writes to, or null if that role has no column. */
function roleColumnOf(role) {
  const r = String(role == null ? '' : role).trim().toUpperCase();
  if (!r) return null;
  const alias = {
    'C. ANALYST': 'credit', 'CREDIT ANALYST': 'credit', 'ANALYST': 'credit',
    'EXPECTED OFFICER': 'expected', 'BIKE OFFICER': 'bike', 'RECOVERY OFFICER': 'recovery',
    'BRANCH MANAGER': 'manager', 'OPERATIONS MANAGER': 'opm',
  };
  if (alias[r]) return alias[r];
  const col = r.toLowerCase();
  return TEAM_ROLE_COLS.includes(col) ? col : null;
}

/** Carry a code's name and team list across to the teams table. Returns what changed, so the
    admin is told rather than left to notice. */
async function syncStaffFromCode(db, user, { name, prevName, role, teams }) {
  const roleCol = roleColumnOf(role);
  if (!roleCol) return null;                              // rule 1
  const now = String(name || '').trim();
  if (!now) return null;
  const before = String(prevName || '').trim();
  const renamed = before && K(before) !== K(now);
  const explicit = Array.isArray(teams) && teams.length;  // rule 2
  if (!renamed && !explicit) return null;

  const want = explicit ? new Set(upperTeams(teams)) : null;
  const teamRows = await readTeamsAll(db);
  const writes = [];
  let renamedOn = 0, added = 0, cleared = 0;
  for (const t of teamRows) {
    if (!teamAllowed(user, t.team)) continue;
    const holder = String(t[roleCol] || '').trim();
    // Held by this person under EITHER spelling of their name -- the old one is exactly what a
    // rename is trying to catch up with.
    const held = holder && (K(holder) === K(now) || (renamed && K(holder) === K(before)));
    const shouldHold = want ? want.has(K(t.team)) : held;
    if (shouldHold && (!held || holder !== now)) {
      writes.push({ team: t.team, [roleCol]: now });
      if (held) renamedOn++; else added++;
    } else if (!shouldHold && held) {
      writes.push({ team: t.team, [roleCol]: null });
      cleared++;
    }
  }
  for (const batch of chunk_(writes, 200)) {
    const { error } = await db.from('teams').upsert(batch, { onConflict: 'team' });
    noteTeamsWritten(db);
    if (error) throw new Error(error.message);
  }
  return writes.length ? { role: roleCol, name: now, renamedOn, added, cleared } : null;
}

async function deleteAccessCode(db, user, p) {
  requireAdmin(user);
  const code = String((p && p.code) || '').trim();
  if (!code) throw badRequest('code is required');
  // Locking yourself out mid-migration would mean another trip to the SQL editor.
  if (code === user.code) throw badRequest('You cannot delete the code you are signed in with.');
  const { error } = await db.from('access_codes').delete().eq('code', code);
  if (error) throw new Error(error.message);
  return { code };
}

/** Phone (calls app) registrations. Test devices and mistyped names accumulate fast during a
    rollout, and every one of them shows up in call reports -- this is how they get cleaned up
    without a database console. */
/* CALLS PER OFFICER -- the other whole-table read, and the one that never stops growing.
   Two admin screens showed "how many calls has each officer made", and read EVERY ROW of
   call_logs to count them here. Three hundred officers at fifty calls a day is fifteen
   thousand rows a day and five and a half million a year, read in full every time an admin
   opened Teams & Staff.

   It is a GROUP BY, so it belongs in the database. Without the migration the count is reported
   as unknown rather than paid for -- a dash in a column is a far smaller failure than a screen
   that will not open, and it is the same bargain performanceHistory already makes. */
async function callCountsByUser(db) {
  try {
    const { data, error } = await rpcAll(db, 'call_counts_by_user');
    if (error) throw error;
    if (!Array.isArray(data)) return null;
    const out = {};
    for (const r of data) out[String(r.user_id)] = num(r.calls);
    return out;
  } catch (e) { return null; }
}

async function callUsers(db, user) {
  requireAdmin(user);
  const [users, counts] = await Promise.all([
    fetchAll(() => db.from('call_users').select('*').order('registered_at', { ascending: false })),
    callCountsByUser(db),
  ]);
  return { rows: users.map(u => ({ ...u, calls: counts ? (counts[u.user_id] || 0) : null })),
    count: users.length, callCounts: !!counts };
}
/** Field officer accounts. An officer cannot create their own -- an admin creates it here,
    against the officer's phone number, and issues a passcode. That passcode is shown ONCE, at
    the moment it is generated, and is stored only as a scrypt hash: an admin can replace it,
    never read it back. A passcode an admin can look up is one that leaks with their screen.

    The two things this exists to make possible, both of which used to require a database
    console:

      someone leaves          -> switch the account off; the device is released immediately and
                                 their next request fails, rather than their session running
                                 until they choose to sign out (which they never do)
      a passcode gets shared  -> issue a new one; the old device is released the same way

    user_id is derived from the phone number, so creating the account in advance and the
    officer registering later resolve to the SAME identity -- their call history stays theirs
    across a lost phone, a reinstall or a new handset. */
async function officerAccounts(db, user) {
  requireAdmin(user);
  const [rows, counts0, teamRows] = await Promise.all([
    fetchAll(() => db.from('call_users').select('*').order('name', { ascending: true })),
    callCountsByUser(db),
    fetchAll(() => db.from('teams').select('team')),
  ]);
  const counts = counts0 || {};
  const out = rows.map(u => ({
    user_id: u.user_id, name: u.name, team: u.team, role: u.role, phone: u.phone,
    is_leader: !!u.is_leader, leader_teams: u.leader_teams,
    active: u.active !== false,
    // Never send the hash or the salt to a browser, not even an admin's.
    hasPasscode: !!u.passcode_hash,
    passcode_set_at: u.passcode_set_at, registered_at: u.registered_at,
    signedIn: !!u.device_id, calls: counts[u.user_id] || 0, created_by: u.created_by,
  }));
  return { rows: out, count: out.length,
    teams: teamRows.map(t => t.team).filter(Boolean).sort(),
    // Accounts left over from before passcodes existed can still sign in on the device they
    // already hold. Naming them is the whole point -- they are the open doors.
    withoutPasscode: out.filter(u => !u.hasPasscode && u.signedIn).length };
}

/** Identity MUST be derived exactly as the calls app derives it. When the admin path and the
    register path disagreed, creating an account here and signing in there produced two rows
    for one phone -- and phone is UNIQUE in Postgres, so the officer's sign-in failed outright.
    Both now go through the same pnorm/h36 pair. */
function normPhone9(v) { return pnorm(v); }
function officerId(phone9) { return 'U' + h36(phone9); }
/** Create or update an account. Passing `issuePasscode` returns a fresh one exactly once. */
async function saveOfficerAccount(db, user, p, nowMs) {
  requireAdmin(user);
  const phone = normPhone9(p && p.phone);
  if (!phone) throw badRequest('A 9-digit phone number is required — it is how the officer signs in.');
  const name = String((p && p.name) || '').trim();
  if (!name) throw badRequest('A name is required.');
  const leader = !!(p && p.isLeader);
  let team = String((p && p.team) || '').trim() || null;
  if (team) {
    const teamRows = await fetchAll(() => db.from('teams').select('team'));
    const match = teamRows.find(t => K(t.team) === K(team));
    if (!match) throw badRequest(`Unknown team "${team}".`);
    team = match.team;                       // canonical spelling the FK expects
  }
  if (!team && !leader) throw badRequest('Pick a team for a field officer.');
  const { data: existing } = await db.from('call_users').select('*').eq('phone', phone).maybeSingle();
  const uid = existing ? existing.user_id : officerId(phone);
  const active = p.active === undefined ? (existing ? existing.active !== false : true) : !!p.active;

  /* NOT MENTIONED MEANS NOT CHANGED. The form did not always send leaderTeams, and this line
     used to write null whenever it was absent -- so merely opening a multi-team leader and
     pressing Save silently collapsed their scope to nothing. Same class of loss as the teams
     upload wiping every passcode: an absent field is "I am not talking about this", never
     "erase it". A demoted leader still loses the list, because a scope without the rank it
     belongs to is a door left unlocked. */
  const leaderTeams = !leader ? null
    : p.leaderTeams !== undefined
      ? (String(p.leaderTeams).split(/[;,]/).map(x => x.trim()).filter(Boolean) || null)
      : (existing ? existing.leader_teams : null);
  const vals = { user_id: uid, name, team, phone,
    role: String((p && p.role) || (leader ? 'LEADER' : 'OFFICER')).trim(),
    is_leader: leader,
    leader_teams: leaderTeams && leaderTeams.length ? leaderTeams : null,
    active,
    created_by: existing ? existing.created_by : user.name,
    registered_at: existing ? existing.registered_at : new Date(nowMs).toISOString() };

  let issued = null;
  if (p && p.issuePasscode) {
    issued = generatePasscode();
    const { hash, salt } = hashPasscode(issued);
    vals.passcode_hash = hash; vals.passcode_salt = salt;
    vals.passcode_set_at = new Date(nowMs).toISOString();
    // A new passcode invalidates the old sign-in, or re-issuing after a leak would change
    // nothing for the person who already has the phone in their hand.
    vals.device_id = null;
  }
  // Switching an account off must cut the live session, not just block the next sign-in.
  if (!active) vals.device_id = null;

  const { error } = await db.from('call_users').upsert(vals, { onConflict: 'user_id' });
  if (error) {
    /* THE ERROR THAT MADE THE WHOLE SCREEN "NOT WORK". The columns this writes -- active,
       passcode_hash, created_by -- arrive with db/migrations/2026-07-26-officer-accounts.sql,
       and migrations here are run by hand. On a database without it, PostgREST answers with
       "could not find the 'active' column ... in the schema cache", which reads like the
       system is broken rather than like a file is waiting to be pasted. Unlike the leaders
       sheet, these columns cannot be quietly dropped -- switching an officer OFF is the whole
       feature -- so the save refuses in plain words instead. Costs nothing when it works. */
    if (/schema cache|column/i.test(error.message)
        && /(active|passcode_hash|passcode_salt|passcode_set_at|created_by)/.test(error.message)) {
      throw badRequest('Hifadhi imeshindikana kwa sababu database bado haina safu za akaunti za maafisa. '
        + 'Mwendeshaji apitishe db/migrations/2026-07-26-officer-accounts.sql kwenye SQL editor, kisha jaribu tena.'
        + '\n\nThe database has not got the officer-account columns yet, so nothing here can save. '
        + 'Run db/migrations/2026-07-26-officer-accounts.sql (it is also inside RUN-ME-2026-08-14.sql) '
        + 'in the Supabase SQL editor, then try again. Until then this screen can only read.');
    }
    throw new Error(error.message);
  }
  return { userId: uid, name, team, active, passcode: issued };
}

/** Delete an account outright. Switching one off keeps the person's call history attached
    and is the right move for someone who has left; deleting is for the ones that should never
    have existed -- a test registration, a typo'd phone number, a duplicate. Their call logs
    go first because call_logs references call_users, and a delete that leaves orphaned logs
    would just fail. */
async function deleteOfficerAccount(db, user, p) {
  requireAdmin(user);
  const id = String((p && p.userId) || '').trim();
  if (!id) throw badRequest('userId is required');
  const { data: acct } = await db.from('call_users').select('user_id, name').eq('user_id', id).maybeSingle();
  if (!acct) throw badRequest('That account no longer exists.');
  const { error: lErr } = await db.from('call_logs').delete().eq('user_id', id);
  if (lErr) throw new Error(lErr.message);
  const { error } = await db.from('call_users').delete().eq('user_id', id);
  if (error) throw new Error(error.message);
  return { userId: id, name: acct.name, deleted: true };
}

/** Two ways to remove someone, because they mean different things:
      unregister -> keep the row and its call history, just release the device so the phone
                    has to register again (the fix for "wrong name/team on the right phone");
      delete     -> remove the registration entirely, and only then also drop its call logs,
                    which is what a test account deserves. */
async function removeCallUser(db, user, p) {
  requireAdmin(user);
  const id = String((p && p.userId) || '').trim();
  if (!id) throw badRequest('userId is required');
  if (String(p.mode || 'unregister') === 'unregister') {
    const { error } = await db.from('call_users').update({ device_id: null }).eq('user_id', id);
    if (error) throw new Error(error.message);
    return { userId: id, mode: 'unregister' };
  }
  // call_logs.user_id references call_users -- the logs must go first or the delete is refused.
  const { error: lErr } = await db.from('call_logs').delete().eq('user_id', id);
  if (lErr) throw new Error(lErr.message);
  const { error } = await db.from('call_users').delete().eq('user_id', id);
  if (error) throw new Error(error.message);
  return { userId: id, mode: 'delete' };
}

/* ------------------------------------------------------------------ storage housekeeping

   Every upload appends a dated snapshot rather than overwriting, which is what makes history,
   trends and "recovery since Monday" possible at all -- but it also means the tables only ever
   grow. Postgres has no cell ceiling the way the old workbook did, so nothing breaks; what
   runs out eventually is the plan's disk quota. So: show what each date is actually costing,
   and let an admin drop the dates they no longer need, per report type.

   Deleting a snapshot date deletes a DAY OF HISTORY -- the trends and weekly comparisons that
   read it will show gaps -- so this is admin-only and names the row count before it acts.

   Bytes-per-row below are MEASURED, not guessed: this schema was loaded into Postgres 16 and
   filled with rows carrying real-shaped Tanzanian names, phone numbers, refs and branches,
   then pg_total_relation_size (heap + indexes + toast) was divided by the row count. They are
   what makes the size projection on the Settings page trustworthy. */
/* EVERY report that grows, not just the big five.

   This list started as the tables that were obviously eating disk, which left the owner able
   to clean five things and stuck with the rest. If a report accumulates, it belongs here.

   `uploadedOnly` marks the four registers people ALSO type into from inside the app -- a
   complaint logged at the desk, an officer's follow-up comment, a restructure request, a
   demand notice issued from the Legal screen. Cleaning a date there takes only what arrived in
   an upload. Somebody's typed work is not a report and must not vanish in a tidy-up. It is the
   same rule Replace already follows.

   followup_status is deliberately absent. It is not a report and has no date dimension: one
   row per customer, rebuilt from each Current deck, holding the officers' live working list
   with their promises and comments on it. "Delete a date" has no meaning there, and the
   nearest thing it could mean would wipe the book everyone is working from. */
/* =====================================================================================
   THE SUPERSEDED UPLOADS -- every copy of a day except the one that counts.
   =====================================================================================
   "Help me delete if there exist duplicate data since I thought we weren't overiting a days
    reports and I was uploading like every half an hour so leave the last uploads"

   Nothing was ever double-counted: the snapshot tables are append-only BY DESIGN and every
   read takes the latest upload_batch within a date, so a file sent thirty times shows up once.
   What it does do is FILL THE DATABASE -- thirty copies of thirty thousand customers is nine
   hundred thousand rows nobody will ever read, and every range read pays to skip past them.

   So this deletes the losing batches and keeps the winning one, per day, per type, per weekday.
   It is exactly the batch rule, run as a broom rather than as a filter -- which is why it can
   never change a figure: the rows it removes are precisely the rows every read was already
   ignoring.

   IT COUNTS BEFORE IT CUTS. Called with dryRun it reports what would go and touches nothing,
   because "delete most of the database" is not a button anybody should press blind.

   IT WORKS IN BOUNDED BITES. A book uploaded every half hour for weeks has hundreds of losing
   batches, and one delete per batch would run past the platform's sixty seconds. It stops at
   `limit` batches and says how many are left, so it can be run again until it reports none. */
const SUPERSEDED_SOURCES = [
  { table: 'repayment_snapshots', label: 'Expected Repayment',
    fn: 'expected_snapshot_totals', keys: ['snapshot_date', 'snapshot_type'] },
  { table: 'defaulter_snapshots', label: 'Defaulters',
    fn: 'defaulter_snapshot_totals', keys: ['snapshot_date', 'snapshot_type', 'weekday'] },
  { table: 'snapshot_summaries', label: 'Summaries',
    fn: null, keys: ['kind', 'snapshot_date', 'snapshot_type', 'weekday'] },
];

/** One row per (group, batch) with a row count and the batch's newest created_at -- which is
    everything the batch rule needs and nothing else. Taken from the totals functions where they
    exist, because asking the database to group is the whole point of them; where they do not,
    the grouping columns are read directly, which is narrow enough to be affordable for a
    maintenance action nobody runs twice a day. */
async function batchCensus(db, src, from, to) {
  if (src.fn) {
    const args = src.table === 'repayment_snapshots'
      ? { p_from: from, p_to: to, p_type: null, p_teams: null }
      : { p_from: from, p_to: to, p_type: null, p_teams: null, p_weekday: null };
    // Paged: an export function returns a row per record and is capped like any other read.
    const { data, error } = await rpcAll(db, src.fn, args);
    if (!error && Array.isArray(data)) {
      return data.map(r => ({ ...r, n: num(r.customers) }));
    }
  }
  const cols = src.keys.concat(['upload_batch', 'created_at']).join(', ');
  const rows = await fetchAll(() => db.from(src.table).select(cols)
    .gte('snapshot_date', from).lte('snapshot_date', to));
  return rows.map(r => ({ ...r, n: 1 }));
}

/* =====================================================================================
   CHANGING YOUR OWN CODE.
   =====================================================================================
   "and i can change my admin password in my admin a/c please"

   The access code IS the password in this system -- it decides who you are, which teams you
   see and what you may change. Until now it could only be changed from the Access Codes screen,
   which is an admin editing SOMEBODY ELSE's row; changing your own meant typing your new secret
   into a list of everyone's, in a screen designed for administering other people.

   THE OLD CODE IS REQUIRED even though the caller is already signed in. A portal session is a
   code held in a browser, so "already signed in" is exactly the state somebody is in when they
   have walked away from an unlocked screen -- and this is the one change that would lock the
   real owner out of their own account.

   NOTHING ELSE IN THE DATABASE POINTS AT A CODE. Nothing carries it as a foreign key, so this
   is a straight update of one row -- but the phones that registered with the OLD code are
   holding a device registration, not the code itself, so they keep working. That is the right
   outcome: changing a password should not un-register the field.

   It is NOT admin-only. Every leader has a code and every leader's code is their authority; a
   rule that only admins may change their own would be the wrong way round. */
async function changeMyCode(db, user, p) {
  const oldCode = String((p && p.oldCode) || '').trim();
  const newCode = String((p && p.newCode) || '').trim();
  const again = String((p && p.confirmCode) || '').trim();

  if (!oldCode || !newCode) throw badRequest('Weka msimbo wa sasa na mpya. / Enter your current code and the new one.');
  if (String(oldCode).toUpperCase() !== String(user.code || '').toUpperCase()) {
    throw forbidden('Msimbo wa sasa si sahihi. / That is not your current code.');
  }
  if (again && again !== newCode) {
    throw badRequest('Misimbo miwili mipya haifanani. / The two new codes do not match.');
  }
  /* Six characters is the same floor a team code has, and for the same reason: a short one gets
     guessed. Letters and digits only -- a code is read out over the phone and written on paper,
     and a space or a punctuation mark in it is a support call. */
  if (newCode.length < 6) throw badRequest('Msimbo mpya uwe na herufi 6 au zaidi. / The new code needs 6 characters or more.');
  if (!/^[0-9A-Za-z]+$/.test(newCode)) throw badRequest('Tumia herufi na namba pekee. / Letters and numbers only.');
  if (String(newCode).toUpperCase() === String(oldCode).toUpperCase()) {
    throw badRequest('Msimbo mpya ni ule ule. / That is the same code.');
  }

  // Case-insensitively, because sign-in now matches that way -- so a code differing only in
  // case from somebody else's would be an ambiguity the door refuses, locking BOTH of them out.
  const taken = await fetchAll(() => db.from('access_codes').select('code'));
  if (taken.some(c => String(c.code).toUpperCase() === newCode.toUpperCase())) {
    throw badRequest('Msimbo huo unatumika. / That code is already in use.');
  }

  const { error } = await db.from('access_codes').update({ code: newCode }).eq('code', user.code);
  if (error) throw new Error(error.message);
  return { ok: true, code: newCode };
}

async function purgeSuperseded(db, user, p, nowMs) {
  requireAdmin(user);
  /* A WINDOW, NOT THE WHOLE HISTORY.

     The first version defaulted `from` to the year 0001, which asked the totals function to
     aggregate every snapshot row the company has ever written in ONE call -- and on a real book
     that does not come back inside the platform's sixty seconds. The button appeared to do
     nothing, which is exactly what "Angalia/check first loads nothing" looked like from the
     other side. My fault, and the fix is the same one every other heavy read here already uses:
     bound it, and let it be run again.

     A month at a time, newest first. The answer says which window it covered and the date to
     ask for next, so the screen can walk backwards until there is nothing older left. */
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(p && p.to)) ? p.to : todayKey(nowMs);
  const days = Math.max(1, Math.min(120, parseInt((p && p.days) || 0, 10) || 31));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(p && p.from)) ? p.from : addDaysKey(to, -(days - 1));
  const dryRun = !(p && p.confirm === true);
  const limit = Math.max(1, Math.min(400, parseInt((p && p.limit) || 0, 10) || 120));
  /* How many uploads of each day survive. Two by default: the one in use and the one it
     replaced. One is allowed for a deployment that wants the space back and accepts that a bad
     upload can only be undone by sending the right file again. */
  const keepN = Math.max(1, Math.min(10, parseInt((p && p.keep) || 0, 10) || 2));

  /* One tiny read per table -- one column, one row -- to learn how far back there is anything
     at all. Without it the screen has no way to know when to stop asking for older windows. */
  let oldest = null;
  for (const src of SUPERSEDED_SOURCES) {
    try {
      const { data, error } = await runQuery(() => db.from(src.table)
        .select('snapshot_date').order('snapshot_date', { ascending: true }).limit(1).maybeSingle());
      if (error || !data || !data.snapshot_date) continue;
      const d = String(data.snapshot_date).slice(0, 10);
      if (!oldest || d < oldest) oldest = d;
    } catch (e) { /* table not there yet */ }
  }

  const report = [];
  let deletedBatches = 0, remaining = 0;
  for (const src of SUPERSEDED_SOURCES) {
    let census;
    try { census = await batchCensus(db, src, from, to); }
    catch (e) { continue; }                    // a table that does not exist yet: nothing to sweep
    if (!census.length) { report.push({ table: src.table, label: src.label, groups: 0, losingBatches: 0, rows: 0 }); continue; }

    // Group exactly the way every read groups, then let the shared rule name the winner.
    const groups = new Map();
    for (const r of census) {
      const k = src.keys.map(c => String(r[c] == null ? '' : r[c])).join('\u0001');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    let losing = 0, rowsGoing = 0;
    const doomed = [];
    for (const [, rows] of groups) {
      /* KEEP THE LAST `keepN` UPLOADS OF EACH DAY, NOT ONLY THE WINNER.

         "just keep two copies if unsuccessful uploads are an issue"

         Which is the right shape. Keeping EVERY copy was safe and unbounded -- a file sent
         every half hour for weeks is hundreds of copies of a day nobody will ever read.
         Keeping only the winner is bounded and gives up the safety net: if the newest upload
         turns out to be the wrong file, half a sheet, or a corrupted export, the good figures
         it superseded are gone with it.

         Two is the middle: the one in use, and the one it replaced. A bad upload is undone by
         sending the right file again, and until that happens the previous good copy is still
         underneath.

         Ranked the way the batch rule ranks -- created_at, then the batch id to settle a tie --
         so "the last two" here and "the one that counts" everywhere else can never disagree
         about which upload is newest. */
      const byBatch = new Map();
      for (const r of rows) {
        const b = r.upload_batch || null;
        if (!byBatch.has(b)) byBatch.set(b, { batch: b, n: 0, row: r, rank: '' });
        const g = byBatch.get(b);
        g.n += r.n;
        const rank = String(r.created_at || '') + ' ' + String(b || '');
        if (rank > g.rank) { g.rank = rank; g.row = r; }
      }
      const ordered = [...byBatch.values()].sort((a, b) => (a.rank < b.rank ? 1 : a.rank > b.rank ? -1 : 0));
      for (const o of ordered.slice(keepN)) { losing++; rowsGoing += o.n; doomed.push({ ...o, keyRow: o.row }); }
    }
    report.push({ table: src.table, label: src.label, groups: groups.size, losingBatches: losing, rows: rowsGoing });

    if (!dryRun) {
      for (const d of doomed) {
        if (deletedBatches >= limit) { remaining++; continue; }
        /* Scoped to the GROUP as well as the batch. An upload_batch is a uuid and is already
           unique to one upload, but naming the day and type too means a delete can never reach
           further than the group it was decided in -- and this is a delete of most of the
           database, so it is worth being unable to go wrong rather than merely unlikely to. */
        let q = db.from(src.table).delete();
        for (const c of src.keys) {
          const v = d.keyRow[c];
          q = (v == null ? q.is(c, null) : q.eq(c, v));
        }
        q = d.batch == null ? q.is('upload_batch', null) : q.eq('upload_batch', d.batch);
        const { error } = await q;
        if (error) throw new Error(error.message);
        deletedBatches++;
      }
    }
  }
  /* The day before this window, so the screen can walk back one month at a time. `oldest` is
     the earliest date any of the three tables actually holds -- once the window has passed it
     there is nothing older to sweep and the walk stops, rather than marching backwards through
     empty years. */
  const before = addDaysKey(from, -1);
  return {
    dryRun, from, to, limit, keep: keepN, days,
    before, done: !oldest || String(before) < String(oldest), oldest,
    report,
    totalBatches: report.reduce((s, r) => s + r.losingBatches, 0),
    totalRows: report.reduce((s, r) => s + r.rows, 0),
    deletedBatches, remainingBatches: remaining,
  };
}

const SNAPSHOT_SOURCES = {
  expected: { table: 'repayment_snapshots', label: 'Expected Repayment', dateCol: 'snapshot_date', bytes: 456 },
  defaulters: { table: 'defaulter_snapshots', label: 'Defaulters', dateCol: 'snapshot_date', bytes: 498 },
  received: { table: 'received_payments', label: 'Received Payments', dateCol: 'paid_at', bytes: 246 },
  abnormal: { table: 'abnormal_payments', label: 'Abnormal Payments', dateCol: 'created_at', ts: true, bytes: 246 },
  calls: { table: 'call_logs', label: 'Call Logs', dateCol: 'call_date', bytes: 258 },
  // The loan pipeline is dated by the report it came in on, not by the dates inside it -- an
  // applications report pulled on the 27th is full of June applications.
  loans: { table: 'loans', label: 'Loan Pipeline', dateCol: 'upload_date', bytes: 512 },
  comments: { table: 'followup_comments', label: 'Comments Log', dateCol: 'created_at', ts: true, bytes: 268, uploadedOnly: true },
  complaints: { table: 'complaints', label: 'Complaints', dateCol: 'created_at', ts: true, bytes: 288, uploadedOnly: true },
  restructures: { table: 'restructures', label: 'Loan Restructuring', dateCol: 'created_at', ts: true, bytes: 312, uploadedOnly: true },
  demand_notices: { table: 'demand_notices', label: 'Demand Notices', dateCol: 'created_at', ts: true, bytes: 296, uploadedOnly: true },
  /* THE ONE REPORT THAT ACCUMULATED WITH NO WAY TO CLEAN IT.

     Every other table here is either superseded by date or cleanable. followup_status is
     neither: it is upserted per customer, so a re-upload corrects rather than duplicates --
     but a customer who leaves the deck KEEPS their row, by design, because their history is
     still worth reading. Nothing ever removed one. Import a year of v1 comments and it also
     gains a placeholder for every customer mentioned.

     Cleaning it is genuinely destructive in a way none of the others are: followup_comments
     references it ON DELETE CASCADE, so removing a customer takes their whole comment history
     with them. That is not a footnote -- so it is counted and reported BEFORE anything
     happens, and the check step exists precisely for this. */
  followup: { table: 'followup_status', label: 'Follow-up list', dateCol: 'updated_at', ts: true, bytes: 320,
    cascades: { table: 'followup_comments', on: 'ref', label: 'comments' }, keyCol: 'ref' },
};
const dayOf = v => String(v == null ? '' : v).slice(0, 10);

/** What is stored, by date and report type, so a cleanup is an informed choice rather than a
    guess. Also reports the total row count per source for the storage note in the UI. */
/* COUNTING IS THE DATABASE'S JOB.

   This used to download every row of five tables -- every repayment snapshot, every defaulter
   snapshot, every received payment, every abnormal payment, every call log -- one table after
   another, and count them here. With thirty thousand customers and a snapshot every day, that
   is millions of rows pulled across the internet to work out a number Postgres already knew.
   It is why the Settings tab took so long to open, and it was quietly a large part of the
   data-transfer bill.

   storage_usage_by_date() does the same counting in one query, over indexes, and sends back a
   few hundred rows. See db/migrations/2026-08-01-storage-counts.sql.

   The old way is kept as a fallback, and this is not tidiness: the migration is run by hand,
   so between a deploy and that being done, the function does not exist. Falling back means
   the Settings tab keeps working -- slowly, as it always did -- instead of breaking. */
async function countsByDate(db) {
  let rows = [];
  try {
    // Paged: one row per source per day, which passes a thousand within a few months.
    const { data, error } = await rpcAll(db, 'storage_usage_by_date');
    if (error) throw error;
    if (Array.isArray(data)) rows = data;
  } catch (e) { /* function not created yet -- everything falls back below */ }

  /* Whatever the database function did not answer for is counted the old way, source by
     source. This matters because the list of reports grows: a database still running an
     earlier version of the function knows nothing about, say, the loan pipeline, and the
     alternative to filling that gap here would be a Settings tab that quietly under-reports
     until somebody remembers to run some SQL. A source that is genuinely empty costs one
     query returning nothing. */
  const answered = new Set(rows.map(r => r.source));
  for (const [key, src] of Object.entries(SNAPSHOT_SOURCES)) {
    if (answered.has(key)) continue;
    const all = await fetchAll(() => db.from(src.table).select(src.dateCol));
    const n = {};
    for (const r of all) { const d = dayOf(r[src.dateCol]); n[d] = (n[d] || 0) + 1; }
    for (const [day, count] of Object.entries(n)) rows.push({ source: key, day, n: count });
  }
  return rows;
}

/* ---------------------------------------------- CLEAN THE FOLLOW-UP LIST, WITHOUT WAITING.
 *
 * Reported twice from the field, two different customers: somebody showing on Leo with D.S 9-10
 * and on Def with D.S 8-9 at the same moment. Being on both lists is right -- they answer
 * different questions. TWO DIFFERENT D.S VALUES IS NOT: it means the Def row came from an older
 * deck than the other one, and nothing has come along to correct it.
 *
 * The working list only refreshes for customers named in an uploaded current-defaulter deck for
 * THEIR weekday. That is the right rule -- a Monday file says nothing about Tuesday's people --
 * and it has a hole: if a weekday's deck stops being uploaded, everybody on it keeps figures
 * that get older every week, with nothing on any screen to say how old.
 *
 * The upload already retires those rows. But it only runs WHEN SOMETHING IS UPLOADED, and the
 * person looking at the wrong number has no way to make that happen. So it is a button too.
 *
 * NOT A DELETE. This blanks the deck-derived figures -- status and arrears -- so the customer
 * stops looking like a live defaulter. The row stays, every comment stays, and the next deck
 * that names them puts them straight back. The Settings storage cleanup is the destructive one
 * (it cascades into the comment log); this deliberately is not, which is why it can be offered
 * as an ordinary button.
 */
export const FU_RETIRE_DEFAULT_DAYS = 14;
/* A CUTOFF SHORTER THAN THE DECK CYCLE RETIRES PEOPLE WHO ARE PERFECTLY CURRENT.
   Decks are per weekday and each comes round once a week, so a customer confirmed by their own
   Tuesday deck is not stale on Thursday -- their deck is simply not due yet. Asking for one day
   therefore describes almost the whole register, which is exactly what emptied it (see the note
   in api/upload.js). Seven days is the cycle; below it the question has no honest answer, so the
   floor is applied and the caller is told it was. */
export const FU_RETIRE_MIN_DAYS = 7;
/* The most of the working list one sweep may retire, as a fraction -- the same brake
   syncFollowupFromDeck has carried all along. Above it, nothing is retired and the number is
   reported instead: a rule that can blank most of what two hundred people work from must not do
   it quietly. The floor of 50 keeps a small register workable. */
const FU_CLEAN_CAP = 0.35;
async function followupClean(db, user, p, nowMs) {
  requireAdmin(user);
  const asked = Math.max(1, parseInt(String((p && p.days) || FU_RETIRE_DEFAULT_DAYS), 10) || FU_RETIRE_DEFAULT_DAYS);
  const days = Math.max(asked, FU_RETIRE_MIN_DAYS);
  const floored = days !== asked ? asked : null;
  const cutoff = addDaysKey(todayKey(nowMs), -days);

  /* deck_date first, updated_at behind it -- the same clock the upload uses, because two
     answers to "when was this last confirmed" is how the first version of this went wrong.
     Read defensively: deck_date arrived in a migration that is run by hand. */
  let rows, stamped = true;
  try {
    rows = await fetchAll(() => db.from('followup_status')
      .select('ref, full_name, team, status, arrears, ds, deck_date, updated_at'));
  } catch (e) {
    // The database has not had the deck_date migration yet. PostgREST fails the WHOLE read on
    // one unknown column, so this is the only way to find out -- and updated_at alone still
    // answers the question, just less precisely.
    stamped = false;
    rows = await fetchAll(() => db.from('followup_status')
      .select('ref, full_name, team, status, arrears, ds, updated_at'));
  }
  rows = rows.filter(r => teamAllowed(user, r.team));

  const confirmedOn = r => String((stamped && r.deck_date) || r.updated_at || '').slice(0, 10);
  // Only rows that still LOOK like live defaulters are candidates; a blanked row is already done.
  const stale = rows.filter(r => {
    const d = confirmedOn(r);
    return d && d < cutoff && (r.status != null || r.arrears != null);
  });

  const sample = stale.slice(0, 20).map(r => ({
    ref: r.ref, name: r.full_name || '', team: r.team || '', ds: r.ds || '',
    lastSeen: confirmedOn(r),
  }));
  const capped = stale.length > Math.max(50, Math.floor(rows.length * FU_CLEAN_CAP))
    ? stale.length : 0;
  const note = capped
    ? `Hawajaondolewa. / NOTHING was retired: ${capped} of ${rows.length} rows on the working list `
      + 'look stale, which is more than a third of it. That is not a list needing a tidy — it means '
      + 'some weekdays\' current-defaulter decks have stopped being uploaded. Upload those decks and '
      + 'these rows correct themselves.'
    : (floored
      ? `Iliombwa siku ${floored}, imetumika ${days}. / You asked for ${floored} day(s); ${days} was used. `
        + 'Each weekday\'s deck only comes round once a week, so anything shorter than a week retires '
        + 'customers whose deck is simply not due yet.'
      : undefined);
  // Asking is free and always allowed; acting is a second, explicit call.
  if (!p || !p.confirm) {
    return { ok: true, checked: rows.length, stale: stale.length, cutoff, days, asked, sample,
      capped: capped || undefined, note, applied: false };
  }
  if (capped) {
    return { ok: true, checked: rows.length, stale: stale.length, retired: 0, cutoff, days, asked,
      sample, capped, note, applied: true };
  }
  let retired = 0;
  for (let i = 0; i < stale.length; i += 500) {
    const batch = stale.slice(i, i + 500).map(r => ({
      ref: r.ref, status: null, arrears: null,
      ...(stamped ? { deck_date: null } : {}),
      updated_at: new Date(nowMs).toISOString(),
    }));
    const { error } = await db.from('followup_status').upsert(batch, { onConflict: 'ref' });
    if (error) throw new Error(error.message);
    retired += batch.length;
  }
  return { ok: true, checked: rows.length, stale: stale.length, retired, cutoff, days, asked,
    sample, note, applied: true };
}

async function storageUsage(db, user) {
  requireAdmin(user);
  const out = {};
  const byDate = {};
  for (const [key, src] of Object.entries(SNAPSHOT_SOURCES)) {
    out[key] = { key, label: src.label, table: src.table, rows: 0 };
  }
  for (const row of await countsByDate(db)) {
    const key = row.source;
    if (!out[key]) continue;                      // a source the app no longer knows about
    const n = Number(row.n) || 0;
    out[key].rows += n;                           // rows with no date still count towards size
    const d = dayOf(row.day);
    if (!d) continue;
    if (!byDate[d]) byDate[d] = { date: d, total: 0 };
    byDate[d][key] = (byDate[d][key] || 0) + n;
    byDate[d].total += n;
  }
  const dates = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
  for (const s of Object.values(out)) s.bytes = s.rows * SNAPSHOT_SOURCES[s.key].bytes;
  for (const d of dates) {
    d.bytes = Object.keys(SNAPSHOT_SOURCES).reduce((s, k) => s + (d[k] || 0) * SNAPSHOT_SOURCES[k].bytes, 0);
  }
  const bytes = Object.values(out).reduce((s, x) => s + x.bytes, 0);
  // Growth per day, measured over the dates actually present -- so the projection describes
  // THIS operation's upload habits rather than an assumed one.
  const span = dates.length > 1
    ? Math.max(1, Math.round((Date.parse(dates[0].date) - Date.parse(dates[dates.length - 1].date)) / 86400000) + 1)
    : 1;
  const perDay = Math.round(bytes / span);
  return { sources: Object.values(out), dates,
    totalRows: Object.values(out).reduce((s, x) => s + x.rows, 0),
    bytes, perDay, perMonth: perDay * 30, days: span,
    oldest: dates.length ? dates[dates.length - 1].date : null,
    newest: dates.length ? dates[0].date : null };
}

/** What has already been uploaded for a given day. Someone loading five Expected files and
    fourteen defaulter decks every morning cannot hold in their head which ones are already in,
    and the failure is silent in the worst way: a MISSING upload does not error, it just makes
    the dashboard quietly wrong -- yesterday's numbers presented as today's. This answers
    "what still needs loading?" before the work starts rather than after someone notices a
    figure looks off.

    Gated on UPLOAD, not settings: the person doing the uploading is exactly who needs it. */
const UPLOAD_EXPECTED_TYPES = ['today', 'tomorrow', 'yesterday', 'initial'];
/* =====================================================================================
   THE PANEL THAT STOPPED THE UPLOADS IT WAS THERE TO HELP WITH.

     "i can't even upload report appdates we get delay errors and so on"

   This read FOUR WHOLE TABLES with no date filter -- every expected row, every defaulter row,
   every payment and every call ever recorded -- to answer a question about ONE DAY. On a book
   of a million snapshot rows that is over a thousand round trips and hundreds of megabytes, on
   the page whose entire job is to accept an upload. The upload queued behind it and timed out.
   The panel that exists to say "your report is missing" was itself why the report could not be
   loaded.

   NOT ONE OF THOSE ROWS WAS EVER SHOWN. Every figure on this panel is a count or a maximum,
   and both are things a database answers without moving a row. So it asks the database --
   db/migrations/2026-08-10-upload-status.sql -- and gets about twenty summary rows back.

   THE FALLBACK IS BOUNDED TOO, which is the part that matters. Migrations here are run by
   hand, so between a deploy and that being done this function still has to work -- but it must
   never go back to reading the whole book. It reads THE CHOSEN DAY ONLY, which is what the
   panel is actually asking about, and reports the lifetime totals as unknown rather than
   dragging a million rows to find them. Missing information is a smaller failure than a page
   that cannot load, and the screen says which file to run.
   ===================================================================================== */
async function uploadStatus(db, user, { date } = {}, nowMs) {
  if (!(user.tabs || []).includes('upload')) throw forbidden('Upload permission is required.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : todayKey(nowMs);

  /* ---- THE FAST PATH: one round trip, ~20 rows, no customer data at all. ---- */
  let sum = null;
  try {
    const { data, error } = await rpcAll(db, 'upload_status_summary', { p_day: day });
    if (error) throw error;
    if (Array.isArray(data)) sum = data;
  } catch (e) { /* function not created yet -- bounded fallback below */ }

  const byKey = {};                     // 'source|kind|weekday' -> { latest, total, today, uploads }
  let lifetime = true;
  if (sum) {
    for (const r of sum) {
      byKey[`${r.source}|${r.kind || ''}|${r.weekday || ''}`] = {
        latest: r.latest ? String(r.latest).slice(0, 10) : null,
        total: num(r.total), today: num(r.today), uploads: num(r.uploads),
      };
    }
  } else {
    lifetime = false;
    /* ONE DAY, four filtered reads. `today` is the LARGEST SINGLE BATCH of that day, not the
       sum of them: snapshots are append-only, so a corrected re-upload leaves both copies on
       disk while every read resolves to the latest batch. Adding them reported double after a
       re-upload and made it look as though the data had doubled. */
    const [rep, def, rcv, calls] = await Promise.all([
      fetchAll(() => db.from('repayment_snapshots').select('snapshot_type, upload_batch').eq('snapshot_date', day)),
      fetchAll(() => db.from('defaulter_snapshots').select('snapshot_type, weekday, upload_batch').eq('snapshot_date', day)),
      fetchAll(() => db.from('received_payments').select('paid_at').gte('paid_at', day).lte('paid_at', day + 'T23:59:59.999Z')),
      fetchAll(() => db.from('call_logs').select('call_date').eq('call_date', day)),
    ]);
    const fold = (rows, source, keyOf, wdOf) => {
      const per = {};
      for (const r of rows) {
        const k = `${source}|${keyOf(r)}|${wdOf ? wdOf(r) : ''}`;
        if (!per[k]) per[k] = {};
        const b = r.upload_batch || 'legacy';
        per[k][b] = (per[k][b] || 0) + 1;
      }
      for (const [k, batches] of Object.entries(per)) {
        const counts = Object.values(batches);
        byKey[k] = { latest: day, total: null, today: Math.max(...counts), uploads: counts.length };
      }
    };
    fold(rep, 'expected', r => r.snapshot_type || '');
    fold(def, 'defaulters', r => r.snapshot_type || '', r => r.weekday || '');
    byKey['received||'] = { latest: rcv.length ? day : null, total: null, today: rcv.length, uploads: 0 };
    byKey['calls||'] = { latest: calls.length ? day : null, total: null, today: calls.length, uploads: 0 };
  }

  const at = k => byKey[k] || { latest: null, total: lifetime ? 0 : null, today: 0, uploads: 0 };
  const items = [];
  for (const t of UPLOAD_EXPECTED_TYPES) {
    const b = at(`expected|${t}|`);
    items.push({ group: 'Expected repayment', label: `Expected — ${t}`, key: `expected-${t}`,
      latest: b.latest, today: b.today, total: b.total, uploads: b.uploads, loadedToday: b.today > 0 });
  }
  for (const type of ['current', 'initial']) {
    for (const wd of WD7) {
      const b = at(`defaulters|${type}|${wd}`);
      items.push({ group: `Defaulters — ${type}`, label: `Defaulters ${type} — ${wd}`,
        key: `defaulters-${type}-${wd}`, weekday: wd,
        latest: b.latest, today: b.today, total: b.total, uploads: b.uploads, loadedToday: b.today > 0 });
    }
  }
  for (const [label, key, k] of [['Received Payments', 'received', 'received||'], ['Call Logs', 'calls', 'calls||']]) {
    const b = at(k);
    items.push({ group: 'Other', label, key, latest: b.latest, today: b.today,
      total: b.total, loadedToday: b.today > 0 });
  }

  // Today's OWN weekday is the one that actually has to be in for the dashboard to be right;
  // the other six weekday decks are history and their absence is not a problem.
  const wdToday = currentWeekday(nowMs);
  const required = items.filter(i =>
    i.key === 'expected-today' || i.key === `defaulters-current-${wdToday}`);
  return { date: day, weekday: wdToday, items,
    // Whether the lifetime columns are real. False means the migration has not been run and
    // the page is answering from the chosen day alone -- which is the whole point of it.
    lifetime,
    note: lifetime ? null
      : 'Jumla ya rekodi zote haipatikani — endesha db/migrations/2026-08-10-upload-status.sql. '
        + '/ Lifetime totals need db/migrations/2026-08-10-upload-status.sql; showing this day only.',
    missing: required.filter(i => !i.loadedToday).map(i => i.label),
    ready: required.every(i => i.loadedToday) };
}

/** Delete the chosen report types for one date, or for everything on/before a date when
    `through` is set -- which is how you reclaim a year of history in one action. */
async function purgeSnapshots(db, user, p) {
  requireAdmin(user);
  const date = String((p && p.date) || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('A date (yyyy-mm-dd) is required.');
  const wanted = Array.isArray(p.types) ? p.types.filter(t => SNAPSHOT_SOURCES[t]) : [];
  if (!wanted.length) throw badRequest('Choose at least one report type to clean.');
  const through = !!p.through;
  const deleted = {};
  const cascaded = {};
  let total = 0;
  let protectedRows = 0;
  for (const key of wanted) {
    const src = SNAPSHOT_SOURCES[key];
    // Count first: the caller is told exactly what went, and a dry run can ask without acting.
    const cols = src.cascades ? `${src.dateCol}, ${src.keyCol}, status, arrears`
      : src.uploadedOnly ? `${src.dateCol}, upload_batch` : src.dateCol;
    const before = await fetchAll(() => db.from(src.table).select(cols));
    const inRange = before.filter(r => {
      const d = dayOf(r[src.dateCol]);
      return d && (through ? d <= date : d === date);
    });
    // On the registers people also type into, only uploaded rows are ever taken. The rest are
    // counted so the answer can say plainly what was left alone rather than silently sparing it.
    const hit = src.uploadedOnly ? inRange.filter(r => r.upload_batch != null).length : inRange.length;
    if (src.uploadedOnly) protectedRows += inRange.length - hit;

    /* What ELSE goes when these rows go. A cascade that is only discovered afterwards is the
       worst kind of surprise in a system holding the company's follow-up history, so the count
       is taken whether or not this is a dry run, and reported either way. */
    if (src.cascades && hit) {
      const doomedKeys = new Set(inRange
        .filter(r => !src.uploadedOnly || r.upload_batch != null)
        .map(r => String(r[src.keyCol])));
      const kids = await fetchAll(() => db.from(src.cascades.table).select(src.cascades.on));
      cascaded[key] = { label: src.cascades.label, rows: kids.filter(r => doomedKeys.has(String(r[src.cascades.on]))).length };
      // And how many of the doomed rows are still live defaulters rather than dormant history.
      const live = inRange.filter(r => !(r.status == null && r.arrears == null)).length;
      if (live) cascaded[key].stillDefaulters = live;
    }

    if (!p.dryRun && hit) {
      let q = db.from(src.table).delete();
      /* A column carrying a CLOCK cannot be compared to a bare date: '2020-01-01T00:00:00Z'
         is not equal to '2020-01-01', so an equality test on a timestamp silently matches
         nothing and the clean reports success having deleted none of it. Timestamp columns get
         a whole-day range; date columns get the plain comparison they always had. */
      q = through
        ? q.lte(src.dateCol, date + (src.ts ? 'T23:59:59.999Z' : ''))
        : (src.ts
            ? q.gte(src.dateCol, date).lte(src.dateCol, date + 'T23:59:59.999Z')
            : q.eq(src.dateCol, date));
      if (src.uploadedOnly) q = q.not('upload_batch', 'is', null);
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
    deleted[key] = hit; total += hit;
  }
  return { date, through, dryRun: !!p.dryRun, deleted, total, protectedRows,
    cascaded: Object.keys(cascaded).length ? cascaded : undefined };
}

/** Email the week's expected-defaulter report to the admin address. Sent ONLY when someone
    presses the button -- there is no schedule behind this on purpose. A report that arrives
    every morning whether or not anyone wanted it stops being read within a fortnight, and
    then the one that mattered gets deleted with the rest.

    Needs two things set, and says which is missing rather than failing silently:
      RESEND_API_KEY   environment variable on the deployment (not a setting -- it is a secret)
      ADMIN_EMAIL      Settings, so finance can change the recipient without a deploy */
function expdfEmailHtml(d, sentBy) {
  const money0 = n => Math.round(num(n)).toLocaleString('en-US');
  const pctTxt = v => (v == null ? '—' : v + '%');
  const t = d.totals;
  const section = s => `
    <h3 style="margin:22px 0 6px;font:600 14px system-ui;color:#0B2A6B">${esc_(s.role)}</h3>
    <table style="width:100%;border-collapse:collapse;font:13px system-ui">
      <thead><tr style="background:#0B2A6B;color:#fff">
        <th align="left" style="padding:6px 8px">Leader</th>
        <th align="right" style="padding:6px 8px">Customers</th>
        <th align="right" style="padding:6px 8px">Initial</th>
        <th align="right" style="padding:6px 8px">Arrears now</th>
        <th align="right" style="padding:6px 8px">Recovered</th>
        <th align="right" style="padding:6px 8px">Rec %</th>
      </tr></thead><tbody>
      ${s.rows.length ? s.rows.map(r => `<tr style="border-bottom:1px solid #e5e7eb">
        <td style="padding:6px 8px">${esc_(r.leader)}</td>
        <td align="right" style="padding:6px 8px">${money0(r.customers)}</td>
        <td align="right" style="padding:6px 8px">${money0(r.initial)}</td>
        <td align="right" style="padding:6px 8px">${money0(r.arrears)}</td>
        <td align="right" style="padding:6px 8px;color:#067647;font-weight:700">${money0(r.recovered)}</td>
        <td align="right" style="padding:6px 8px">${pctTxt(r.pct)}</td></tr>`).join('')
        : '<tr><td colspan="6" style="padding:10px;color:#6b7280">No customers in this category.</td></tr>'}
      </tbody>
      <tfoot><tr style="background:#f1f5f9;font-weight:700">
        <td style="padding:6px 8px">TOTAL</td>
        <td align="right" style="padding:6px 8px">${money0(s.totals.customers)}</td>
        <td align="right" style="padding:6px 8px">${money0(s.totals.initial)}</td>
        <td align="right" style="padding:6px 8px">${money0(s.totals.arrears)}</td>
        <td align="right" style="padding:6px 8px">${money0(s.totals.recovered)}</td>
        <td align="right" style="padding:6px 8px">${pctTxt(s.totals.pct)}</td>
      </tr></tfoot></table>`;
  return `<div style="font:14px system-ui;color:#111;max-width:860px">
    <h2 style="margin:0 0 2px;color:#0B2A6B">HOPE PMO — Expected Defaulters, weekly recovery</h2>
    <div style="color:#6b7280;font-size:13px">Week of ${esc_(d.weekOf)} · as of ${esc_(d.date || '—')} (${esc_(d.weekday)}) · sent by ${esc_(sentBy)}</div>
    ${d.hasBaseline ? '' : '<p style="color:#B42318"><b>Monday’s initial deck is not uploaded</b>, so recovery below reads 0. Upload it and resend.</p>'}
    <p style="margin:14px 0 0"><b>Whole book:</b> ${money0(t.customers)} customers ·
      initial ${money0(t.initial)} · now ${money0(t.arrears)} ·
      recovered <b style="color:#067647">${money0(t.recovered)}</b> (${pctTxt(t.pct)})</p>
    ${d.sections.map(section).join('')}
  </div>`;
}
async function emailWeeklyExpdf(db, user, _args, nowMs) {
  requireAdmin(user);
  const key = process.env.RESEND_API_KEY;
  if (!key) throw badRequest('Email is not configured yet: set RESEND_API_KEY on the deployment (Vercel → Settings → Environment Variables).');
  const { data: toRow } = await db.from('settings').select('value').eq('key', 'ADMIN_EMAIL').maybeSingle();
  const to = String((toRow && toRow.value) || '').trim();
  if (!to) throw badRequest('Set ADMIN_EMAIL in Settings to say where the report should go.');
  const { data: fromRow } = await db.from('settings').select('value').eq('key', 'EMAIL_FROM').maybeSingle();
  const from = String((fromRow && fromRow.value) || '').trim() || 'HOPE PMO <onboarding@resend.dev>';

  const d = await expdfReport(db, user, { weekly: true }, nowMs);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: to.split(/[;,]/).map(x => x.trim()).filter(Boolean),
      subject: `HOPE PMO — Expected Defaulters weekly recovery (week of ${d.weekOf})`,
      html: expdfEmailHtml(d, user.name) }),
  });
  const body = await res.json().catch(() => ({}));
  // Surface the provider's own words: "domain not verified" is the usual first failure and
  // guessing at it would send someone hunting in the wrong place.
  if (!res.ok) throw badRequest(`Email provider refused it: ${body.message || res.status}`);
  return { sent: true, to, weekOf: d.weekOf, id: body.id || null,
    customers: d.totals.customers, recovered: d.totals.recovered };
}

/* ================================================================
   RECOVERY METRICS: OFF JANA and daily recovery per credit user

   "we need a widget and recognition of OFF JANA column for 7+ counting to know howmany of OFF
    JANA 7+ days customers were there and recovered/not there today, so we know 7+ recovery and
    who was making the followup so we get recovery rate by credit per customers they followed
    up and recovered per previous day. And daily followup should assign random customers to
    credits, at dashboard add credits dashboard showing no of recovered customers daily in week
    for each like Monday someone recovered 4 of 15 Tuesday 5 of 10 -- to sunday."

   OFF JANA  = a customer locked at 7+ days offline on the PREVIOUS day's current-defaulter deck.
   RECOVERED = that same customer's days_elapsed dropped below 7 by TODAY's deck.
   ASSIGNED  = OFF JANA customers handed to a credit officer for the day's followup, split by a
               fair round-robin so nobody's book is heavier than anyone else's by more than one.

   Team scoping runs through the same onTeams()/branches the rest of the portal uses -- a
   credit officer's team is call_users.team, which is the branch they registered under (the
   offline-queue register, not a deck-derived label), same as every other fix that had to stop
   showing "Kinondoni" and start showing the real branch. */

/** Whether a database row belongs to a credit officer -- the ONE definition, shared with
    callRoleKind (call-core.js) via isCreditRole, so the phone app and this board can never
    end up with two different opinions about who is a credit officer. */
function creditRoster(callUsers) {
  return callUsers.filter(u => u.active !== false && isCreditRole(u.role));
}

/** Customers locked at 7+ days offline on a given date -- OFF JANA for that day.
    Bounded to one date, one snapshot_type, and team scope; filtered to 7+ AT THE DATABASE so
    the row count is the handful actually locked, not the whole day's defaulter book. */
async function lockedCustomers(db, teams, onDate) {
  return fetchAll(() => onTeams(
    db.from('defaulter_snapshots')
      .select('ref, full_name, contact, days_elapsed, team')
      .eq('snapshot_type', 'current')
      .eq('snapshot_date', onDate)
      .gte('days_elapsed', 7),
    teams));
}

/** Round-robin by ref (sorted, so the split is deterministic and reproducible rather than
    order-of-arrival) -- the same "deal, don't dump the whole book on the first name" fairness
    rule dealMap uses for the call app's tabs. Nobody's pile differs from anyone else's by more
    than one. Returns { creditKey -> [customer, ...] }. */
function assignToCredits(customers, creditUsers) {
  const assigned = new Map();
  if (!creditUsers.length) return assigned;
  const sorted = customers.slice().sort((a, b) => String(a.ref || '').localeCompare(String(b.ref || '')));
  sorted.forEach((c, i) => {
    const key = creditUsers[i % creditUsers.length].user_id || creditUsers[i % creditUsers.length].name;
    (assigned.get(key) || assigned.set(key, []).get(key)).push(c);
  });
  return assigned;
}

/** Recovery metrics per credit officer per day of the week, Monday through Sunday.

    Output: { week: {from, to}, metrics: [{ weekday, date, creditUser, team, assigned, recovered }] }
      assigned  = OFF JANA customers from the PREVIOUS day, dealt to this credit officer
      recovered = of those, how many had dropped below 7 days by THIS day

    Postgres budget, answered:
      - 1 read for the credit roster (does not change day to day, so it is read once for the
        whole week, not once per day).
      - 1 read per day (Sun of the week before .. Sat of this one, 8 dates) for that day's
        OFF JANA list -- run in parallel, and each one is reused TWICE: once as "yesterday" for
        the day after it, once as "today" is never re-derived from it because recovery only
        ever asks what a locked customer's days_elapsed became, which is answered by the
        SECOND read below, not by re-fetching the lock list itself.
      - 1 read per day that actually had an OFF JANA list (at most 7), and that read is bounded
        to the .in(ref) of just those customers -- never the day's whole defaulter book.
      Worst case: 1 + 8 + 7 = 16 reads for a full week, every one bounded by team + date (and
      the last set additionally bounded to specific refs) at the database. A week with no OFF
      JANA customers at all costs 1 + 8 = 9 and stops there. */
async function recoveryByCredit(db, user, args = {}, nowMs) {
  const asOf = asOfWeek(nowMs, args.weekOf);
  const mon = asOf.weekOf, sun = addDaysKey(mon, 6);
  const teams = user.teams;

  const callUsers = await fetchAll(() => onTeams(
    db.from('call_users').select('user_id, name, team, role, active'), teams));
  const creditUsers = creditRoster(callUsers);
  if (!creditUsers.length) return { week: { from: mon, to: sun }, metrics: [] };

  // Sunday of the prior week through Saturday of this one: Monday's OFF JANA compares against
  // the last day with a deck, same as every other weekday compares against its own yesterday.
  const days = [];
  for (let i = -1; i < 7; i++) days.push(addDaysKey(mon, i));
  const lockedByDate = {};
  await Promise.all(days.map(async d => { lockedByDate[d] = await lockedCustomers(db, teams, d); }));

  const result = [];
  for (let i = 0; i < 7; i++) {
    const currDate = addDaysKey(mon, i);
    const prevLocked = lockedByDate[addDaysKey(mon, i - 1)] || [];
    if (!prevLocked.length) continue;

    // Bounded to exactly the customers being asked about -- the handful OFF JANA yesterday,
    // never the day's whole defaulter book.
    const refs = prevLocked.map(r => r.ref);
    const today = await fetchAll(() => onTeams(db.from('defaulter_snapshots')
      .select('ref, days_elapsed').eq('snapshot_type', 'current').eq('snapshot_date', currDate)
      .in('ref', refs), teams));
    const todayByRef = new Map(today.map(r => [r.ref, num(r.days_elapsed)]));
    const recovered = prevLocked.filter(r => { const d = todayByRef.get(r.ref); return d !== undefined && d < 7; });

    const assignedByCredit = assignToCredits(prevLocked, creditUsers);
    const recoveredByCredit = assignToCredits(recovered, creditUsers);

    for (const cu of creditUsers) {
      const key = cu.user_id || cu.name;
      const assigned = (assignedByCredit.get(key) || []).length;
      if (!assigned) continue;
      result.push({
        weekday: WD7[i], date: currDate, creditUser: cu.name || key, team: cu.team,
        assigned, recovered: (recoveredByCredit.get(key) || []).length,
      });
    }
  }

  return { week: { from: mon, to: sun }, metrics: result };
}

/* ------------------------------------------------------------------ dispatch */
function badRequest(m) { const e = new Error(m); e.status = 400; return e; }
function forbidden(m) { const e = new Error(m); e.status = 403; return e; }
/** Managing who can sign in is the one thing gated harder than team scope. */
function requireAdmin(user) {
  if (!(user.tabs || []).includes('settings')) throw forbidden('Settings (admin) permission required.');
}

const FN = {
  dashboard: (db, user, a, now) => buildDashboard(db, user, now),
  loans, loanPipeline, expected, defaulters, expectedDefaulters,
  followup, comments, addComment, promises, followupReport,
  complaints, addComplaint, saveComplaint, complaintLog, resolveComplaint, deleteComplaint,
  restructures, addRestructure, decideRestructure, restructureEligible, restructureContract,
  demandNotices, addDemandNotice, demandMessage, legalPreview, abnormal, received, findCustomer, rebuildFollowup,
  par, weekly, teamProgress, leaderReports, commission, commissionSave, assignments, credit,
  dashboardFull, expectedDay, saveTeam, deleteTeam, hints, officerBoards,
  staffRoster, saveStaffTeams,
  teams, saveRole, deleteRole, callAgents, saveCallAgent, settings: settingsList, settingSet,
  systemOpenGet, systemOpenSet, settingDelete,
  accessCodes, saveAccessCode, deleteAccessCode, callUsers, removeCallUser,
  storageUsage, purgeSnapshots, purgeSuperseded, changeMyCode, uploadStatus, followupClean,
  auditLog, fuStatuses, fuStatusesSave, perfHistory, stampWeek, teamsExport, staffExport, smsExport, smsGaps, contactsExport,
  announceSave, notifications, notifSeen, customerSearch,
  expdfMine, expdfReport, emailWeeklyExpdf,
  officerAccounts, saveOfficerAccount, deleteOfficerAccount,
  callReport: (db, user, a, now) => reportCoreForPortal(db, user, a, now),
  callOfficers, recoveryByCredit,
};

/* THE LEADERS TABLE, OUT AND BACK IN.
   "I want to upload updated leaders table but have an opt to download existing one so that I
    make the few updates and upload current"

   Which is the only sane way to edit forty rows of twenty columns. The export is deliberately
   in the SAME shape the importer reads, so the file that comes out goes straight back in after
   a few cells are changed -- an export in a different shape is a spreadsheet somebody has to
   re-type.

   Header names come from the importer's own vocabulary, not from the database column names, so
   the round trip cannot drift: if the importer learns a new column, it appears here too. */
const TEAM_EXPORT_COLS = [
  ['team', 'TEAM'], ['team_code', 'TEAM CODE'],
  /* "The upload template has no branch column, last time i lost all team codes i have to
     upload when sure" -- branch (2026-08-19-team-branch.sql) joined the importer the same day
     the column did, but this export was not touched, which is exactly the shape of the fault
     that cost the team codes before: a file this SAME comment already names as "in the same
     shape the importer reads" quietly fell out of that shape. BRANCH is the importer's own
     header (see importTeams in importers.js), so a downloaded, edited, and re-uploaded sheet
     now carries it both ways -- and, per the rule the team-code incident wrote, an admin who
     never re-downloads is safe regardless: a column their old file does not have is left alone,
     never blanked. */
  ['region', 'REGION'], ['branch', 'BRANCH'], ['zone', 'ZONE'],
  ['opm', 'OPM'], ['opm_no', 'OPM NO'],
  /* EARLY COL, not EXPECTED -- "my final thought of the teams and staff table" renamed this
     role on the sheet itself. The database column is still `expected`/`expected_no`; only the
     header changes, and importTeams still recognises EXPECTED too, so a file from before this
     rename still reads in exactly as it always did. */
  ['expected', 'EARLY COL'], ['expected_no', 'EARLY COL NO'], ['early_col_id', 'EARLY COL ID'],
  ['collection', 'COLLECTION'], ['collection_no', 'COL NO'], ['collection_id', 'COL ID'],
  ['recovery', 'RECOVERY'], ['recovery_no', 'RECOVERY NO'], ['recovery_id', 'REC ID'],
  ['credit', 'CREDIT'], ['credit_no', 'CREDIT NO'], ['credit_id', 'CREDIT ID'],
  ['gmo', 'GMO'], ['gmo_no', 'GMO NO'], ['gmo_id', 'GMO ID'],
  ['manager', 'MANAGER'], ['manager_no', 'MANAGER NO'], ['manager_id', 'MANAGER ID'],
  ['bike', 'BIKE'], ['bike_no', 'BIKE NO'], ['bike_id', 'BIKE ID'],
  ['legal', 'LEGAL'], ['legal_no', 'LEGAL NO'], ['legal_id', 'LEGAL ID'],
];

async function teamsExport(db, user) {
  requireAdmin(user);
  // The export carries every team's sign-in code, which is exactly what a view-only code must
  // never walk away with. The screens already mask it; a file would be the way around them.
  if (user.readOnly) throw forbidden('Msimbo huu ni wa kuangalia tu — faili hili linabeba misimbo ya timu. '
    + '/ This is a view-only code, and this file carries the team sign-in codes.');
  const [rows, book] = await Promise.all([
    fetchAll(() => db.from('teams').select('*').order('team', { ascending: true })),
    appPhoneBook(db),
  ]);
  /* The numbers come out refreshed from the app (see appPhoneBook), so the download-edit-upload
     round trip WRITES the fresh number into the sheet instead of quietly reviving a stale one. */
  const fresh = rows.map(t => overlayPhones(t, book));
  return {
    headers: TEAM_EXPORT_COLS.map(c => c[1]),
    /* Every column the export names, even where the migration that adds it has not been run --
       a blank column in the file is something an admin can fill in, whereas a MISSING column is
       a file that quietly cannot carry that field back. */
    rows: fresh.map(t => TEAM_EXPORT_COLS.map(c => (t[c[0]] == null ? '' : String(t[c[0]])))),
    count: rows.length,
  };
}

/* =======================================================================================
   THE PHONE LIST -- every leader and officer, with the number that actually rings.

     "I need my leaders and officers no.s so export excel of role, team, officername and
      phoneno"

   Four columns, one row per person per team, in three layers:

     the sheet's supervisors   every named role on every team (OPM ... COLLECTION), the
                               app's number where they are registered, the sheet's otherwise
     collection officers       from their access codes -- their teams live THERE, one row
                               per team they hold, skipped where the sheet already names
                               them on that team
     the app's field officers  everyone registered in HOPE Calls, the people no sheet
                               carries at all -- their number IS their registration

   Open to a read-only supervisor on purpose: it is a contact list, and unlike the leaders
   sheet it carries no sign-in codes.
   ======================================================================================= */
async function staffExport(db, user) {
  requireAdmin(user);
  const [teamRows, codeRows, callRows, cfg, book] = await Promise.all([
    fetchAll(() => db.from('teams').select('*').order('team', { ascending: true })),
    fetchAll(() => db.from('access_codes').select('code, name, role, teams')),
    fetchAll(() => db.from('call_users').select('name, phone, team, is_leader, leader_teams, active')),
    settingsMany(db, [PMO_ROLE_KEY]),
    appPhoneBook(db),
  ]);
  const pmoRoleName = cfg.get(PMO_ROLE_KEY, PMO_ROLE_DEFAULT);
  const mine = teamRows.filter(t => teamAllowed(user, t.team));

  const lines = [];
  const seen = new Set();
  const push = (role, team, name, phone) => {
    const key = K(role) + '' + K(team) + '' + K(name);
    if (seen.has(key)) return;
    seen.add(key);
    lines.push([role, team, name, String(phone || '').trim()]);
  };

  const ROLE_LABELS = { opm: 'OPM', recovery: 'RECOVERY', gmo: 'GMO', manager: 'MANAGER',
    credit: 'C. ANALYST', expected: 'EXPECTED', bike: 'BIKE', legal: 'LEGAL',
    collection: K(pmoRoleName) || 'COLLECTION' };

  // Layer one: the sheet's supervisors, team by team, app number first.
  for (const c of PHONE_ROLE_COLS) {
    for (const t of mine) {
      const who = String(t[c] || '').trim();
      if (!who) continue;
      const hit = book.get(K(who));
      push(ROLE_LABELS[c], t.team, who, hit ? hit.phone : t[c + '_no']);
    }
  }

  // Layer two: collection officers, whose teams live on their code, not on the sheet.
  for (const cd of codeRows) {
    if (!isPmoRole(cd.role, pmoRoleName)) continue;
    if (!cd.teams || !cd.teams.length) continue;
    const name = String(cd.name || cd.code).trim();
    const hit = book.get(K(name));
    for (const tm of upperTeams(cd.teams)) {
      if (!teamAllowed(user, tm)) continue;
      push(ROLE_LABELS.collection, tm, name, hit ? hit.phone : '');
    }
  }

  // Layer three: the app's own register -- leaders on the teams they lead, officers on
  // their team. A switched-off account is not on a call list.
  for (const u of callRows) {
    if (u.active === false) continue;
    const name = String(u.name || '').trim();
    const phone = String(u.phone || '').trim();
    if (!name || !phone) continue;
    if (u.is_leader) {
      const held = (u.leader_teams && u.leader_teams.length) ? upperTeams(u.leader_teams)
        : (u.team ? [K(u.team)] : []);
      for (const tm of held) if (teamAllowed(user, tm)) push('LEADER (APP)', tm, name, phone);
    } else if (u.team && teamAllowed(user, u.team)) {
      push('OFFICER', K(u.team), name, phone);
    }
  }

  return {
    headers: ['WADHIFA / ROLE', 'TIMU / TEAM', 'JINA / NAME', 'NAMBA / PHONE NO'],
    rows: lines,
    count: lines.length,
  };
}

/* =======================================================================================
   GOOGLE CONTACTS IMPORT -- every call-app sign-in as one importable contact.

     "The GM needs to get all company contacts into hq new phones by importing csv. so i
      googled the google import format and we need under exporting sms file add exporting
      company numbers (using all available info from call app signins)"

   The column set below is Google's own import format, header names EXACT as given --
   contacts.google.com (and a new phone's import screen) matches on the header text, so a
   renamed column is a silently dropped field. One row per registered person, phone-keyed the
   same way the app's identity is; switched-off accounts stay out, the same rule every board
   applies. The title is resolved by the ONE definition the whole system uses (teams-table
   role columns first, registration role otherwise, Officer as the default -- positionOf,
   shared with the call report), so the contact list can never disagree with the reports about
   who is a GMO.
   ======================================================================================= */
const GOOGLE_CONTACT_HEADERS = ['Name', 'Given Name', 'Additional Name', 'Family Name',
  'E-mail 1 - Type', 'E-mail 1 - Value', 'Phone 1 - Type', 'Phone 1 - Value',
  'Organization 1 - Name', 'Organization 1 - Title', 'Notes'];
/** +255-prefixed, because a contact imported onto a NEW phone with a bare nine-digit local
    number will not match incoming calls the way an E.164 one does. normPhone stores nine
    digits with no leading zero; anything unrecognisable passes through untouched rather than
    being mangled into a number nobody has. */
function e164Tz_(phone) {
  const p = String(phone || '').replace(/[^0-9]/g, '');
  if (/^[67]\d{8}$/.test(p)) return '+255' + p;
  if (/^0[67]\d{8}$/.test(p)) return '+255' + p.slice(1);
  if (/^255\d{9}$/.test(p)) return '+' + p;
  return String(phone || '').trim();
}
async function contactsExport(db, user) {
  // Staff personal numbers, the whole register at once -- admin only, and never through a
  // view-only code, the same fence teamsExport puts around the team sign-in codes.
  requireAdmin(user);
  if (user.readOnly) throw forbidden('Msimbo huu ni wa kuangalia tu — faili hili linabeba namba za wafanyakazi wote. '
    + '/ This is a view-only code, and this file carries every staff phone number.');
  const [callRows, teamRows] = await Promise.all([
    fetchAll(() => db.from('call_users').select('name, phone, team, role, is_leader, leader_teams, active')),
    fetchAll(() => db.from('teams').select('*')),
  ]);
  const { posOf } = buildLeaderMaps(teamRows);
  const rows = [];
  const seen = new Set();
  for (const u of callRows) {
    if (u.active === false) continue;
    const name = String(u.name || '').trim();
    const phone = e164Tz_(u.phone);
    if (!name || !phone) continue;
    const key = K(name) + '|' + phone;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = name.split(/\s+/);
    const title = positionOf(posOf, name, u.role);
    const held = (u.is_leader && u.leader_teams && u.leader_teams.length) ? upperTeams(u.leader_teams) : [];
    const notes = ['HOPE Calls sign-in', u.team ? 'Team: ' + u.team : '',
      held.length ? 'Leads: ' + held.join(', ') : ''].filter(Boolean).join(' · ');
    rows.push([
      name,
      parts[0] || '',
      parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
      parts.length > 1 ? parts[parts.length - 1] : '',
      '', '',                                    // no e-mail on record -- blank, never invented
      'Mobile', phone,
      'HOPE Microcredit', title, notes,
    ]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return { headers: GOOGLE_CONTACT_HEADERS, rows, count: rows.length };
}

/* STAMPING A WEEK BY HAND.
   "i always want to choose week and press stamp report so as to ferment permanent data of
    current uploaded weekly data and if i do so to that week again meaning i could overwrite it
    too in case like i reuploaded something to those dates"

   The weekly report already stamps the week it is showing every time it is opened, which is
   what makes the record fill itself in. This is the same act on purpose rather than by
   accident: pick a week, press the button, and that week's figures are written down as they
   stand right now.

   RE-STAMPING OVERWRITES, because the natural key is (period, period_start, metric, scope,
   name) -- so a week corrected by a re-upload is corrected in the record too, which is exactly
   the case the request names. Nothing accumulates and nothing has to be deleted first.

   It reports what it wrote, because a button that says nothing is a button nobody trusts. */
async function stampWeek(db, user, args, nowMs) {
  requireAdmin(user);
  const w = await weekly(db, user, { weekOf: args && args.weekOf }, nowMs);
  const leadBy = {};
  for (const t of (w.teamRows || [])) leadBy[K(t.team)] = t;
  const rows = recordsFor(w.teams || [], leadBy, w.weekOf);
  recordPerformance(db, w.teams || [], w.teamRows || [], w.weekOf, nowMs);
  return {
    weekOf: w.weekOf, weekEnd: w.weekEnd,
    teams: (w.teams || []).length,
    records: rows.length,
    /* What was actually captured, so pressing it on a week with no uploads behind it says so
       instead of silently writing nothing. */
    totals: { sales: w.teamTotals.sales, collected: w.teamTotals.collected,
      recovered: w.teamTotals.recovered, expected: w.teamTotals.expected },
    empty: rows.length === 0,
  };
}

/** THE PERFORMANCE HISTORY TAB. A read of what was recorded, never a recomputation -- the
    whole point is that these figures are NOT re-derived from a teams table that has since
    changed. */
async function perfHistory(db, user, args) {
  return performanceHistory(db, args || {});
}

/* THE FOLLOW-UP STATUS LIST. Read by anyone signed in -- every screen with a follow-up form
   needs it -- and written by an admin. The behaviours stay in code; see the note in
   call-core.js for why a status somebody adds is always a plain comment. */
async function fuStatuses(db) {
  return fuStatusConfig(db);
}

async function fuStatusesSave(db, user, p) {
  requireAdmin(user);
  const list = parseFuStatuses(p && p.list);
  /* parseFuStatuses falls back to the built-in ten on an empty box, so this cannot save an
     empty list -- an empty dropdown is a screen nobody can use, and somebody clearing the box
     by accident must not be able to stop the whole company logging a follow-up. */
  const value = list.join('\n');
  const { error } = await db.from('settings').upsert({ key: FU_STATUS_KEY, value }, { onConflict: 'key' });
  noteSettingsWritten(db);
  if (error) throw new Error(error.message);
  return fuStatusShape(list);
}

/** THE AUDIT TAB. Admin-only to start with, and openable to others the ordinary way: the tab
    is called `audit`, so ticking it on a role in Teams & Staff gives that role the nav item and
    this function, exactly as every other tab in this system is granted. There is no second
    permission mechanism here, because a second mechanism is a second thing to get wrong. */
async function auditLog(db, user, args) {
  const tabs = user.tabs || [];
  if (!tabs.includes('settings') && !tabs.includes('audit')) {
    throw forbidden('Kumbukumbu ya matendo ni ya admin. / The audit log is admin-only until the tab is granted to your role.');
  }
  return auditList(db, args || {});
}

/* Everything that changes state: the audited writes, plus the two maintenance writes that are
   deliberately not in the audit log. Kept beside the gate that uses it so a new write function
   gets added to BOTH lists in one glance -- and the test that walks FN checks the naming. */
const WRITE_FNS = new Set([...AUDITED, 'stampWeek', 'rebuildFollowup']);

export async function portalApi(db, user, fn, args, nowMs = Date.now()) {
  const h = FN[fn];
  if (!h) throw badRequest('Unknown portal function: ' + fn);
  /* THE READ-ONLY WALL. One check at the one door every portal call passes through, so a
     supervisor's code -- or an AI signed in with it -- can try every screen and change
     nothing. Refused loudly rather than silently ignored: a button that appears to work but
     does not is the worst kind of supervision. */
  if (user && user.readOnly && WRITE_FNS.has(fn)) {
    throw forbidden('Msimbo huu ni wa kuangalia tu — hakuna kinachobadilishwa nao. '
      + '/ This is a view-only code: it can open every screen but never change anything. '
      + '(' + fn + ' was refused.)');
  }
  /* THE ONE DOOR, so the audit log has one place to be written from. A log that has to be
     remembered at each of a hundred call sites is a log with holes in it, and a log with holes
     invites the conclusion that what is missing did not happen. Reads pass straight through --
     see api/_lib/audit.js for why only the writes are recorded, and why the arguments are
     reduced to a few identifying fields rather than stored whole. */
  return audited(db, user, fn, args || {}, () => h(db, user, args || {}, nowMs));
}

export { assignFor };
export const PORTAL_FUNCTIONS = Object.keys(FN);

/* =======================================================================================
   THE v1 DASHBOARD, rebuilt on v2 data.

   The generic KPI+table dashboard was not what the operation actually reads. The real one
   is: five headline cards, four weekday trend grids (loan applications Mon-Sun, sales
   Mon-Fri, collection Mon-Fri, recovery Mon-Sun), the loan pipeline funnel, and a team
   performance table carrying the leader names beside the numbers -- because the meeting
   asks "whose team is this?" before it asks "how much?".
   ======================================================================================= */

const WD5 = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
/* Sales, and only sales, run six days -- "there happen to be approved sales on saturdays".
   The weekly TARGET stays a 5-working-day figure (see dailyTarget below); this is only which
   days the trend widget counts actual approvals on, so a Saturday sale is shown, not dropped. */
const WD6 = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WD7 = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Snapshot date of a given weekday inside the week containing nowMs. */
function dateOfWeekday(nowMs, wd) { return addDaysKey(weekMondayKey(nowMs), WD7.indexOf(wd)); }

/** A setting that is TEXT rather than a number. Blank reads as "not set", so a key somebody
    cleared falls back to the built-in default instead of matching nothing at all. */
/** THE EARLY-COLLECTION LIST: who is due NEXT, so the officer can collect before the day.
 *
 *  This used to read the "Expected Tomorrow" report and nothing else -- and that report is not
 *  uploaded here. The essential Expected reports in this operation are INITIAL and the day's
 *  own, and it is the INITIAL list that early collection is worked from. So the board was
 *  silently empty: no error, no note, just an officer board with nobody on it.
 *
 *  Initial is preferred and Tomorrow is the fallback, so whichever of the two a company
 *  actually uploads is the one used, and neither has to be explained to anybody. The source is
 *  returned as well as the rows, because a board built from a report nobody uploaded should say
 *  so rather than look like a team that collected nothing.
 *
 *  Costs one round trip on the normal path -- the fallback only runs when the first is empty. */
async function earlyList(db, { today, teams }) {
  const ini = await expectedTotalsLatest(db, { type: 'initial', notAfter: today, teams });
  if (ini.rows.length) return { ...ini, source: 'initial' };
  const tmw = await expectedTotalsLatest(db, { type: 'tomorrow', notAfter: today, teams });
  return { ...tmw, source: tmw.rows.length ? 'tomorrow' : null };
}

async function settingStr(db, key, dflt) {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  const v = String((data && data.value) || '').trim();
  return v || dflt;
}

/** SEVERAL SETTINGS, ONE JOURNEY.
 *
 *  Reading them one at a time is a round trip each, and the sales target alone cost two before
 *  it was even used -- `settingNum(A, await settingNum(B, ...))` always evaluates the fallback,
 *  so the second query ran whether or not the first had an answer.
 *
 *  Returns { get(key, dflt), num(key, dflt) }. A key that is absent or blank falls back, so a
 *  cleared setting behaves the same as one that was never typed. */
/* THE SETTINGS TABLE IS CONFIG, AND IT WAS READ THREE TIMES TO BUILD ONE SCREEN.

   Measured on a forty-team book: the dashboard read `settings` three times in a single request,
   because three different pieces of it each asked for the keys they wanted. Every one of those
   is a round trip to fetch a handful of rows from a table that holds a few dozen and changes
   when somebody types in Settings -- which is rare, and never in the middle of a request.

   So it is read ONCE, whole, and remembered for a few seconds. Whole because the table is
   config-sized: filtering to four keys saves nothing on the wire and costs the sharing.

   AN ADMIN MUST SEE THEIR OWN CHANGE IMMEDIATELY, so every write drops the memo (noteSettingsWritten)
   rather than leaving somebody to wonder whether Save worked. The clock is only a backstop for a
   change made on ANOTHER instance of this function. */
/* THE TEAMS TABLE IS READ SIXTEEN DIFFERENT PLACES, AND IT IS THE SAME FIFTY ROWS EVERY TIME.

   Every screen that names a leader, scopes a figure or resolves a rotation reads it, and several
   read it TWICE in one request -- the calls report does, measured. It is small, and small read
   forty times a minute is still forty journeys.

   Remembered for a few seconds, exactly like the settings table beside it and the role map on
   the phone side. A team edit DROPS the memo (noteTeamsWritten) so an admin sees their own
   change at once; the clock is only a backstop for a change made on another instance. */
const TEAMS_TTL_MS = 15000;
const teamsCache = new WeakMap();

export function noteTeamsWritten(db) { teamsCache.delete(db); }

/** Every per-team board reads readTeamsAll's own 20-second cache, so this almost never costs a
    round trip of its own -- whatever report called it has usually already warmed the cache
    resolving OPM/GMO/manager names for the same rows. A Map, not a plain object, because a team
    name is looked up by its normalised key (K()) and a Map does not collide with a JS built-in
    ("constructor", "toString") the way `{}` can. See "the branches column is in all reports
    just before the team column" -- this is the one place that answer is worked out. */
async function branchByTeam(db, nowMs) {
  const rows = await readTeamsAll(db, nowMs);
  const by = new Map();
  for (const t of rows || []) by.set(K(t.team), t.branch || null);
  return by;
}

async function readTeamsAll(db, nowMs) {
  const at = nowMs || Date.now();
  const hit = teamsCache.get(db);
  if (hit && (at - hit.at) < TEAMS_TTL_MS) return hit.rows;
  const rows = await fetchAll(() => db.from('teams').select('*'));
  teamsCache.set(db, { at, rows });
  return rows;
}

const SETTINGS_TTL_MS = 20000;
const settingsCache = new WeakMap();

export function noteSettingsWritten(db) { settingsCache.delete(db); }

async function readSettings(db, nowMs) {
  const at = nowMs || Date.now();
  const hit = settingsCache.get(db);
  if (hit && (at - hit.at) < SETTINGS_TTL_MS) return hit.by;
  const rows = await fetchAll(() => db.from('settings').select('key, value'));
  const by = {};
  for (const r of rows) by[String(r.key)] = r.value;
  settingsCache.set(db, { at, by });
  return by;
}

async function settingsMany(db, keys) {
  const by = await readSettings(db);
  const get = (k, dflt) => { const v = String(by[k] == null ? '' : by[k]).trim(); return v || dflt; };
  return { get, num: (k, dflt) => { const n = parseInt(String(get(k, '')).replace(/[^0-9]/g, ''), 10); return (!n || isNaN(n)) ? dflt : n; } };
}

/** One setting's value as text, or '' when it is not set. settingNum's sibling -- several
    settings are words or phone numbers rather than amounts, and stripping them to digits the
    way settingNum does would turn a message template into nothing. */
async function settingGet(db, key) {
  const by = await readSettings(db);
  return String(by[key] == null ? '' : by[key]).trim();
}

async function settingNum(db, key, dflt) {
  const n = parseInt(String(await settingGet(db, key)).replace(/[^0-9]/g, ''), 10);
  return (!n || isNaN(n)) ? dflt : n;
}

/* =====================================================================================
   READING A WEEK THAT HAS ALREADY HAPPENED.
   =====================================================================================
   "I need a Mondays date picker at dashboard and presentations so that if I choose a last
    weeks Monday then I get last weeks reports / performances"

   Every figure on these two screens is derived from one moment -- todayKey, weekMondayKey and
   currentWeekday all read it, and so does buildDashboard. So rather than teach a hundred
   derivations about a second date, the MOMENT ITSELF moves. Pick a past week and the screen is
   computed exactly as it would have been computed then, by the same code, with no branch that
   only runs for history and can therefore drift from the one people watch every day.

   A FINISHED WEEK READS AS OF ITS FRIDAY. The dashboard is "today, and the week around it", so
   a past week needs a "today" -- and for a week that is over, the honest one is the last
   working day. Choose last Monday and you get the week as it stood at the close of business on
   Friday, which is the week the room actually discusses.

   THE CURRENT WEEK IS ALWAYS NOW. Picking this week's Monday -- or nothing at all -- leaves
   the clock alone, so the live screen is bit-for-bit what it was before this existed.

   ANY DAY IN THE WEEK WILL DO. The picker offers Mondays, but a date typed by hand, or pasted,
   or arrived at through a phone's date wheel, is snapped to its own Monday instead of being
   rejected or quietly read as a different week. */
/* WHY PRESSING A DATE LOOKED LIKE IT DID NOTHING.

     "I tried pressing the date picker to 10th august so that all info start of next week but
      didn't work"

   Picked on Sunday the 9th, the 10th is NEXT week. This function accepted only a Monday
   strictly EARLIER than the current one and otherwise returned the current week -- silently.
   So the screen redrew with exactly the same figures it already had, and there was nothing
   anywhere to say the choice had been overruled. A control that ignores you without saying so
   is indistinguishable from a broken one, and it was reported as broken.

   "Dashboard date should be able to slide next week since am uploading next week progress
   reports too" / "so backward and foward should both work" -- the future week is no longer
   clamped back to this one. The clamp assumed a week that has not happened yet has nothing in
   it, and that stopped being true the moment reports started arriving for it in advance --
   this now reads whatever has actually been uploaded for that week, same as any other, and
   simply shows zeros where nothing has landed yet rather than refusing to look. `requested`
   and `future` still come back with the answer so the week bar can label an upcoming week as
   what it is, without pretending the choice was overruled. */
export function asOfWeek(nowMs, weekOf) {
  const thisMon = weekMondayKey(nowMs);
  const blank = { ms: nowMs, weekOf: thisMon, past: false, requested: null, future: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekOf || ''))) return blank;
  // Midday, so no amount of timezone arithmetic can roll the chosen date onto its neighbour.
  const pickedMon = weekMondayKey(Date.parse(String(weekOf) + 'T09:00:00Z'));
  if (pickedMon === thisMon) return { ...blank, requested: pickedMon };
  // Same reference point (Friday, the close of that week's business) whether the week is
  // behind or ahead -- a future week being read here is one an officer has already populated
  // in advance, so it gets read as a whole week too, not as a partial one.
  const asOfMs = Date.parse(addDaysKey(pickedMon, 4) + 'T09:00:00Z');
  if (pickedMon > thisMon) return { ms: asOfMs, weekOf: pickedMon, past: false, requested: pickedMon, future: true };
  return { ms: asOfMs, weekOf: pickedMon, past: true, requested: pickedMon, future: false };
}

/* =======================================================================================
   THE MONTH LEDGER -- the month cards remember their own progress.

   Every attempt at computing the month inside one request has failed on the live instance:
   raw rows for a month do not come back; one month-wide aggregate does not come back; and
   even week-sized aggregate slices -- ten sequential calls -- do not all fit a time budget
   there. What DOES hold is that one week-sized call answers, every dashboard load proves it.

   So the month is assembled once and REMEMBERED, in the one table every deployment has:
   settings. One row per month, per-team per-day sums, written by whoever computes them.
   Each compute does the live week's slice first (those days keep changing under uploads),
   then as many missing earlier slices as fit the budget, stores its progress, and answers
   only when every day of the month is in hand -- so a cold ledger fills across two or three
   loads and the tiles show a dash meanwhile, never a wrong number. Once the earlier weeks
   are frozen in the ledger, every later load costs one settings read and one live-week
   slice. Days before the current week freeze as computed: a re-upload of a date that old is
   rare, and the clean-reports screen exists for history surgery.

   The per-day cell keeps each TEAM separately, so a scoped officer sums their own teams out
   of the same ledger an admin filled. Recovery pairs each day's initial against its current
   deck (the day's own weekday, as everywhere), and the day's paired flag gates the sum --
   never a gap between two different populations. */
const MONTH_LEDGER_PREFIX = 'MONTH_LEDGER_';
function monthDayCell_(d, expRows, defRows) {
  const rows = pickLatestBatchRows(expRows.filter(r => String(r.snapshot_date) === d));
  const dwd = WD7[isoWeekday(Date.parse(d + 'T12:00:00Z')) - 1];
  const ini = pickLatestBatchRows(defRows.filter(r => String(r.snapshot_date) === d && r.snapshot_type === 'initial' && r.weekday === dwd));
  const cur = pickLatestBatchRows(defRows.filter(r => String(r.snapshot_date) === d && r.snapshot_type === 'current' && r.weekday === dwd));
  const t = {};
  const cell = T => (t[T] = t[T] || { e: 0, c: 0, u: 0, ri: 0, rc: 0, p: 0 });
  for (const r of rows) { const s = cell(K(r.team)); s.e += num(r.expected_amt); s.c += num(r.collected_amt); s.u += num(r.uncollected_amt); }
  const paired = (ini.length && cur.length) ? 1 : 0;
  for (const r of ini) cell(K(r.team)).ri += num(r.arrears_amt);
  for (const r of cur) cell(K(r.team)).rc += num(r.arrears_amt);
  for (const T in t) t[T].p = paired;
  return t;
}
async function monthLedger_(db, user, { monthStart, today, mon, budgetMs }) {
  const deadline = Date.now() + budgetMs;
  const key = MONTH_LEDGER_PREFIX + monthStart.slice(0, 7);
  let ledger = null;
  try { ledger = JSON.parse((await settingGet(db, key)) || 'null'); } catch (e) {}
  if (!ledger || typeof ledger !== 'object' || !ledger.days) ledger = { days: {} };

  const [sumE, sumF] = await Promise.all([
    monthSummaryRows(db, 'expected', { from: monthStart, to: today }),
    monthSummaryRows(db, 'defaulter', { from: monthStart, to: today }),
  ]);

  /* The live week first -- its days keep changing under uploads -- then only the frozen
     slices still missing. One slice is the call size this database answers; the deadline
     decides how many fit today, and the store carries the rest to the next load. */
  const weekFloor = mon > monthStart ? mon : monthStart;
  const jobs = [];
  if (weekFloor <= today) jobs.push([weekFloor, today]);
  for (let d = monthStart; d < weekFloor; d = addDaysKey(d, 7)) {
    const to0 = addDaysKey(d, 6) < weekFloor ? addDaysKey(d, 6) : addDaysKey(weekFloor, -1);
    let missing = false;
    for (let x = d; x <= to0; x = addDaysKey(x, 1)) if (!ledger.days[x]) { missing = true; break; }
    if (missing) jobs.push([d, to0]);
  }
  let changed = false;
  for (const [f, t0] of jobs) {
    if (Date.now() > deadline) break;         // stored progress resumes on the next load
    const slice = await totalsAggSlice(db, { from: f, to: t0 });
    if (!slice) return null;                  // the totals functions are not installed here
    const expAll = slice.exp.concat(sumE), defAll = slice.def.concat(sumF);
    for (let x = f; x <= t0; x = addDaysKey(x, 1)) {
      ledger.days[x] = monthDayCell_(x, expAll, defAll);
      changed = true;
    }
  }
  if (changed) {
    // Best-effort: a lost write only means the next load recomputes what this one just did.
    await runQuery(() => db.from('settings')
      .upsert({ key, value: JSON.stringify(ledger) }, { onConflict: 'key' }));
  }
  for (let d = monthStart; d <= today; d = addDaysKey(d, 1)) if (!ledger.days[d]) return null;

  let colE = 0, colC = 0, recR = 0, recU = 0;
  for (let d = monthStart; d <= today; d = addDaysKey(d, 1)) {
    const cellMap = ledger.days[d];
    for (const T in cellMap) {
      if (!teamAllowed(user, T)) continue;
      const s = cellMap[T];
      colE += s.e; colC += s.c; recU += s.u;
      if (s.p) recR += s.ri - s.rc;
    }
  }
  return { colE, colC, recU, recR };
}

async function dashboardFull(db, user, args, nowMs) {
  const asOf = asOfWeek(nowMs, args && args.weekOf);
  nowMs = asOf.ms;
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs), sun = addDaysKey(mon, 6);
  const wdToday = currentWeekday(nowMs);
  const base = await buildDashboard(db, user, nowMs);

  /* THE LOANS TABLE, READ TWICE ON PURPOSE, AND NEITHER READ IS THE WHOLE OF IT.
     One read used to carry every loan the company has ever written, with ten columns each, so
     that four figures could be worked out. Two figures actually need every loan, and they need
     two columns; the rest need this week and this month.

       funnel      every loan, but not one row of it. The pipeline funnel is eight COUNTS --
                   how many applications sit at each stage -- and that is an all-time question
                   by definition. Eight requests that each answer with a number and no body at
                   all, instead of thirty thousand rows carried here to be counted. Counting is
                   the database's job; that is the first question the speed guard asks.
       loansAll    the trends and the team board: applications by the day they were created,
                   sales by the day they were approved. Bounded to this week and this month,
                   which is the furthest either one looks.

     `or` rather than two reads, because a loan qualifies on EITHER date -- an application
     created this week whose approval is older, or an approval this month on an application
     from June. A loan with neither is excluded, which is right: every figure below skips a row
     whose date falls outside its window anyway. */
  const monthStart0 = String(today).slice(0, 7) + '-01';
  const loanFloor = monthStart0 < mon ? monthStart0 : mon;
  const abnWin = abnormalWindow(nowMs, args);
  /* THE MONTH MUST NEVER BE ABLE TO TAKE THE DASHBOARD DOWN, and it has managed it twice:
     once through the raw fallback reading a month of customer rows, and once through the
     month-wide AGGREGATE itself being slow on the live instance even with the database doing
     the summing. So the week reads below are the backbone, exactly the shape they were before
     the month cards existed, and the month walks itself in week-sized slices of the aggregate
     beside them (monthTotalsChunked) -- the question size the weekly reads prove fast on
     every load -- under a hard time budget, cached for the minute the dashboard's other
     answers live so only the first viewer pays. Any month failure of ANY kind costs the two
     tiles a dash, never the screen -- hence the .catch. */
  const MONTH_BUDGET_MS = 8000;
  const monthPromise = cachedAnswer(db, 'monthCards|' + monthStart0, user, nowMs, () =>
    monthLedger_(db, user, { monthStart: monthStart0, today, mon, budgetMs: MONTH_BUDGET_MS })
      .catch(() => null));
  const [expWeek, defWeek, funnelCounts, loansAll, abn, teamRows, abnPaid] = await Promise.all([
    expectedTotalsInRange(db, { type: 'today', from: mon, to: sun, teams: user.teams }),
    defaulterTotalsInRange(db, { from: mon, to: sun, teams: user.teams }),
    stageCounts(db, user.teams),
    fetchAll(() => onTeams(db.from('loans')
      /* upload_date rides along because it is the day the admin CHOSE for the report, and a
         re-uploaded loan keeps its original created_at -- windowing on created_at alone would
         drop a row whose stamp is this week but whose first insert was last month. */
      .select('id, stage, team, created_at, upload_date, approved_date, approved_by, created_by, requested_amt, principal_amt, loan_amt')
      .or(`created_at.gte.${loanFloor},approved_date.gte.${loanFloor},upload_date.gte.${loanFloor}`), user.teams)),
    /* Team-scoped at the database. The dashboard is the most-opened screen in the system and
       this read had no filter at all -- every abnormal payment ever recorded, on every load,
       for a figure that is then narrowed to the viewer's own teams anyway. The number on
       screen does not change; the amount of table that has to move to produce it does. */
    fetchAll(() => {
      let q = db.from('abnormal_payments').select('team, paid, transaction_id');
      if (user.teams && user.teams.length) q = q.in('team', upperTeams(user.teams));
      return q;
    }),
    readTeamsAll(db),
    /* THE SAME RULE THE ABNORMAL PAYMENTS TAB APPLIES.

         "abnomal payments worked but not counting at dashboard"

       The tab learned to work irregular payments out for itself; this tile did not, so it went
       on counting only the rows somebody had uploaded. Two screens, one question, two answers
       -- and the dashboard's was the smaller one, which is the direction nobody notices.

       Three narrow columns, TEAM-SCOPED and WINDOWED in the query, over the same window the
       tab uses. received_payments only grows, and the dashboard is the most-opened screen in
       the system, so this is the least that can answer the question honestly. */
    fetchAll(() => onTeams(db.from('received_payments')
      .select('team, amount_paid, transaction_id')
      .gte('paid_at', abnWin.from).lte('paid_at', abnWin.to), user.teams)),
  ]);
  const month = await monthPromise;
  const weeklyTarget = await settingNum(db, 'SALES_TARGET_WEEKLY', await settingNum(db, 'SALES_TARGET', 100000000));

  const monthOk = !!month;
  const myExpWeek = scoped(user, expWeek), myDefWeek = scoped(user, defWeek);
  const myLoans = scoped(user, loansAll);
  /* Uploaded rows, plus the ones the rule finds -- with an uploaded row winning for the same
     transaction, exactly as the Abnormal Payments tab resolves it. The two screens now count
     the same thing because they apply the same rule to the same window. */
  const abnStep = await settingNum(db, ABN_STEP_KEY, ABN_STEP_DEFAULT);
  const abnUploaded = scoped(user, abn);
  const abnSeen = new Set(abnUploaded.map(r => K(r.transaction_id)).filter(Boolean));
  const abnFound = scoped(user, abnPaid)
    .filter(r => isAbnormalAmount(r.amount_paid, abnStep))
    .filter(r => !abnSeen.has(K(r.transaction_id)))
    .map(r => ({ team: r.team, paid: num(r.amount_paid) }));
  const myAbn = abnUploaded.concat(abnFound);
  const myTeams = teamRows.filter(t => teamAllowed(user, t.team));
  const dayRows = (rows, d) => rows.filter(r => String(r.snapshot_date) === d);

  /* ---- loan applications per weekday: unassigned + assigned, by the day the admin CHOSE ----

       "still didnt update: the thing worked to thursday.. the day i started uploading friday
        started taking them"

     This grouped by created_at -- the moment the row was INSERTED -- so the board agreed with
     the admin only while each day's file was uploaded on its own day. Friday's file uploaded
     on Sunday filed its 79 apps under Sunday, whatever the date box said; and created_at is a
     UTC timestamp besides, so even a same-day evening upload drifted a day. The upload stamp
     is the day the admin chose, said in the confirmation, replace-scoped, and stable across
     re-uploads: the SAME loan re-uploaded under a corrected date simply moves (one row, one
     id -- no duplicate to make), while created_at keeps its first-insert moment forever.
     Rows from before the stamp existed fall back to created_at, as before. */
  const appsTrend = WD7.map((wd, i) => {
    const d = addDaysKey(mon, i);
    const on = myLoans.filter(l => String(l.upload_date || l.created_at || '').slice(0, 10) === d);
    const u = on.filter(l => l.stage === 'unassigned').length;
    const a = on.filter(l => l.stage === 'assigned').length;
    return { weekday: wd, date: d, unassigned: u, assigned: a, apps: u + a,
      amount: on.filter(l => l.stage === 'unassigned' || l.stage === 'assigned')
        .reduce((s, l) => s + (num(l.requested_amt) || num(l.principal_amt)), 0) };
  });

  /* ---- sales trend Mon-Sat: approved principal per day against the daily target ----
     dailyTarget itself is still a 5-WORKING-DAY figure -- the quota does not change, only how
     many days are shown against it. A Saturday approval used to be approved for real and then
     simply never counted anywhere on this board -- not the day it happened, not the week's
     total -- "there happen to be approved sales on saturdays, so add its widget at dashboard
     too". */
  const dailyTarget = Math.round(weeklyTarget * Math.max(myTeams.length, 1) / 5);
  const salesTrend = WD6.map((wd, i) => {
    const d = addDaysKey(mon, i);
    const on = myLoans.filter(l => SALES_STAGES.includes(l.stage) && String(l.approved_date || '').slice(0, 10) === d);
    const amt = on.reduce((s, l) => s + (num(l.principal_amt) || num(l.loan_amt)), 0);
    return { weekday: wd, date: d, amount: amt, loans: on.length,
      pct: dailyTarget > 0 ? Math.round((amt / dailyTarget) * 1000) / 10 : null };
  });

  /* ---- collection trend Mon-Fri: collected + uncollected per weekday ---- */
  const colTrend = WD5.map((wd, i) => {
    const d = addDaysKey(mon, i);
    const rows = pickLatestBatchRows(dayRows(myExpWeek, d));
    const exp = tExpected(rows);
    const col = tCollected(rows);
    /* A DAY NOBODY HAS UPLOADED IS NOT A DAY OF ZERO COLLECTION.
       Thursday showing "TZS 0 / Col 0%" on Wednesday afternoon makes the week look like a
       disaster when nothing has happened yet at all. The totals were always right -- an empty
       day adds nothing to either side of the sum -- but the tile was not, so this says which
       days actually have a sheet behind them and the screen stops guessing. */
    return { weekday: wd, date: d, expected: exp, collected: col, uncollected: tUncollected(rows),
      uploaded: rows.length > 0,
      pct: exp > 0 ? Math.round((col / exp) * 1000) / 10 : null };
  });

  /* ---- recovery trend Mon-Sun: each day's own initial - current, over that day's uncollected.
          Sat/Sun have no collection baseline, so they read "full recovery" like v1. ---- */
  const recTrend = WD7.map((wd, i) => {
    const d = addDaysKey(mon, i);
    /* DATE, TYPE **AND WEEKDAY**. Without the weekday this paired whichever initial batch was
       newest on that date against whichever current batch was newest -- possibly two different
       weekdays, i.e. two different populations -- and reported the gap between them as
       recovery. On a real book that produced 2.9 billion recovered on one day and MINUS 1.9
       billion on the next, against a whole book of 2.1 billion. */
    const dwd = WD7[i];
    const ini = pickLatestBatchRows(myDefWeek.filter(r => String(r.snapshot_date) === d && r.snapshot_type === 'initial' && r.weekday === dwd));
    const cur = pickLatestBatchRows(myDefWeek.filter(r => String(r.snapshot_date) === d && r.snapshot_type === 'current' && r.weekday === dwd));
    const from = tArrears(ini);
    const to = tArrears(cur);
    const rec = (ini.length && cur.length) ? from - to : 0;
    const unc = tUncollected(pickLatestBatchRows(dayRows(myExpWeek, d)));
    return { weekday: wd, date: d, from, to, recovered: rec, uncollected: unc,
      /* WHAT IS STILL OUT AT THE END OF THE DAY -- which is not the same number as what went
         uncollected at the start of it, and the tile was showing the second under the first
         one's name. Tuesday leaves 8m uncollected, the officers get 2m of it back, so 6m is
         still out. That is the figure somebody acts on tomorrow morning.

         Clamped at zero: recovery comes off the DEFAULTER decks, a different population from
         today's expected list, so a good day can bring back more than the day itself left
         behind. "Unrecovered TZS -2,000,000" reads as an error rather than as good news. When
         that happens the Rec % beside it goes above 100, which is where the room should be
         looking anyway. */
      unrecovered: Math.max(0, unc - rec),
      uploaded: !!(ini.length || cur.length),
      pct: unc > 0 ? Math.round((rec / unc) * 1000) / 10 : null,
      full: i >= 5 && rec > 0 };
  });

  /* ---- THE MONTH, DAY BY DAY, UNDER THE SAME RULES AS THE WEEK ----
     Each day is batch-resolved on its own (a report uploaded twice must not double a month),
     collection sums the latest deck per day, and recovery pairs each day's initial against
     its current ON THE SAME WEEKDAY -- the exact rule recTrend fought for, because pairing
     two different weekdays' decks reports the gap between two populations as recovery. */
  // The month ledger already did the day-by-day arithmetic -- see monthLedger_ above.
  const colMonthExpected = monthOk ? month.colE : 0;
  const colMonthCollected = monthOk ? month.colC : 0;
  const recMonthRecovered = monthOk ? month.recR : 0;
  const recMonthUncollected = monthOk ? month.recU : 0;

  /* ---- pipeline funnel: an ALL-TIME count per stage, counted by the database ---- */
  const funnel = STAGES.map(st => ({ stage: st, count: funnelCounts[st] || 0 }));

  /* ---- team performance: numbers WITH the leader names beside them ---- */
  const todayExp = pickLatestBatchRows(dayRows(myExpWeek, today));
  const tomorrowSnap = await earlyList(db, { today, teams: user.teams });
  const earlyExp = scoped(user, tomorrowSnap.rows);
  /* Today's own weekday, so the headline counts and the team board describe ONE deck rather
     than whichever two happened to be uploaded last. This is the same rule the RECOVERED card
     has always used -- the card was right and these were not. */
  const iniToday = pickLatestBatchRows(myDefWeek.filter(r => String(r.snapshot_date) === today && r.snapshot_type === 'initial' && r.weekday === wdToday));
  const curToday = pickLatestBatchRows(myDefWeek.filter(r => String(r.snapshot_date) === today && r.snapshot_type === 'current' && r.weekday === wdToday));
  const pairedToday = !!(iniToday.length && curToday.length);

  const T = {};
  const slot = t => {
    const k = t || '(no team)';
    if (!T[k]) T[k] = { team: k, branch: null, recovery: null, gmo: null, manager: null, opm: null, bike: null,
      initArrears: 0, curArrears: 0, recovered: 0, sales: 0, salesMonth: 0, salesPct: null,
      expToday: 0, colToday: 0, collPctToday: null, expEarly: 0, colEarly: 0, collPctEarly: null,
      expWeek: 0, colWeek: 0, collPctWeek: null,
      uncolMon: 0, uncolYest: 0, uncolWeek: 0,
      defaulters: 0, abnormal: 0 };
    return T[k];
  };
  for (const t of myTeams) {
    const s = slot(t.team);
    s.recovery = t.recovery || null; s.gmo = t.gmo || null; s.manager = t.manager || null;
    s.opm = t.opm || null; s.bike = t.bike || null; s.branch = t.branch || null;
  }
  for (const r of iniToday) slot(r.team).initArrears += num(r.arrears_amt);
  for (const r of curToday) { const s = slot(r.team); s.curArrears += num(r.arrears_amt); s.defaulters += num(r.customers); }
  for (const r of todayExp) { const s = slot(r.team); s.expToday += num(r.expected_amt); s.colToday += num(r.collected_amt); }
  for (const r of earlyExp) { const s = slot(r.team); s.expEarly += num(r.expected_amt); s.colEarly += num(r.collected_amt); }
  /* THE THREE RECOVERY DENOMINATORS, per team. Recovery % is recovered over the uncollected
     the team is actually chasing, and which day's that is depends on the day -- Monday by
     Monday, Tuesday to Friday by yesterday, the weekend by the week. The meeting wants to see
     all three side by side rather than only the one today's rule picks, so all three are
     worked out and the slide shows them together.

     Each day is batch-resolved on its own before being summed, so a report uploaded twice
     cannot double a denominator and halve a percentage. */
  const uncolInto = (d, field) => {
    for (const r of pickLatestBatchRows(dayRows(myExpWeek, d))) {
      slot(r.team)[field] += num(r.uncollected_amt);
    }
  };
  uncolInto(mon, 'uncolMon');
  uncolInto(addDaysKey(today, -1), 'uncolYest');
  for (let i = 0; i < 5; i++) {
    const d = addDaysKey(mon, i);
    for (const r of pickLatestBatchRows(dayRows(myExpWeek, d))) {
      const sl = slot(r.team);
      sl.uncolWeek += num(r.uncollected_amt);
      sl.expWeek += num(r.expected_amt);
      sl.colWeek += num(r.collected_amt);
    }
  }

  /* Sales two ways. The week drives the existing cards; the MONTH is what the team board is
     read on, because a month is the period a sales target is actually set over. */
  const monthStart = String(today).slice(0, 7) + '-01';
  for (const l of myLoans) {
    /* SALES_STAGES, not 'approved' alone -- the rest of the system already counts a disbursed
       or funded loan as the sale it still is (the stage moved forward; the sale did not
       unhappen), and this loop was the last place still counting approved-only, so "Sales
       this week" quietly shrank as the week's approvals were disbursed. */
    if (!SALES_STAGES.includes(l.stage)) continue;
    const d = String(l.approved_date || '').slice(0, 10);
    const amt = num(l.principal_amt) || num(l.loan_amt);
    if (d >= mon && d <= sun) slot(l.team).sales += amt;
    if (d >= monthStart && d <= today) slot(l.team).salesMonth += amt;
  }
  for (const a of myAbn) slot(a.team).abnormal += 1;

  const weekend = isoWeekday(nowMs) >= 6;
  const monthTarget = weeklyTarget * 4;
  const teams = Object.values(T).map(s => {
    const recovered = pairedToday ? s.initArrears - s.curArrears : 0;
    const pctOf_ = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
    const salesPct = pctOf_(s.salesMonth, monthTarget);
    /* THE BASIS COLUMN. One "uncollected" and one "collection %" that mean today on a weekday
       and the week at the weekend -- the same rule the recovery denominator follows, so the
       two columns on the slide are never measuring different stretches of time. */
    const collPct = weekend ? pctOf_(s.colWeek, s.expWeek) : pctOf_(s.colToday, s.expToday);
    return {
      ...s, recovered, salesPct,
      collPctToday: pctOf_(s.colToday, s.expToday),
      collPctEarly: pctOf_(s.colEarly, s.expEarly),
      collPctWeek: pctOf_(s.colWeek, s.expWeek),
      uncolToday: Math.max(0, s.expToday - s.colToday),
      basis: weekend ? 'week' : 'today',
      uncollected: weekend ? s.uncolWeek : Math.max(0, s.expToday - s.colToday),
      /* The two figures the basis percentage was made FROM, carried alongside it. A grand
         total cannot add percentages -- it has to work them out again from their parts -- and
         which parts those are changes with the day, so it cannot be guessed at the screen. */
      colBasis: weekend ? s.colWeek : s.colToday,
      expBasis: weekend ? s.expWeek : s.expToday,
      collPct,
      recPctMon: pctOf_(recovered, s.uncolMon),
      recPctYest: pctOf_(recovered, s.uncolYest),
      recPctWeek: pctOf_(recovered, s.uncolWeek),
      /* THE RANKING: sales and collection carry equal weight, because a team that sells well
         and collects badly is not a good team and neither is the reverse. A missing percentage
         counts as nothing rather than being skipped -- skipping it would let a team with no
         figures at all float to the top on the strength of the one number it does have. */
      score: Math.round((((salesPct || 0) + (collPct || 0)) / 2) * 10) / 10,
    };
  }).sort((a, b) => b.score - a.score || b.curArrears - a.curArrears)
    .map((t, i) => ({ sn: i + 1, ...t }));

  return {
    ...base,
    weekOf: mon, weekEnd: sun, weekday: wdToday, dailyTarget,
    /* WHICH WEEK THIS IS, and whether it is the live one. The screen has to say so: a
       dashboard showing a finished week looks exactly like a dashboard showing today, and
       somebody reading last week's arrears as this morning's would act on it. */
    asOfDate: today, pastWeek: asOf.past,
    // What was ASKED for, so the week bar can say when a choice was overruled and why.
    weekRequested: asOf.requested, weekFuture: asOf.future,
    weeklyTarget: weeklyTarget * Math.max(myTeams.length, 1), teamCount: myTeams.length,
    // The month's company-wide target, same convention the per-team salesPct uses: weekly x 4.
    monthTarget: monthTarget * Math.max(myTeams.length, 1),
    cards: {
      curArrears: teams.reduce((s, t) => s + t.curArrears, 0),
      initArrears: teams.reduce((s, t) => s + t.initArrears, 0),
      recovered: teams.reduce((s, t) => s + t.recovered, 0),
      defaulters: tCustomers(curToday),
      defaultersInitial: tCustomers(iniToday),
      cleared: Math.max(0, tCustomers(iniToday) - tCustomers(curToday)),
      salesWeek: teams.reduce((s, t) => s + t.sales, 0),
      salesLoans: myLoans.filter(l => SALES_STAGES.includes(l.stage) && String(l.approved_date || '').slice(0, 10) >= mon && String(l.approved_date || '').slice(0, 10) <= sun).length,
      /* The three month cards -- sales, collection and recovery month-to-date. */
      salesMonth: teams.reduce((s, t) => s + t.salesMonth, 0),
      salesMonthLoans: myLoans.filter(l => SALES_STAGES.includes(l.stage) && String(l.approved_date || '').slice(0, 10) >= monthStart && String(l.approved_date || '').slice(0, 10) <= today).length,
      /* null (not zero) where the totals function is not installed: a month the server could
         not compute must read as "not available", never as a month of zero collection. */
      colMonthExpected: monthOk ? colMonthExpected : null,
      colMonthCollected: monthOk ? colMonthCollected : null,
      colMonthPct: monthOk && colMonthExpected > 0 ? Math.round((colMonthCollected / colMonthExpected) * 1000) / 10 : null,
      recMonthRecovered: monthOk ? recMonthRecovered : null,
      recMonthUncollected: monthOk ? recMonthUncollected : null,
      recMonthPct: monthOk && recMonthUncollected > 0 ? Math.round((recMonthRecovered / recMonthUncollected) * 1000) / 10 : null,
      abnormal: myAbn.length,
      abnormalAmount: myAbn.reduce((s, a) => s + num(a.paid), 0),
      uncollectedToday: tUncollected(todayExp),
    },
    appsTrend, salesTrend, colTrend, recTrend, funnel,
    teamPerf: teams,
    paired: pairedToday,
  };
}
/** How many applications sit at each of the eight stages, RIGHT NOW -- the pipeline funnel.
 *
 *  `head: true` means PostgREST answers with the number and no rows at all, so eight of these
 *  carry nothing across the wire between them. The alternative was reading every loan the
 *  company has ever written and counting them here, which is thirty thousand rows to produce
 *  eight small integers.
 *
 *  Sequential, not eight at once. A wave of concurrent requests was tried on this system and
 *  took it down (see the note in supabase.js); eight cheap round trips one after another is the
 *  shape that has proved safe.
 *
 *  Team scoping is applied to each count, so an officer's funnel counts their own teams -- the
 *  same rows scoped() would have kept. */
/* ONE JOURNEY IF THE DATABASE CAN, EIGHT IF IT CANNOT.

   Measured on a forty-team book: the dashboard made 19 round trips and NINE of them were this
   table -- eight of those were this loop, counting one stage at a time. A count grouped by a
   column is the oldest thing a database does, so db/migrations/2026-08-11-loan-stage-counts.sql
   adds it and this asks for it first.

   The fallback is not a courtesy. Migrations here are pasted into the SQL editor by hand, so
   every deployment spends time in the state where the function does not exist yet, and the
   screen has to keep working in it -- exactly as the team-day totals do. */
async function stageCounts(db, teams) {
  const t = upperTeams(teams);
  const { data, error } = await rpcAll(db, 'loan_stage_counts', { p_teams: t.length ? t : null });
  if (!error && Array.isArray(data)) {
    const out = {};
    for (const st of STAGES) out[st] = 0;
    for (const r of data) {
      const k = String(r.stage == null ? '' : r.stage);
      if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = num(r.n);
    }
    return out;
  }
  // The function is not there yet: the eight counts this has always made.
  const out = {};
  for (const st of STAGES) {
    const { count, error: e2 } = await runQuery(() =>
      onTeams(db.from('loans').select('id', { count: 'exact', head: true }).eq('stage', st), teams));
    if (e2) throw e2;
    out[st] = count || 0;
  }
  return out;
}

/** The batch rule for rows already fetched in bulk (one date at a time).
    THIS WAS A SECOND COPY OF pickLatestBatch, character for character, and the two then had to
    be fixed twice for the same tie-breaking fault -- which is exactly the drift the rest of
    this file goes out of its way to avoid. It is now the one rule, called by both names. */
const pickLatestBatchRows = pickLatestBatch;

/** Expected for ONE weekday of this week -- the Mon..Fri pills the officers actually use,
    instead of only ever "the latest". Falls back to the latest snapshot when that weekday
    has not been uploaded yet. */
async function expectedDay(db, user, { weekday, type = 'today' }, nowMs) {
  // There are no weekend Expected sheets, so a Sat/Sun visit lands on FRIDAY -- the last
  // working day that actually has a list -- instead of an empty day nobody uploads.
  const asked = String(weekday || '').toUpperCase();
  const wd = WD5.includes(asked) ? asked : (WD5.includes(currentWeekday(nowMs)) ? currentWeekday(nowMs) : 'FRI');
  const date = dateOfWeekday(nowMs, wd);
  // Same narrowing as the Expected tab -- it is the same table drawn the same way, one weekday
  // at a time.
  const dayOpts = { teams: user.teams, columns: EXPECTED_TAB_COLS };
  let snap = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: type }, { onDate: date, ...dayOpts });
  let fellBack = false;
  if (!snap.rows.length) {
    snap = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: type }, { notAfter: todayKey(nowMs), ...dayOpts });
    fellBack = true;
  }
  const teamBranch = await branchByTeam(db, nowMs);
  const rows = scoped(user, snap.rows).map(r => ({ ...r, collected: collectedOf(r), branch: teamBranch.get(K(r.team)) || null }));
  const exp = rows.reduce((s, r) => s + num(r.payment_expected), 0);
  const col = rows.reduce((s, r) => s + r.collected, 0);
  const st = {};
  for (const r of rows) { const k = K(r.todays_status) || '(BLANK)'; st[k] = (st[k] || 0) + 1; }
  const teamsSeen = [...new Set(rows.map(r => r.team).filter(Boolean))].sort();
  return {
    weekday: wd, date: snap.date, requestedDate: date, fellBack, type,
    weekdays: WD5, todayWeekday: currentWeekday(nowMs),
    rows, count: rows.length, teams: teamsSeen,
    totals: { expected: exp, collected: col, uncollected: uncollectedOf(rows),
      pct: exp > 0 ? Math.round((col / exp) * 1000) / 10 : null,
      installments: rows.length,
      paid: rows.filter(r => ['PAID', 'OVERPAID'].includes(K(r.todays_status))).length,
      unpaid: rows.filter(r => K(r.todays_status) === 'UNPAID').length,
      underpaid: rows.filter(r => K(r.todays_status) === 'UNDERPAID').length },
    byStatus: Object.keys(st).sort().map(k => ({ status: k, count: st[k] })),
  };
}

/* ---------------------------------------------------------------------------- teams & staff */
/** The supervisory distribution is edited here, not re-uploaded: a team's Recovery/GMO/
    Manager/OPM/Credit/Expected/Bike columns are exactly what the assignment rotation and
    every leader report read, so a reassignment has to be a one-field edit. */
/** The team code is what field officers sign in with. It is editable in plain text on
    purpose: the PMO has to read it out over the phone, and change it the moment it leaks. */
const codeKeyOf = v => K(v).replace(/[^0-9A-Z]/g, '');
async function saveTeam(db, user, p) {
  requireAdmin(user);
  const team = normTeamName(p && p.team);
  if (!team) throw badRequest('team is required');
  const row = { team };
  /* CREDIT ID IS GONE. Analysts are named, never numbered ("dont use IDs in the approved
     report ... so even remove the credit id column in teams and staff - not using it"), so
     nothing here writes it any more. The database column may still exist on deployments that
     ran the 2026-08-04 migration; not mentioning it leaves whatever is there untouched,
     which is the same absent-means-untouched rule the leaders sheet lives by. */
  /* A NUMBER TYPED IN THIS FORM AND THE SAME NUMBER UPLOADED ON THE SHEET MUST BECOME THE SAME
     STRING. The leaders sheet puts every phone through normPhone -- leading zero and the 255
     stripped, nine digits left -- and the phone SEARCH, the call app's book and the notice
     templates all match against exactly that. This form used to only trim, so "0713000001"
     typed here was stored a different shape from the identical number uploaded, and the officer
     it belonged to could not be found by their own number. Same rule, both doors. */
  const PHONE_COLS = new Set(Object.values(TEAM_PHONE_OF));
  for (const c of TEAM_ROLE_COLS.concat(TEAM_OPTIONAL_COLS)) {
    if (p[c] === undefined) continue;
    const v = String(p[c] || '').trim();
    row[c] = PHONE_COLS.has(c) ? (pnorm(v) || null) : (v || null);
  }
  const existing = (await readTeamsAll(db)) || [];
  /* A DATABASE THAT HAS NOT HAD THE MIGRATION MUST STILL SAVE THE REST. Migrations here are run
     by hand, so a column no existing row has ever carried is dropped rather than sent --
     otherwise adding a field to the form would break saving a team for everybody until
     somebody opened the SQL editor.

     Generalised from the original single-column case, because 2026-08-09-team-contacts.sql adds
     thirteen more of exactly the same kind: the region and zone, a phone number for every role
     that already had a name, and the legal and collection officers. */
  for (const c of TEAM_OPTIONAL_COLS) {
    if (row[c] !== undefined && existing.length && !existing.some(t => c in t)) delete row[c];
  }
  const mine = existing.find(t => K(t.team) === K(team));
  if (p.generateCode) {
    row.team_code = generatePasscode(6).replace('-', '');
  } else if (p.teamCode !== undefined) {
    const code = String(p.teamCode || '').trim();
    if (code && codeKeyOf(code).length < 4) {
      throw badRequest('A team code needs at least 4 characters — a short one gets guessed.');
    }
    row.team_code = code || null;
  }
  // Two teams sharing a code would silently put officers on the wrong book.
  if (row.team_code) {
    const clash = existing.find(t => K(t.team) !== K(team) && codeKeyOf(t.team_code) === codeKeyOf(row.team_code));
    if (clash) throw badRequest(`That code is already used by team ${clash.team}.`);
  }
  // Changing a code is how "someone left, lock them out" is done, so it has to cut the
  // handsets that were signed in on the old one -- otherwise nothing actually changes.
  const rotated = row.team_code !== undefined && mine && codeKeyOf(mine.team_code) !== codeKeyOf(row.team_code);
  row.updated_at = new Date().toISOString();
  const { error } = await db.from('teams').upsert(row, { onConflict: 'team' });
  noteTeamsWritten(db);
  if (error) throw new Error(error.message);
  let released = 0;
  if (rotated) {
    const users = await fetchAll(() => db.from('call_users').select('user_id, team, device_id, is_leader'));
    // Leaders sign in with a portal access code, not the team code, so rotating must not
    // knock them out along with the field officers.
    const hit = users.filter(u => K(u.team) === K(team) && u.device_id && !u.is_leader);
    for (const u of hit) {
      const { error: e } = await db.from('call_users').update({ device_id: null }).eq('user_id', u.user_id);
      if (e) throw new Error(e.message);
    }
    released = hit.length;
  }
  return { team, teamCode: row.team_code, rotated: !!rotated, released };
}
/* WHAT HOLDS A TEAM IN PLACE.
   Five tables carry `team text references teams(team)`, and Postgres refuses to delete a row
   any of them still points at. The guard here only ever asked about `loans`, so a team with a
   single day of snapshots behind it failed on the other four -- and failed with the database's
   own words:

     update or delete on table "teams" violates foreign key constraint ...

   which names a constraint rather than a thing an admin can go and deal with. "I need to delete
   team from the team and staff table" is what that looks like from the other side.

   The two kinds are treated differently on purpose:

   HISTORY blocks the delete. Snapshots, follow-ups and loans are the record of work that was
   actually done, and dropping a team to make a tidy list is not a reason to lose it. The refusal
   now names every table that is holding on and how many rows each has, so the admin knows
   whether they are looking at one stray upload or a year of trading.

   HANDSETS do not. call_users is a registration, not a record: the officers of a team that no
   longer exists have to register again whatever happens, and saveTeam already releases them
   when a team code is rotated for exactly the same reason. They are released here and counted
   in the answer, so nothing happens silently. */
/* WHAT A MERGE MOVES -- every table that stores a team NAME, which is a wider list than the
   four that block a delete. Kept here, beside TEAM_HOLDS, so adding a table with a team column
   puts the question "and what happens when a team is merged?" directly in front of whoever
   adds it.

   DELIBERATELY ABSENT: performance_records and audit_log. Both store a name as a PHOTOGRAPH of
   what was true at the time -- that is the whole reason performance_records copies the name as
   text instead of pointing at the teams table. Last March's best team stays whatever it was
   called last March, and a merge today must not rewrite it. */
const TEAM_MOVES = [
  { table: 'repayment_snapshots', what: 'expected snapshots' },
  { table: 'defaulter_snapshots', what: 'defaulter decks' },
  { table: 'followup_status', what: 'follow-up records' },
  { table: 'followup_comments', what: 'comments' },
  { table: 'loans', what: 'loans' },
  { table: 'received_payments', what: 'received payments' },
  { table: 'abnormal_payments', what: 'abnormal payments' },
  { table: 'complaints', what: 'complaints' },
  { table: 'complaint_log', what: 'complaint log entries' },
  { table: 'restructures', what: 'restructures' },
  { table: 'demand_notices', what: 'demand notices' },
  { table: 'call_logs', what: 'call logs' },
  { table: 'call_users', what: 'registered handsets' },
  /* The three tables that arrived AFTER this list was written -- a merge that misses one
     leaves the old spelling alive there, and the next screen that reads it resurrects the
     "deleted" team ("i want if merged find nothing like TUNDURU nowhere else"). A table a
     migration has not created yet is skipped by the loop below, so these are safe everywhere. */
  { table: 'snapshot_summaries', what: 'summary rows' },
  { table: 'audit_log', what: 'audit entries' },
  { table: 'performance_records', what: 'performance records' },
];

/* The list-shaped ones. A PMO collection officer holds thirty-odd teams as an array on their
   own access code, and a leader's scope is the same shape on their handset. A name left behind
   in one of those lists is somebody scoped to a team that no longer exists. */
const TEAM_ARRAY_MOVES = [
  { table: 'access_codes', key: 'code', col: 'teams', what: 'access codes' },
  { table: 'call_users', key: 'user_id', col: 'leader_teams', what: 'leader scopes' },
];

const TEAM_HOLDS = [
  { table: 'repayment_snapshots', what: 'expected snapshots' },
  { table: 'defaulter_snapshots', what: 'defaulter decks' },
  { table: 'followup_status', what: 'follow-up records' },
  { table: 'loans', what: 'loans' },
];

/* TWO TEAMS THAT DIFFER ONLY IN CASE ARE TWO TEAMS.

     "On choosing team sahihi Tunduru is not appearing"

   `teams.team` is the primary key and Postgres compares it exactly, so TUNDURU and Tunduru are
   two separate rows -- which is how the duplicate came to exist in the first place. But this
   function uppercased whatever it was given before doing anything with it, so both names
   collapsed to one and the merge could not tell them apart: the destination looked like the
   source, and "a team cannot be merged into itself" was the answer to a perfectly sensible
   request. The picker had the mirror-image fault and simply hid the destination.

   Names are now resolved against the teams table AS STORED:

     an exact match          that row, whatever its case
     one case-insensitive    that row -- so typing `tunduru` still finds TUNDURU, which is what
       match                 makes every other use of this unchanged
     several                 refused, LISTING them, because guessing which of two spellings
                             somebody meant is exactly how the wrong one gets deleted */
async function resolveTeamName(db, raw) {
  const want = String(raw == null ? '' : raw).trim();
  if (!want) return { name: null };
  const rows = await fetchAll(() => db.from('teams').select('team'));
  const exact = rows.find(t => String(t.team) === want);
  if (exact) return { name: exact.team };
  const ci = rows.filter(t => K(t.team) === K(want));
  if (ci.length === 1) return { name: ci[0].team };
  if (ci.length > 1) return { name: null, ambiguous: ci.map(t => t.team) };
  return { name: null };
}

async function deleteTeam(db, user, p) {
  requireAdmin(user);
  const src = await resolveTeamName(db, p && p.team);
  if (src.ambiguous) {
    throw badRequest(`Kuna timu zaidi ya moja yenye jina hilo: ${src.ambiguous.join(', ')}. `
      + `Chagua ile hasa unayoitaka.`
      + `\n\nMore than one team is spelled that way: ${src.ambiguous.join(', ')}. `
      + `Pick the exact one — that is the whole reason this is refused rather than guessed.`);
  }
  // Falls back to the normalised name so a team that is not in the table at all still produces
  // the old "nothing to delete" behaviour rather than a confusing "team is required".
  const team = src.name || normTeamName(p && p.team);
  if (!team) throw badRequest('team is required');

  const blocking = [];
  for (const h of TEAM_HOLDS) {
    /* head:true with an exact count asks the database to COUNT rather than to send anything --
       the cheapest read there is, and the point of it here is that "how many" is the number the
       admin needs in order to decide. */
    const { count, error } = await runQuery(() =>
      db.from(h.table).select('team', { count: 'exact', head: true }).eq('team', team));
    if (error) throw new Error(error.message);
    if (count) blocking.push(`${count} ${h.what}`);
  }
  /* =====================================================================================
     A DUPLICATE TEAM IS NOT DELETED. IT IS MERGED.

       "Team TUNDURU should be deleted because the correct one is Tunduru. it fails saying it
        has expected snapshots"

     The guard above is right and stays: deleting a team that still holds records would orphan
     them -- snapshots pointing at a team that no longer exists, invisible on every screen and
     unrecoverable without a database console. That is exactly the outcome it exists to stop.

     But it answered the wrong question. Told "this team has records", the admin's real
     intention is almost never "throw the records away" -- it is "these records belong to the
     OTHER spelling of this team". A misspelled duplicate holds real work: real customers, real
     arrears, real recovery, sitting under a name nobody meant to create.

     So `moveTo` names the team the records belong to, and every one of them is carried across
     before the empty team is removed. Nothing is deleted except the name.

     WHAT MOVES: the four holding tables above, and call_users besides -- a handset registered
     to the wrong spelling must follow its team rather than be cut off, which is what plain
     deletion does to it.

     The counts come back per table, so the admin sees exactly what was carried rather than
     being told "done". And this goes through the same audited door as every other write. */
  /* A MERGE IS ASKED FOR, NOT INFERRED. This used to run only when something was blocking the
     delete, so merging a team that happened to hold nothing quietly became a plain delete and
     reported one. Pressing Merge should merge -- and report zero moved if there was nothing to
     move -- because an admin who chose a destination is telling you what they meant. */
  const wantMove = String((p && p.moveTo) == null ? '' : p.moveTo).trim();
  if (wantMove) {
    const dst = await resolveTeamName(db, wantMove);
    if (dst.ambiguous) {
      throw badRequest(`Kuna timu zaidi ya moja yenye jina hilo: ${dst.ambiguous.join(', ')}.`
        + `\n\nMore than one team is spelled "${wantMove}": ${dst.ambiguous.join(', ')}. `
        + 'Pick the exact one.');
    }
    if (!dst.name) {
      throw badRequest(`Timu ${wantMove} haipo. / There is no team called ${wantMove} — `
        + 'create it first, or check the spelling.');
    }
    const moveTo = dst.name;
    // Compared AS STORED, so TUNDURU and Tunduru are correctly two different teams.
    if (moveTo === team) throw badRequest('A team cannot be merged into itself.');
    /* EVERY PLACE A TEAM NAME IS STORED, not just the four that block the delete.

       The blocking check asks a narrow question -- "is anything important still filed here?" --
       and four tables answer it. A MERGE has to ask the opposite and much wider one: where does
       this name appear AT ALL? Moving five of fifteen would leave ten pointing at a team that
       no longer exists, which is precisely the orphaning the guard was there to prevent. Doing
       it halfway would be worse than refusing outright, because it would look like it worked.

       Two shapes, and both have to be handled:
         a `team` column        thirteen tables, one update each
         an ARRAY of teams      access_codes.teams and call_users.leader_teams -- a PMO officer
                                holds thirty-odd teams as a list on their own record, and a
                                leader's scope is the same shape. A name left in one of those
                                lists is an officer scoped to a team that is gone. */
    const moved = {};
    for (const h of TEAM_MOVES) {
      const { data, error } = await runQuery(() =>
        db.from(h.table).update({ team: moveTo }).eq('team', team).select('team'));
      /* A table a migration has not created yet is SKIPPED, not fatal -- audit_log and
         performance_records are optional like every migration here, and a merge that dies
         half-way on a missing side-table is worse than one that says what it moved. */
      if (error) {
        if (/does not exist|42P01|PGRST20/i.test(String(error.message || error.code || ''))) continue;
        throw new Error(error.message);
      }
      if ((data || []).length) moved[h.what] = data.length;
    }

    /* The two list-shaped ones. Both tables are small -- a few dozen codes, a few hundred
       handsets -- so they are read whole and only the rows that actually change are written
       back. The old name is swapped for the new one and duplicates collapse, because somebody
       may already hold BOTH spellings. */
    for (const arr of TEAM_ARRAY_MOVES) {
      const rows = await fetchAll(() => db.from(arr.table).select(arr.key + ', ' + arr.col));
      let n = 0;
      for (const r of rows || []) {
        const list = Array.isArray(r[arr.col]) ? r[arr.col] : [];
        if (!list.some(x => K(x) === team)) continue;
        const next = [...new Set(list.map(x => (K(x) === team ? moveTo : x)))];
        const { error } = await runQuery(() =>
          db.from(arr.table).update({ [arr.col]: next }).eq(arr.key, r[arr.key]));
        if (error) throw new Error(error.message);
        n++;
      }
      if (n) moved[arr.what] = n;
    }

    const { error: delErr } = await db.from('teams').delete().eq('team', team);
  noteTeamsWritten(db);
    if (delErr) throw new Error(delErr.message);
    return { team, mergedInto: moveTo, moved, released: 0 };
  }

  if (blocking.length) {
    throw badRequest(
      `Timu ${team} bado ina kumbukumbu: ${blocking.join(', ')}. `
      + `Kama hii ni tahajia isiyo sahihi, ihamishe kwenye timu sahihi badala ya kuifuta.`
      + `\n\nTeam ${team} still holds ${blocking.join(', ')}.`
      + `\n\nIf this is a misspelling of another team, MERGE it instead: choose the correct `
      + `team and every record moves across before this name is removed. Nothing is lost. `
      + `Deleting a team that still holds records would orphan them, which is why it is refused.`
      + `\n\nOtherwise clear the records first (Settings → Clean reports).`);
  }

  // Nothing is holding it. The handsets registered to it go with it -- they have nothing to
  // sign in to once the team is gone.
  const { data: released, error: relErr } = await db.from('call_users').delete().eq('team', team).select('user_id');
  if (relErr) throw new Error(relErr.message);

  const { error } = await db.from('teams').delete().eq('team', team);
  noteTeamsWritten(db);
  if (error) throw new Error(error.message);
  return { team, released: (released || []).length };
}
function normTeamName(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

/** Tips, from the Hints sheet: tab-scoped, bilingual, admin-editable without a deploy.

    THE TIMING WAS NEVER READABLE. The client has always carried `S.hintEverySec` /
    `S.hintHoldSec` and a hard-coded fallback (240s / 7s) for when they are unset -- but nothing
    server-side ever SET them, so the fallback was the only value that ever ran, and there was
    nowhere in Settings to change it:

      "Am not seeing were to set tips timelapse in settings"

    There was nowhere to see, because the two numbers these fall back to were never wired to a
    setting at all. HINT_EVERY_SEC / HINT_HOLD_SEC now read like any other setting -- through
    settingNum, which reads readSettings' own 20-second cache, so this call very rarely costs a
    round trip of its own; the settings a working Settings screen has usually already warmed it. */
async function hints(db, user) {
  const rows = await fetchAll(() => db.from('hints').select('*'));
  const en = {}, sw = {};
  for (const r of rows) {
    const t = String(r.tab || '').trim().toLowerCase();
    const m = String(r.message || '').trim(), s = String(r.sw_message || '').trim();
    if (!t || (!m && !s)) continue;
    (en[t] = en[t] || []).push(m || s);
    (sw[t] = sw[t] || []).push(s || m);
  }
  const everySec = await settingNum(db, 'HINT_EVERY_SEC', 240);
  const holdSec = await settingNum(db, 'HINT_HOLD_SEC', 7);
  return { tips: { en, sw }, everySec, holdSec };
}

/* =======================================================================================
   THE OFFICER BOARDS -- the bottom half of the dashboard.

   The headline cards say WHERE things stand; these say WHO. Every board pairs a "today"
   view with a "this week" view, because a bad day is noise and a bad week is a problem.
   Officers are resolved from the teams table's role columns, so the same reassignment that
   re-points the recycling rotation also re-points these boards.
   ======================================================================================= */

function officerOf(teamBy, team, roleCol) {
  const t = teamBy[K(team)];
  return (t && t[roleCol]) ? String(t[roleCol]).trim() : '(unassigned)';
}
function bucket(map, key, init) { if (!map[key]) map[key] = Object.assign({ key }, init); return map[key]; }
function pctOf(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : null; }

/* The officer boards are the dashboard's twin: pure sums over a whole week of snapshots, and
   the second half of what the Presentation deck waits for. Same one-minute answer, same
   reasoning -- see answer-cache.js. Opening the deck straight after the Dashboard now costs
   this half only, and re-opening it costs neither. */
async function officerBoards(db, user, args, nowMs) {
  /* The chosen week goes in the cache NAME, and the real clock stays as the cache's own
     timestamp. Shifting nowMs into the cache instead would make every past-week answer look
     older than the cache allows, so it would never be kept -- and the Presentation asks for
     this twice over. */
  const asOf = asOfWeek(nowMs, args && args.weekOf);
  return cachedAnswer(db, 'officerBoards|' + asOf.weekOf, user, nowMs,
    () => officerBoardsUncached(db, user, args, asOf.ms));
}

async function officerBoardsUncached(db, user, _args, nowMs) {
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs), fri = addDaysKey(mon, 4), sun = addDaysKey(mon, 6);
  const wd = currentWeekday(nowMs);

  /* These boards are SUMS. Not one customer's name, phone or balance is ever shown -- every
     slide is money and headcounts grouped by officer -- yet this used to download a whole week
     of snapshots with every column on every row: 825,000 rows behind one Presentation. Listing
     what is actually read cuts the body by more than half, and the week-long range reads pay
     that saving five to seven times over.

     Keep this list honest: if a figure below starts reading a new column, it has to be added
     here too. The tests' fake database returns only what is asked for, so a forgotten column
     fails a test rather than quietly reporting zero. */
  const [teamRows, expWeek, tomorrow, defWeek, fu, loansAll, callLogs, csRoster, phoneUsers,
         codeRows, cfgS] = await Promise.all([
    readTeamsAll(db),
    expectedTotalsInRange(db, { type: 'today', from: mon, to: fri, teams: user.teams }),
    earlyList(db, { today, teams: user.teams }),
    defaulterTotalsInRange(db, { from: mon, to: sun, teams: user.teams }),
    fetchAll(() => onTeams(db.from('followup_status').select('ref, team, status, fu_status, arrears'), user.teams)),
    /* BOUNDED TO THE WEEK. Both boards built from this read a window: the credit analysts by
       APPROVED DATE, the customer-care agents by UPLOAD DATE, and neither ever looks further
       back than Monday. It was reading every loan the company has ever written to answer that.

       `or` rather than two reads, because a loan qualifies on EITHER column -- an application
       uploaded this week whose approval is older, or the reverse. A loan with nothing in either
       column is excluded, which is correct: both boards already skip a row with no date. */
    fetchAll(() => onTeams(db.from('loans')
      .select('id, stage, team, created_at, approved_date, approved_by, created_by, requested_amt, principal_amt, loan_amt, track_no, upload_date')
      .or(`approved_date.gte.${mon},upload_date.gte.${mon}`), user.teams)),
    /* THE COLUMNS THE CALL BOARDS DRAW, not every column of every call in the week. select('*')
       here carried the phone number, the customer, the match type and the sync stamp of every
       call two hundred officers made -- none of which appears on a board of counts and talk
       time. */
    fetchAll(() => onTeams(db.from('call_logs')
      .select('officer, team, duration, portfolio, ref, phone, outcome, call_date')
      .gte('call_date', mon).lte('call_date', sun), user.teams)),
    /* TWO DIFFERENT KINDS OF "AGENT", which the deck had been showing as one.
       call_agents is the CUSTOMER CARE roster -- the people named as CREATED BY on application
       reports. call_users is the HOPE Calls app roster -- field officers with a phone. They do
       different jobs and are measured on different things. */
    fetchAll(() => db.from('call_agents').select('user_id, names')),
    fetchAll(() => onTeams(db.from('call_users').select('user_id, name, team, active'), user.teams)),
    /* The PMO collection officers. They are ACCESS CODES with a role, not a column on the teams
       table -- one officer holds thirty-odd teams, which is a list on the person, not a name
       repeated in thirty-odd rows. */
    fetchAll(() => db.from('access_codes').select('name, role, teams')),
    // Every setting this screen needs, in ONE journey rather than three.
    settingsMany(db, ['SALES_TARGET_WEEKLY', 'SALES_TARGET', PMO_ROLE_KEY]),
  ]);
  const pmoRoleName = cfgS.get(PMO_ROLE_KEY, PMO_ROLE_DEFAULT);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const myExp = scoped(user, expWeek), myDef = scoped(user, defWeek);
  const myTmrw = scoped(user, tomorrow.rows), myFu = scoped(user, fu);
  const myLoans = scoped(user, loansAll), myCalls = scoped(user, callLogs);
  const myPhoneUsers = scoped(user, phoneUsers);
  /* Resolve a deck the SAME way the dashboard card does: by date, type AND WEEKDAY.
     Ignoring weekday here was the bug behind "initial right, current bigger, recovery
     negative". A day can carry decks stamped with more than one weekday -- Monday's baseline
     re-uploaded today, say -- and pickLatestBatch then chose a DIFFERENT deck for initial than
     for current. Comparing two different populations reports the gap between them as
     recovery, which is how a matching pair of files produced -194m. */
  const onDate = (rows, d, type, weekday) => pickLatestBatchRows(rows.filter(r =>
    String(r.snapshot_date) === d && (!type || r.snapshot_type === type)
    && (!weekday || r.weekday === weekday)));

  /* ---- EARLY COLLECTION: judged on the list of who is due NEXT, per Expected officer.
         That is the INITIAL expected report here, with Tomorrow as a fallback -- see
         earlyList. Which one it came from travels with the board, so a screen built on a
         report nobody uploaded says so instead of looking like a team that collected
         nothing. ---- */
  /* Read the same way as the PMO Collection board, because it asks the same question about a
     different set of officers: how many teams they cover, what is still out, and what share
     came in. `teams` is counted from the rows actually seen, so it is the number of teams that
     had customers to collect from today -- not a headcount off the roster that would stay the
     same on a day when half of them had nothing due. */
  function earlyBoard(rows) {
    const m = {};
    for (const r of rows) {
      const b = bucket(m, officerOf(teamBy, r.team, 'expected'),
        { uncollected: 0, paidOver: 0, expected: 0, collected: 0, teamSet: {} });
      b.expected += num(r.expected_amt); b.collected += num(r.collected_amt);
      b.uncollected += num(r.uncollected_amt);
      if (r.team) b.teamSet[K(r.team)] = 1;
      b.paidOver += num(r.paid_n) + num(r.over_n);
    }
    return Object.values(m).map(b => ({ officer: b.key, uncollected: b.uncollected, paidOver: b.paidOver,
      teams: Object.keys(b.teamSet).length,
      expected: b.expected, collected: b.collected, pct: pctOf(b.collected, b.expected) }))
      .sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct))
      // Numbered after sorting, so S/N is the ranking rather than an accident of map order.
      .map((r, i) => ({ sn: i + 1, ...r }));
  }
  const earlyToday = earlyBoard(myTmrw);
  const earlyWeek = earlyBoard(myExp);

  /* ---- RECOVERY: per Recovery officer. ----

     THE DENOMINATOR IS THE UNCOLLECTED THE OFFICER IS ACTUALLY CHASING, and which day's
     uncollected that is depends on the day of the week. It is the same rule the dashboard's
     Recovery % has always used (recovery.js, recoveryBasis) -- officers chase what yesterday
     left behind, so:

         Monday      today's uncollected      (no yesterday exists inside a HOPE week)
         Tue–Fri     yesterday's uncollected
         Sat/Sun     the whole week's         (the weekend reconciles Monday to Friday)

     This board was not following that rule. It added up every Expected row of the whole week,
     every day, every re-upload, and used that as the denominator on BOTH the daily and the
     weekly board -- so a team whose Tuesday file had been uploaded twice had its recovery
     percentage quietly halved, and Monday was divided by a week that had barely started. */
  const uncolOnDate = d => {
    const m = {};
    for (const r of onDate(myExp, d)) {
      bucket(m, officerOf(teamBy, r.team, 'recovery'), { amt: 0 }).amt += num(r.uncollected_amt);
    }
    return m;
  };
  const addUncol = (into, from) => {
    for (const k of Object.keys(from)) into[k] = (into[k] || 0) + from[k].amt;
    return into;
  };
  // Per officer: yesterday feeds its own column, the week feeds the denominator. The PMO
  // board keeps its own day-dependent basis (recoveryBasis) -- that is a different scheme
  // paying a different person, and only its LABEL is read from here.
  const basis = recoveryBasis(isoWeekday(nowMs));
  const uncolYesterday = addUncol({}, uncolOnDate(addDaysKey(today, -1)));
  const uncolWeekBy = WD5.reduce((acc, _w, i) => addUncol(acc, uncolOnDate(addDaysKey(mon, i))), {});
  const weekUncol = Object.values(uncolWeekBy).reduce((s, v) => s + v, 0);

  function recBoard(iniRows, curRows, dailyRecovered, uncolBy, yesterdayBy) {
    const m = {};
    const blank = { initial: 0, current: 0, recovered: 0, uncollected: 0, yUncollected: 0 };
    for (const r of iniRows) bucket(m, officerOf(teamBy, r.team, 'recovery'), blank).initial += num(r.arrears_amt);
    for (const r of curRows) bucket(m, officerOf(teamBy, r.team, 'recovery'), blank).current += num(r.arrears_amt);
    for (const k of Object.keys(uncolBy)) bucket(m, k, blank).uncollected += uncolBy[k];
    if (yesterdayBy) for (const k of Object.keys(yesterdayBy)) bucket(m, k, blank).yUncollected += yesterdayBy[k];
    if (dailyRecovered) for (const k of Object.keys(dailyRecovered)) bucket(m, k, blank).recovered += dailyRecovered[k];
    return Object.values(m).map(b => {
      const rec = dailyRecovered ? b.recovered : (b.initial - b.current);
      return { officer: b.key, initial: b.initial, current: b.current, uncollected: b.uncollected,
        yUncollected: yesterdayBy ? b.yUncollected : null,
        // Debt crisis only means something across a WEEK: a customer cannot fall into default
        // between breakfast and lunch, so on the daily board this is noise dressed as news.
        debtCrisis: dailyRecovered ? Math.min(0, b.initial - b.current) : null,
        recovered: rec, pct: pctOf(rec, b.uncollected) };
    }).sort((a, b) => b.recovered - a.recovered);
  }
  const iniToday = onDate(myDef, today, 'initial', wd), curToday = onDate(myDef, today, 'current', wd);
  /* THE DENOMINATOR THE SUBTITLE HAS ALWAYS PROMISED.
       "At dashboard Recovery — today initial · current · recovered · Rec % ÷ this week's
        uncollected [show yesterday uncollected before today recovered]"
     The board's own caption said "÷ this week's uncollected" while the figure divided by a
     day-dependent basis -- so the label and the arithmetic disagreed, which is the exact kind
     of drift the weekly report was cured of. Now it divides by the week, as written, and
     yesterday's uncollected stands as its own column before today's recovered: what the
     officer was chasing, then what they brought in. */
  const recToday = recBoard(iniToday, curToday, null, uncolWeekBy, uncolYesterday);
  // Week: each day's own (initial - current) summed per officer, exactly like the trend row.
  const dailyRec = {};
  for (let i = 0; i < 7; i++) {
    const d = addDaysKey(mon, i);
    // Each day pairs its own initial against its own current, matched on weekday so the two
    // sides are always the same population.
    const dwd = WD7[i];
    const ini = onDate(myDef, d, 'initial', dwd), cur = onDate(myDef, d, 'current', dwd);
    if (!ini.length || !cur.length) continue;
    const per = {};
    for (const r of ini) per[officerOf(teamBy, r.team, 'recovery')] = (per[officerOf(teamBy, r.team, 'recovery')] || 0) + num(r.arrears_amt);
    for (const r of cur) per[officerOf(teamBy, r.team, 'recovery')] = (per[officerOf(teamBy, r.team, 'recovery')] || 0) - num(r.arrears_amt);
    for (const k of Object.keys(per)) dailyRec[k] = (dailyRec[k] || 0) + per[k];
  }
  const iniMon = onDate(myDef, mon, 'initial', 'MON');
  /* The weekly board always divides by the WEEK's uncollected, whatever day it is read on --
     that is what makes it the weekly board rather than a second copy of the daily one. */
  const recWeek = recBoard(iniMon, curToday, dailyRec, uncolWeekBy);

  /* Recovery is initial MINUS current, so if one of the two decks is short the difference is
     reported as money recovered. Uploading the same file as both should read as zero
     recovery; a partial or wrong second upload instead shows a large, entirely fictional
     recovery, and nothing on the screen says why. Compare the headcounts and say so. */
  /* HEADCOUNTS, NOT ROW COUNTS. These rows are team-day totals now, so how many of them there
     are says how many teams uploaded -- not how many customers are on the deck, which is what
     this warning is about and what the two figures beside it report. */
  const iniCustomers = tCustomers(iniToday), curCustomers = tCustomers(curToday);
  const deckWarning = (() => {
    if (!iniCustomers || !curCustomers) return null;
    const gap = Math.abs(iniCustomers - curCustomers);
    if (gap / Math.max(iniCustomers, curCustomers) < 0.02) return null;
    const short = curCustomers < iniCustomers ? 'current' : 'initial';
    return `Today's initial deck has ${iniCustomers.toLocaleString('en-US')} customers but the current deck has `
      + `${curCustomers.toLocaleString('en-US')} — the ${short} upload looks incomplete, so the recovery figures `
      + `below are overstated by the difference. Re-upload it before reading these numbers.`;
  })();

  /* ---- CREDIT ANALYSTS: applications they processed, against the sales target ---- */
  const weeklyTarget = cfgS.num('SALES_TARGET_WEEKLY', cfgS.num('SALES_TARGET', 100000000));
  /* TWO DIFFERENT DEPARTMENTS, AND THEY WERE BEING ADDED TOGETHER.

       "you mixed callagent customer service department who receive loan requests with
        credit analysts who approve loan sales at dashboard"

     `created_by` is the CUSTOMER CARE agent who RECEIVED the application -- it is the very
     column the CS board below groups by, and it has no business naming an analyst. This
     board is about who APPROVED the sale, so it reads the approval: the analyst ID the
     approvals file names in words when those words match somebody on the credit column of
     Teams & Staff, and otherwise the team's own credit officer. That is the exact rule the
     Credit tab uses -- the two screens answer "who is this analyst" the same way, so they
     cannot disagree, and neither ever prints an ID. */
  const analystNames = {};
  for (const t of teamRows || []) {
    if (t.credit) analystNames[K(t.credit)] = String(t.credit).trim();
  }
  /* The file's own words when they name a known analyst, else the team's credit officer.
     officerOf answers the string '(unassigned)' when a team has none, which is the honest
     end of the line -- an ID is never printed. */
  const analystFor = l => analystNames[K(l.approved_by || '')] || officerOf(teamBy, l.team, 'credit');

  function creditBoard(from, to) {
    const m = {};
    for (const l of myLoans) {
      const d = String(l.approved_date || '').slice(0, 10);
      if (!d || d < from || d > to) continue;
      const b = bucket(m, analystFor(l),
        { apps: 0, amount: 0, teams: {} });
      b.apps++; b.amount += num(l.principal_amt) || num(l.loan_amt);
      if (l.team) b.teams[K(l.team)] = 1;
    }
    const span = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
    const target = weeklyTarget * (span / 7);
    return Object.values(m).map(b => {
      // Their recovery share: the movement on the teams whose files they actually processed.
      let ini = 0, cur = 0, unc = 0;
      for (const r of iniToday) if (b.teams[K(r.team)]) ini += num(r.arrears_amt);
      for (const r of curToday) if (b.teams[K(r.team)]) cur += num(r.arrears_amt);
      for (const r of myExp) if (b.teams[K(r.team)]) unc += num(r.uncollected_amt);
      const salesPct = pctOf(b.amount, target), recPct = pctOf(ini - cur, unc);
      return { analyst: b.key, apps: b.apps, amount: b.amount, salesPct, recPct,
        perf: (salesPct == null && recPct == null) ? null : Math.round(((salesPct || 0) + (recPct || 0)) / 2 * 10) / 10 };
    }).sort((a, b) => b.apps - a.apps);
  }
  const creditToday = creditBoard(today, today);
  const creditWeek = creditBoard(mon, sun);

  /* ---- CUSTOMER CARE AGENTS: applications brought in ----

     These are the people in the customer care room, named as CREATED BY on the application
     reports. They are NOT the HOPE Calls app users, and the deck had been showing the app
     users under the heading "Call agents" -- talk time and connected percentages for one group
     of people, presented as the performance of another. Nobody records talk time or a team for
     a customer care agent; what they are judged on is what they brought in.

     Only TRACK# 1 counts, exactly as the Call Agents tab already counts it: a track of 2 or
     more is a repeat customer, and nobody won that application. The same rule in both places,
     read from the same isTrack1 -- a second copy of it would drift.

     An application report carries no date of its own -- one pulled on the 27th is full of June
     applications -- so the week is measured on the upload stamp, which is the person uploading
     saying "this is the report FOR this date". That is the only honest handle there is. */
  function csBoard(from, to) {
    const m = {};
    for (const l of myLoans) {
      if (!CS_STAGES.includes(String(l.stage || ''))) continue;
      if (!isTrack1(l)) continue;
      const d = String(l.upload_date || '').slice(0, 10);
      if (!d || d < from || d > to) continue;
      const b = bucket(m, K(String(l.created_by || '').trim() || '—'),
        { id: String(l.created_by || '').trim() || '—', unassigned: 0, assigned: 0, amount: 0 });
      if (l.stage === 'assigned') b.assigned++; else b.unassigned++;
      b.amount += num(l.requested_amt) || num(l.principal_amt);
    }
    const names = {};
    for (const a of csRoster) names[K(a.user_id)] = a.names || '';
    return Object.values(m).map(b => ({
      // The roster's name where there is one, the bare id where there is not -- an unnamed id
      // is the signal to add them to the roster, not a reason to drop the row.
      agent: names[b.key] || b.id, id: b.id,
      unassigned: b.unassigned, assigned: b.assigned, brought: b.unassigned + b.assigned,
      amount: b.amount })).sort((a, b) => b.brought - a.brought);
  }
  const csToday = csBoard(today, today);
  const csWeek = csBoard(mon, sun);

  /* ---- HOPE CALLS APP OFFICERS: who is actually on the phone ----

     A different question and a different set of people. Everybody in the field calls, and this
     is the record of it -- calls made, time spent, how much of it was portfolio work.

     REGISTERED OFFICERS WHO MADE NO CALLS AT ALL ARE INCLUDED, at zero. Built only from the
     call log, the officer who never opened the app simply does not appear -- and that is the
     one name a meeting about underperformance most needs to see. An officer whose account is
     switched off is left out: they are not expected to be calling. */
  /* Name -> PMO unit. Expected and recovery officers are named in the TEAMS table (holding one
     of those columns anywhere is what counts, the same rule the recycling rotation uses);
     collection officers hold their teams on an ACCESS CODE, which is where the owner put them.
     Built once, ahead of both boards, so today and the week cannot label the same person
     differently. */
  const unitBy = {};
  for (const t of teamRows) {
    if (t.expected) unitBy[K(t.expected)] = unitBy[K(t.expected)] || 'EXPECTED';
    if (t.recovery) unitBy[K(t.recovery)] = unitBy[K(t.recovery)] || 'RECOVERY';
  }
  // From codeRows rather than from pmoRoster, which is built further down for the board that
  // needs its team lists. This only needs the NAMES, and reaching forward for a const that
  // does not exist yet would throw before a single slide was drawn.
  for (const c of codeRows) if (c.name && isPmoRole(c.role, pmoRoleName)) unitBy[K(c.name)] = 'COLLECTION';
  const unitOf = name => unitBy[K(name)] || null;

  function callBoard(from, to) {
    const m = {};
    for (const c of myCalls) {
      const d = String(c.call_date || '').slice(0, 10);
      if (!d || d < from || d > to) continue;
      const b = bucket(m, String(c.officer || '(unknown)').trim() || '(unknown)',
        { calls: 0, duration: 0, portfolio: 0, connected: 0, customers: {}, team: c.team || '' });
      b.calls++; b.duration += num(c.duration);
      if (c.portfolio) { b.portfolio++; b.customers[String(c.ref || c.phone)] = 1; }
      if (K(c.outcome) === 'CONNECTED' || !c.outcome) b.connected++;
    }
    for (const u of myPhoneUsers) {
      if (u.active === false) continue;
      const name = String(u.name || '').trim();
      if (!name) continue;
      const b = bucket(m, name, { calls: 0, duration: 0, portfolio: 0, connected: 0, customers: {}, team: u.team || '' });
      if (!b.team) b.team = u.team || '';
    }
    return Object.values(m).map(b => ({ agent: b.key, team: b.team, calls: b.calls, duration: b.duration,
      portfolio: b.portfolio, customers: Object.keys(b.customers).length,
      /* WHICH OF THE THREE PMO UNITS THIS PERSON BELONGS TO, or null for everybody else.
         "For the presentation slides am interested in the 3 PMO department's Units (expected,
         collection and recovery officers - show only those for busiest and least active ones)"

         Attached here rather than worked out at the screen: the slide would otherwise have to
         re-derive it from the teams table it does not hold, and a second derivation of "who is
         a recovery officer" is a second answer that can disagree with the boards above. */
      unit: unitOf(b.key),
      connectPct: pctOf(b.connected, b.calls), portfolioPct: pctOf(b.portfolio, b.calls) }))
      .sort((a, b) => b.calls - a.calls);
  }
  const callToday = callBoard(today, today);
  const callWeek = callBoard(mon, sun);
  /* The other end of the same list, for the slide that asks who needs help. Deliberately the
     same rows in the other order rather than a separate calculation -- two boards that could
     disagree about the same week would be worse than no board at all. */
  const callWeekWorst = callWeek.slice().reverse();

  /* ---- PMO COLLECTION OFFICERS ----

     Judged on one thing: the percentage of what was expected that actually came in, across the
     teams they were handed. Deliberately not on team count, customer count or amount -- the
     teams are distributed so those even out, and the whole point of the plan is that two
     officers with very different portfolios are paid the same for the same percentage.

     Their teams come from their ACCESS CODE, because that is where the owner put them: one
     officer holds thirty-odd teams, which is a list on the person rather than their name
     repeated in thirty-odd rows of the teams table. */
  const pmoRoster = codeRows
    .filter(c => isPmoRole(c.role, pmoRoleName))
    // Somebody who sees every team (blank teams = ALL) is not a collection officer with a
    // distributed portfolio, and putting them on this board would make every percentage the
    // company's percentage. They are left off rather than shown as the whole book.
    .filter(c => c.teams && c.teams.length)
    .filter(c => !user.teams || c.teams.some(t => teamAllowed(user, t)))
    .map(c => ({ name: c.name, teams: c.teams }));
  const pmoByDay = new Map();
  for (let i = 0; i < 7; i++) { const d = addDaysKey(mon, i); pmoByDay.set(d, onDate(myExp, d)); }
  const pmoDays = WD5.map((_w, i) => addDaysKey(mon, i));
  const pmoRows = pmoBoard(pmoRoster, pmoByDay, today, pmoDays);

  /* ---- FOLLOW-UP STATUS across ALL defaulters (what the whole book looks like) ---- */
  const real = myFu.filter(r => !(r.status == null && r.arrears == null));
  const fsm = {};
  for (const r of real) {
    const b = bucket(fsm, K(r.fu_status) || 'HAIJAFUATILIWA / NOT TOUCHED', { customers: 0, arrears: 0 });
    b.customers++; b.arrears += num(r.arrears);
  }
  const fuStatus = Object.values(fsm).map(b => ({ status: b.key, customers: b.customers, arrears: b.arrears,
    pct: pctOf(b.customers, real.length) })).sort((a, b) => b.customers - a.customers);

  return { weekday: wd, weekOf: mon, today, deckWarning,
    initialCount: iniCustomers, currentCount: curCustomers,
    earlyToday, earlyWeek, recToday, recWeek, creditToday, creditWeek,
    callToday, callWeek, callWeekWorst, csToday, csWeek,
    /* THE PUBLIC SHAPE, built by pmo.js rather than by leaving fields off here. Commission
       belongs on the commission panel where the person it concerns can see their own figure;
       a projector in a meeting room is the wrong place for anybody's pay. Building the row
       there means a future slide cannot include the money by reaching for a field that
       happened to be sitting on the object. */
    pmo: pmoRows.map(pmoPublicRow),
    pmoBasis: basis.kind, pmoBasisLabel: basis.label,
    earlySource: tomorrow.source, earlyDate: tomorrow.date,
    fuStatus, fuTotal: real.length,
    weekUncollected: weekUncol };
}
