import { fetchAll } from './supabase.js';

/** Batch-aware snapshot reads.
    Snapshot tables are append-only BY DESIGN -- a re-upload never overwrites history. But the
    original reads fetched every row for the latest snapshot_date, so re-uploading a corrected
    file for the same day stacked BOTH copies into every KPI (double customers, double amounts).

    The fix: every upload stamps one `upload_batch` uuid across all of its rows (api/upload.js
    and migrate/run.js both do this), and every read resolves latest snapshot_date -> latest
    batch within that date. Rows from before the column existed have NULL, which resolves as
    one 'legacy' batch -- no backfill needed, and a stamped re-upload of the same date still
    beats them on created_at.

    Reads are also capped at `notAfter` (normally today on the EAT clock): snapshots are
    append-only with no delete path, so without the cap a single typo'd future meta.date would
    hijack "latest" until that date actually arrived. */

/** rows must all belong to one snapshot_date. Keeps only the rows of the batch that contains
    the newest created_at -- i.e. the most recent upload of that date wins, whole-batch. */
/** Team names are stored UPPERCASE everywhere (normTeam does it on every write path), but the
    list on an access code is typed by a person and may not be. Matching without normalising
    would silently return NOTHING for that user -- an empty screen, no error, no clue. */
export function upperTeams(teams) {
  return [...new Set((teams || []).map(t => String(t == null ? '' : t).trim().toUpperCase()).filter(Boolean))];
}

/** Whatever a caller asks for, a snapshot read also needs the two columns that decide WHICH
    upload wins -- pickLatestBatch compares created_at and groups on upload_batch. Leaving them
    out would make every row look like one nameless batch and quietly stack a re-upload on top
    of the file it replaced, which is the exact double-counting the batch stamp exists to stop.
    So they are added back rather than trusted to a caller's list. */
const BATCH_KEYS = ['upload_batch', 'created_at'];
function withBatchKeys(columns) {
  if (!columns) return '*';
  const list = (Array.isArray(columns) ? columns : String(columns).split(','))
    .map(s => String(s).trim()).filter(Boolean);
  if (list.includes('*')) return '*';
  for (const k of BATCH_KEYS) if (!list.includes(k)) list.push(k);
  return list.join(', ');
}

export function pickLatestBatch(rows) {
  if (!rows || !rows.length) return [];
  let newest = rows[0];
  for (const r of rows) {
    if (String(r.created_at || '') > String(newest.created_at || '')) newest = r;
  }
  const winner = newest.upload_batch || null;
  return rows.filter(r => (r.upload_batch || null) === winner);
}

/** Resolve ONE snapshot: the latest snapshot_date matching `filters` (bounded by
    opts.notAfter / opts.notBefore, or pinned with opts.onDate), then the latest upload batch
    within that date. Returns { rows, date, batch } -- date/batch are null when nothing matched,
    so callers can surface exactly which snapshot a figure came from. */
export async function latestSnapshot(db, table, filters, opts = {}) {
  let date = opts.onDate || null;
  if (!date) {
    let q = db.from(table).select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    if (opts.notAfter) q = q.lte('snapshot_date', opts.notAfter);
    if (opts.notBefore) q = q.gte('snapshot_date', opts.notBefore);
    const { data: latest, error } = await q.maybeSingle();
    if (error) throw error;
    if (!latest) return { rows: [], date: null, batch: null };
    date = latest.snapshot_date;
  }
  /* opts.teams narrows the ROWS to the teams the caller may see -- at the database, not after
     the fact. A field officer belongs to ONE team; downloading all forty and throwing away
     thirty-nine is how 0.147 GB of data turned into 81 GB of transfer in a month.

     Deliberately NOT applied to the date resolution above: the latest snapshot date must stay
     a property of the whole upload, or a team with no rows that day would silently fall back
     to an older date and the officer would work yesterday's list without being told. */
  
  /* THE COLUMN LIST IS NOT SAFE TO NARROW HERE, and an attempt to do so is what put customer
     rows on officers' phones with no name and nothing to tap.

     latestSnapshot is SHARED. The same function feeds the phone's Leo/Kesho lists (which need
     ref, full_name, contact, guarantor_name, guarantor_contact, due_summary), the Exp.Def
     rotation (status, disb_date, expire_date, chronic_date, days_elapsed, other_inst, ds, dc)
     and the dashboard (payment_expected, arrears, todays_status). A single hard-coded list
     cannot serve all three: whatever it leaves out, some screen silently loses.

     Narrowing belongs where the caller knows what it needs -- so it is opt-in: opts.columns,
     passed by a caller that has listed what it reads, and '*' for everyone else. A caller that
     asks for too little gets nulls in that caller only, and the fake database in the tests
     honours the projection so the missing column shows up as a red test rather than a blank
     screen in the field. */
  const all = await fetchAll(() => {
    let q = db.from(table).select(withBatchKeys(opts.columns)).eq('snapshot_date', date);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    if (opts.teams && opts.teams.length) q = q.in('team', upperTeams(opts.teams));
    return q;
  });
  const rows = pickLatestBatch(all);
  if (!rows.length) return { rows: [], date: null, batch: null };
  return { rows, date, batch: rows[0].upload_batch || 'legacy' };
}

/** One-query fetch of every snapshot row in [fromDate, toDate] matching `filters` -- raw,
    ungrouped. Pair with resolveLatestPerKey to batch-resolve per day/weekday without a round
    trip per group (the weekend dashboard reads a whole week in two queries this way). */
export async function snapshotsInRange(db, table, filters, fromDate, toDate, teams, columns) {
  /* Same reasoning as latestSnapshot: shared by the weekly dashboard, the officer boards and
     the phone's week figure, each needing a different set -- so `columns` is opt-in and
     defaults to everything. This one is where it matters most: a range read is a whole WEEK of
     snapshots, so every column left out is dropped five to seven times over. */
  return fetchAll(() => {
    let q = db.from(table).select(withBatchKeys(columns)).gte('snapshot_date', fromDate).lte('snapshot_date', toDate);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    if (teams && teams.length) q = q.in('team', upperTeams(teams));   // narrow at the database
    return q;
  });
}

/** Group rows by keyFn, then within each group keep only the latest snapshot_date and the
    latest batch on it -- the in-memory equivalent of latestSnapshot per group. Returns a
    Map of key -> { rows, date, batch }. */
export function resolveLatestPerKey(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = new Map();
  for (const [k, g] of groups) {
    let maxDate = g[0].snapshot_date;
    for (const r of g) if (String(r.snapshot_date) > String(maxDate)) maxDate = r.snapshot_date;
    const dayRows = pickLatestBatch(g.filter(r => String(r.snapshot_date) === String(maxDate)));
    out.set(k, { rows: dayRows, date: maxDate, batch: dayRows.length ? (dayRows[0].upload_batch || 'legacy') : null });
  }
  return out;
}
