import { timingSafeEqual } from 'node:crypto';
import { supabase } from './_lib/supabase.js';
import { withApi } from './_lib/auth.js';
import { portalApi } from './_lib/portal-core.js';

// POST /api/shift-batch   { secret, imeis, from }
//
// THE OTHER OFFICE'S SERVER, ASKING FOR AN ENROLMENT BATCH -- so a Shift needs nobody's code.
// See shiftBatchFromPartner_ in _lib/portal-core.js for the calling side. Its own route,
// and deliberately NOT a fn on /api/device: that door is the handsets' and must never learn
// what a nav is, while this one enrols on somebody's behalf and therefore must.
//
// Authenticated by DEVICE_SHIFT_SECRET, the same value on both deployments, compared in
// constant time. Unset here means this office does not accept automatic shifts at all --
// the other side's client is then told "need-batch" and falls back to a typed code.
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
  return { ok: true, batch: r.batch, enrolled: r.enrolled, alreadyOn: r.alreadyOn };
}
