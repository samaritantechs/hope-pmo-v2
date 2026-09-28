import { timingSafeEqual } from 'node:crypto';
import { supabase } from './_lib/supabase.js';
import { withApi } from './_lib/auth.js';
import { portalApi } from './_lib/portal-core.js';

// POST /api/shift-batch   { secret, imeis, from, details? }
//
// THE OTHER OFFICE'S SERVER, ASKING FOR AN ENROLMENT BATCH -- so a Shift needs nobody's code.
// See shiftBatchFromPartner_ in _lib/portal-core.js for the calling side. Its own route,
// and deliberately NOT a fn on /api/device: that door is the handsets' and must never learn
// what a nav is, while this one enrols on somebody's behalf and therefore must.
//
// Authenticated by DEVICE_SHIFT_SECRET, the same value on both deployments, compared in
// constant time. Unset here means this office does not accept automatic shifts at all --
// the other side's client is then told "need-batch" and falls back to a typed code.
//
// `details` -- [{ imei, item }] -- is what the sending office already knows about each phone,
// and it lands ONLY on rows this call minted. Hoop hands over customer stock it sold to HOPE
// automatically now (its api/_lib/handover.js), and a register full of blank models is not a
// register anybody can work a counter from. A row this office already had keeps its own item:
// the other office knows the phone's past, this one knows its present.
export default withApi(async (req) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  return shiftBatch(supabase, req.body || {});
});

export async function shiftBatch(db, a) {
  const secret = String(process.env.DEVICE_SHIFT_SECRET || '').trim();
  const given = String(a.secret || '').trim();
  const ok = secret && given.length === secret.length
    && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) {
    const e = new Error(secret
      ? 'Siri ya Hamisha si sahihi. / Shift secret refused.'
      : 'Ofisi hii haipokei Hamisha kiotomatiki (DEVICE_SHIFT_SECRET haijawekwa). / This office does '
        + 'not accept automatic shifts (DEVICE_SHIFT_SECRET not set).');
    e.status = 403; throw e;
  }
  /* Enrolled AS the other office, by name, so the audit log and the row's enrol trail say who
     asked -- a synthetic bench user holding exactly the one pane deviceEnrol requires. */
  const from = String(a.from || 'ofisi nyingine').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 20) || 'other';
  const user = { code: 'shift', name: 'SHIFT:' + from, role: 'ADMIN', teams: null, tabs: ['devlock'] };
  const r = await portalApi(db, user, 'deviceEnrol', { imeis: a.imeis });
  if (!r || !r.batch) { const e = new Error('Hakuna batch iliyotolewa. / No batch was minted.'); e.status = 500; throw e; }
  /* THE MODEL, ON THE ROWS JUST MINTED. One upsert naming exactly two columns -- an upsert
     writes the columns in its payload and nothing else -- bounded by the batch, and best
     effort: a register without a model is still the register. */
  let items = 0;
  const fresh = new Set((r.provision || []).filter(p => p && p.fresh).map(p => String(p.imei)));
  const rows = (Array.isArray(a.details) ? a.details : [])
    .filter(d => d && fresh.has(String(d.imei || '').trim()) && String(d.item || '').trim())
    .map(d => ({ imei: String(d.imei).trim(), item: String(d.item).trim().slice(0, 80) }));
  if (rows.length) {
    const { error } = await db.from('devices').upsert(rows, { onConflict: 'imei' });
    if (!error) items = rows.length;
  }
  return { ok: true, batch: r.batch, enrolled: r.enrolled, alreadyOn: r.alreadyOn, items };
}
