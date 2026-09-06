/* THE RECOVERY WALK, AS POSTGRES WILL ANSWER IT.
 *
 * db/RUN-ME-029-recovery-day-totals.sql moves the recovery walk into the database: instead of
 * a quarter of a million raw customer rows crossing the wire for the commission screen to pair
 * up, the database pairs them and returns one row per team per day.
 *
 * This is that SQL transcribed, clause for clause, so the whole system can be exercised against
 * a database that HAS the migration as well as one that has not.
 *
 * IT IS DELIBERATELY WRITTEN OUT IN FULL rather than calling the walk in portal-core.js. That
 * walk is the fallback -- the very thing this is compared against -- and a comparison where
 * both sides run the same arithmetic proves nothing at all. Two separate pieces of arithmetic
 * agreeing on the same fixture is the only version of this test worth having, and on a payroll
 * figure it is worth having.
 *
 * WHAT IT CANNOT PROVE: that the SQL I wrote is what Postgres runs. Only the real database can
 * say that, which is why RUN-ME-029 ends with a verification query to run against one team
 * before anybody is paid from it.
 *
 * Use it:   fakeDb(tables, { rpc: { ...RECOVERY_TOTALS_RPC } })
 */

const K = v => String(v == null ? '' : v).trim().toUpperCase();
const n0 = v => (v == null ? 0 : Number(v) || 0);
const inRange = (d, from, to) => d != null && String(d) >= String(from) && String(d) <= String(to);

/* `created_at desc nulls last, upload_batch desc nulls last` -- the winning batch, and the
   same total order pickLatestBatch uses: newest first, ties broken on the batch id, a NULL
   sorting below any value so a real upload beats the legacy rows it replaced. */
function better(a, b) {
  const ca = String(a.created_at || ''), cb = String(b.created_at || '');
  if (ca !== cb) return ca > cb;
  return String(a.upload_batch || '') > String(b.upload_batch || '');
}

/** distinct on (keys...) order by ... -- one winner per group. */
function winners(rows, keyOf) {
  const win = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const cur = win.get(k);
    if (!cur || better(r, cur)) win.set(k, r);
  }
  return win;
}

const sameBatch = (a, b) => (a.upload_batch == null && b.upload_batch == null)
  || String(a.upload_batch) === String(b.upload_batch);

export const RECOVERY_TOTALS_RPC = {
  recovery_day_totals(store, args) {
    const from = String(args.p_from), to = String(args.p_to);
    const teams = args.p_teams == null ? null : new Set(args.p_teams.map(K));
    const all = store.defaulter_snapshots ? store.defaulter_snapshots.rows : [];
    const mine = r => teams == null || teams.has(K(r.team));

    // 1. cur_win / cur -- the winning batch of every current deck in the range.
    const curAll = all.filter(r => r.snapshot_type === 'current'
      && inRange(r.snapshot_date, from, to) && mine(r) && r.ref != null);
    const curWin = winners(curAll, r => `${r.snapshot_date}|${K(r.weekday)}|${K(r.team)}`);
    const cur = curAll.filter(r =>
      sameBatch(r, curWin.get(`${r.snapshot_date}|${K(r.weekday)}|${K(r.team)}`)));

    // 2. decks -- a deck is a weekday AND a team, on a date.
    const decks = new Map();
    for (const r of cur) decks.set(`${r.snapshot_date}|${K(r.weekday)}|${K(r.team)}`,
      { date: String(r.snapshot_date), wd: K(r.weekday), tk: K(r.team) });

    // 3. base -- the last CURRENT deck before the range wins; else the latest INITIAL not
    //    after `to`. Same precedence the JavaScript applies.
    const pickDeck = (rows, keyOf) => {
      const byDate = new Map();
      for (const r of rows) {
        const k = keyOf(r);
        const cur0 = byDate.get(k);
        if (!cur0 || String(r.snapshot_date) > String(cur0.snapshot_date)
          || (String(r.snapshot_date) === String(cur0.snapshot_date) && better(r, cur0))) byDate.set(k, r);
      }
      return byDate;
    };
    const preAll = all.filter(r => r.snapshot_type === 'current'
      && String(r.snapshot_date) < from && mine(r) && r.ref != null);
    const preWin = pickDeck(preAll, r => `${K(r.weekday)}|${K(r.team)}`);
    const pre = preAll.filter(r => {
      const w = preWin.get(`${K(r.weekday)}|${K(r.team)}`);
      return w && String(w.snapshot_date) === String(r.snapshot_date) && sameBatch(r, w);
    });
    const iniAll = all.filter(r => r.snapshot_type === 'initial'
      && String(r.snapshot_date) <= to && mine(r) && r.ref != null);
    const iniWin = pickDeck(iniAll, r => `${K(r.weekday)}|${K(r.team)}`);
    const ini = iniAll.filter(r => {
      const w = iniWin.get(`${K(r.weekday)}|${K(r.team)}`);
      return w && String(w.snapshot_date) === String(r.snapshot_date) && sameBatch(r, w);
    });

    const base = new Map();                       // wd|rk -> { wd, rk, tk, team, arrears }
    for (const r of pre) base.set(`${K(r.weekday)}|${K(r.ref)}`,
      { wd: K(r.weekday), rk: K(r.ref), tk: K(r.team), team: r.team, arrears: n0(r.arrears) });
    for (const r of ini) {
      const k = `${K(r.weekday)}|${K(r.ref)}`;
      if (!base.has(k)) base.set(k,
        { wd: K(r.weekday), rk: K(r.ref), tk: K(r.team), team: r.team, arrears: n0(r.arrears) });
    }

    // 4. grid -- every book against every day its own deck came round, present or not. A book
    //    the deck no longer names owes nothing: that is the fully-recovered case.
    const arrOn = new Map();
    for (const r of cur) arrOn.set(`${r.snapshot_date}|${K(r.weekday)}|${K(r.ref)}`, n0(r.arrears));
    const seq = [];
    for (const b of base.values()) {
      for (const d of decks.values()) {
        if (d.wd !== b.wd || d.tk !== b.tk) continue;
        seq.push({ wd: b.wd, rk: b.rk, team: b.team, date: d.date,
          cur: arrOn.has(`${d.date}|${b.wd}|${b.rk}`) ? arrOn.get(`${d.date}|${b.wd}|${b.rk}`) : 0 });
      }
    }
    // 5. newcomers -- never in a baseline, so their FIRST day attributes nothing.
    for (const r of cur) {
      if (base.has(`${K(r.weekday)}|${K(r.ref)}`)) continue;
      seq.push({ wd: K(r.weekday), rk: K(r.ref), team: r.team,
        date: String(r.snapshot_date), cur: n0(r.arrears) });
    }

    // 6. walked -- `before` is the previous observation, seeded from the baseline.
    const byBook = new Map();
    for (const s of seq) {
      const k = `${s.wd}|${s.rk}`;
      if (!byBook.has(k)) byBook.set(k, []);
      byBook.get(k).push(s);
    }
    const out = new Map();
    for (const [k, rows] of byBook) {
      rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const seed = base.has(k) ? base.get(k).arrears : null;
      let prev = null;
      for (let i = 0; i < rows.length; i++) {
        const before = i === 0 ? seed : prev;
        prev = rows[i].cur;
        if (before == null) continue;             // where w.before is not null
        const drop = Math.max(before - rows[i].cur, 0);
        if (!drop) continue;
        const ok = `${rows[i].date}|${rows[i].team}`;
        out.set(ok, { snapshot_date: rows[i].date, team: rows[i].team,
          recovered: (out.get(ok) ? out.get(ok).recovered : 0) + drop });
      }
    }
    // having sum(...) <> 0
    return [...out.values()].filter(r => r.recovered !== 0);
  },
};
