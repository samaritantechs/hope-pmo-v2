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
  const all = await fetchAll(() => {
    let q = db.from(table).select('*').eq('snapshot_date', date);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    return q;
  });
  const rows = pickLatestBatch(all);
  if (!rows.length) return { rows: [], date: null, batch: null };
  return { rows, date, batch: rows[0].upload_batch || 'legacy' };
}

/** One-query fetch of every snapshot row in [fromDate, toDate] matching `filters` -- raw,
    ungrouped. Pair with resolveLatestPerKey to batch-resolve per day/weekday without a round
    trip per group (the weekend dashboard reads a whole week in two queries this way). */
export async function snapshotsInRange(db, table, filters, fromDate, toDate) {
  return fetchAll(() => {
    let q = db.from(table).select('*').gte('snapshot_date', fromDate).lte('snapshot_date', toDate);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
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
