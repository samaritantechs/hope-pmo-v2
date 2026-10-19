/* =====================================================================================
   A CUSTOMER'S HISTORY FOLLOWS THE DOCKET, NOT THE LOAN.
   =====================================================================================
   "remember comments and location should be docket based so that they travel all reference
    numbers / loan tracks"

   Every comment is filed under the REF it was written about and under the customer's docket key
   (see docket.js). Reading the history asks for the docket, so the notes made on the second loan
   are on the card of the third -- and the ref is still on every row, so a card can say which
   loan a note belonged to. This is the ONE read of a customer's notes, used by the phone's card
   and the portal's drawer alike: two readers with two rules would be two histories.

   ONE READ, with ONE fallback. Before db/RUN-ME-2026-10-19-docket-keys.sql the column is not
   there; PostgREST refuses the whole query for an unknown column, so the read is made again by
   ref alone -- the history the card always had -- and the column is not asked for again for
   five minutes. Rule 1: the happy path costs exactly what it did (one keyed read, now on an
   index of its own); the fallback costs one more only in that state. */
import { runQuery } from './supabase.js';
import { docketKeyOf } from './docket.js';

const RETRY_MS = 5 * 60 * 1000;
const keyGone_ = new WeakMap();                  // db client -> ms until which docket_key is known absent
export const docketKeyMissing_ = e => /docket_key/i.test(String((e && (e.message || e.code)) || e || ''));

/** Runs a query with the docket key when this database has it, and the ref-only form when it
    has not -- run(key) / run(null). Shared by every reader and writer of the two keyed tables. */
export async function withDocketKey(db, nowMs, key, run) {
  const on = !!key && (keyGone_.get(db) || 0) <= nowMs;
  let res = await run(on ? key : null);
  if (on && res && res.error && docketKeyMissing_(res.error)) {
    keyGone_.set(db, nowMs + RETRY_MS);
    res = await run(null);
  }
  return res;
}
export function docketKeyKnownAbsent(db, nowMs) { return (keyGone_.get(db) || 0) > nowMs; }
export function _forgetDocketKeyState() { /* tests only: a fresh db client is a fresh WeakMap entry */ }

/** The comments of the customer this ref belongs to, newest first, capped: by docket where the
    database has the key, by ref alone where it has not. `cols` is the caller's own projection;
    `ref` is always added so a row can say which loan it was about. */
export async function commentsOf(db, { ref, docketNo, cols, limit }, nowMs = Date.now()) {
  const r = String(ref == null ? '' : ref).trim();
  const key = docketKeyOf(r, docketNo);
  const want = /\bref\b/.test(cols) ? cols : 'ref, ' + cols;
  const res = await withDocketKey(db, nowMs, key, k => runQuery(() => {
    let q = db.from('followup_comments').select(want);
    q = k ? q.or('docket_key.eq.' + k + ',ref.eq.' + r) : q.eq('ref', r);
    return q.order('created_at', { ascending: false }).limit(limit);
  }, 1));
  if (res.error) throw new Error(res.error.message);
  return { rows: res.data || [], key, byDocket: !!key && !docketKeyKnownAbsent(db, nowMs) };
}
