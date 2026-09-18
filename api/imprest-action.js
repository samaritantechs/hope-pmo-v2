import { supabase } from './_lib/supabase.js';
import { portalApi } from './_lib/portal-core.js';
import { imprestVerifyToken, imprestActionRow } from './_lib/imprest.js';

// GET  /api/imprest-action?id=<uuid>&token=<hex>            -- the confirmation page (read only)
// POST /api/imprest-action?id=<uuid>&token=<hex>&approve=1  -- the decision itself
//
// THE ONE-TAP LINK FROM THE GM'S EMAIL, WITHOUT AN ACCESS CODE -- "gm gets email that has the
// details and two links (single tap approval and disapproval or read)" / "so gm can approve
// through email or system by the current implementation".
//
// THE GET NEVER DECIDES ANYTHING. It renders a small page with the request on it and two
// buttons, Idhinisha and Kataa, each of which POSTs back here. That is deliberate and is the
// whole reason this is safe to send by email at all: a GET is exactly the request shape a
// corporate mail scanner, a link-preview generator, or Gmail's own image proxy will fetch on
// the sender's behalf before a human ever sees the message, and a GET that mutated would let
// any of those silently approve or reject a real cash request. Only the POST, which requires a
// deliberate second tap, moves a decision -- see imprestActionToken's note in _lib/imprest.js
// for the fuller reasoning, and api/shift-batch.js for the same "prove it with a secret, then
// act as a narrowly-scoped synthetic user" shape this reuses.
//
// Authenticated by IMPREST_LINK_SECRET (an env var, a deploy secret, same rule as
// DEVICE_SHIFT_SECRET): the token is an HMAC of the request id, so the same link serves READ
// and either DECISION. Unset on the deployment, this route refuses everything and the email
// simply does not carry a Decide link -- see gmActionLinks_ in _lib/imprest.js.
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money0 = n => Math.round(Number(n) || 0).toLocaleString('en-US');

function page(title, body, color) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)} — HOPE PMO</title>
    <style>
      body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial;background:#f4f6fb;color:#0f172a;
        margin:0;padding:24px 16px}
      .card{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:22px 20px;
        box-shadow:0 1px 3px rgba(0,0,0,.08)}
      h1{font-size:19px;margin:0 0 4px;color:#0B2A6B}
      .sub{color:#6b7280;font-size:13px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;font-size:13.5px;margin:10px 0}
      td{padding:5px 4px;border-bottom:1px solid #eef1f6}
      td:first-child{color:#6b7280;white-space:nowrap;padding-right:10px}
      td:last-child{text-align:right;font-weight:600}
      .btn{display:inline-block;width:100%;box-sizing:border-box;text-align:center;padding:13px;
        margin-top:10px;border:0;border-radius:9px;font:600 15px system-ui;cursor:pointer;color:#fff}
      .ok{background:#067647}.bad{background:#B42318}.ghost{background:#334155}
      .note{margin-top:14px;padding:10px 12px;border-radius:8px;font-size:13px}
      .note.ok{background:#ecfdf3;color:#067647}.note.bad{background:#fef3f2;color:#B42318}
      textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #d0d5dd;border-radius:6px;
        font:13.5px system-ui;margin-top:6px}
    </style></head><body><div class="card">
      <h1>${esc(title)}</h1>${body}
    </div></body></html>`;
}
function costRows(r) {
  return [['Jina / Name', esc(r.fullName || r.staffName)], ['Wadhifa / Role', esc(r.imprestRole)],
    ['Safari / Travel', esc(r.travelDate)], ['Mahali / Destination', esc(r.destination || '—')],
    ['Nauli / Fare', money0(r.fareAmount) + ' TZS'], ['Malazi / Accommodation', money0(r.accomAmount) + ' TZS'],
    ['Jumla / Total', money0(r.total) + ' TZS']]
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

/* `db` IS ALWAYS PASSED IN, NEVER READ OFF THE MODULE, so these two -- the whole of this
   route's logic -- can be exercised in a test against a fake database exactly like every
   other function in this system, and are not stranded behind the real `supabase` singleton
   the way a route that used it directly would be. See shiftBatch in api/shift-batch.js for
   the same shape. */
export async function handleGet(db, req, res, id, token) {
  if (!imprestVerifyToken(id, token)) {
    res.status(403).send(page('Kiungo si sahihi / Invalid link',
      '<p>Kiungo hiki hakisomeki au kimeisha. Fungua ombi hili kwenye portal badala yake. '
      + '/ This link could not be verified. Open the request in the portal instead.</p>'));
    return;
  }
  const row = await imprestActionRow(db, id);
  if (!row) { res.status(404).send(page('Halipo / Not found', '<p>Ombi hili halipo tena. / That request no longer exists.</p>')); return; }
  if (row.status !== 'pending') {
    const decided = row.status === 'approved'
      ? `IMEIDHINISHWA · ${money0(row.approved)} TZS na ${esc(row.decidedBy)}`
      : `IMEKATALIWA na ${esc(row.decidedBy)}`;
    res.status(200).send(page('Tayari limeamuliwa / Already decided',
      `<div class="sub">${esc(row.fullName)} · ${esc(row.travelDate)}</div>
       <table>${costRows(row)}</table><div class="note ok">${decided}</div>`));
    return;
  }
  res.status(200).send(page('Ombi la imprest / Imprest request',
    `<div class="sub">Tuma ${esc(row.staffName)} · ${esc(row.travelDate)}</div>
     <table>${costRows(row)}</table>
     <p style="font-size:13px;white-space:pre-wrap">${esc((row.purpose || '').slice(0, 500))}</p>
     <form method="POST" action="/api/imprest-action?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}">
       <input type="hidden" name="approve" value="1">
       <button class="btn ok" type="submit">✅ Idhinisha / Approve (${money0(row.total)} TZS)</button>
     </form>
     <form method="POST" action="/api/imprest-action?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}">
       <input type="hidden" name="approve" value="0">
       <label style="font-size:12.5px;color:#6b7280;display:block;margin-top:14px">Sababu ya kukataa (lazima) / Reason to reject (required)</label>
       <textarea name="comment" rows="2" required></textarea>
       <button class="btn bad" type="submit">❌ Kataa / Reject</button>
     </form>`));
}

export async function handlePost(db, req, res, id, token, body) {
  if (!imprestVerifyToken(id, token)) {
    res.status(403).send(page('Kiungo si sahihi / Invalid link', '<p>This link could not be verified.</p>'));
    return;
  }
  const approve = String(body.approve) === '1' || body.approve === true;
  const comment = String(body.comment || '');
  const user = { code: 'imprest-link', name: 'GM (barua pepe / email link)', role: 'GM-EMAIL-LINK',
    teams: null, tabs: ['impappr'] };
  try {
    const r = await portalApi(db, user, 'imprestDecide', { id, approve, comment, viaEmail: true });
    const notified = r.emailed && r.emailed.requester;
    const notifyLine = notified
      ? 'Mwombaji ameambiwa kwa email. / The requester has been notified by email.'
      : 'Mwombaji HAKUAMBIWA kwa email — ' + esc(r.emailNote || '') + '. / The requester was NOT emailed.';
    res.status(200).send(page(approve ? 'Imeidhinishwa / Approved' : 'Imekataliwa / Rejected',
      `<div class="note ${approve ? 'ok' : 'bad'}">${approve
        ? '✅ Ombi limeidhinishwa · ' + money0(r.granted) + ' TZS. / Request approved.'
        : '❌ Ombi limekataliwa. / Request rejected.'}</div>
       <p style="font-size:12.5px;color:#6b7280;margin-top:10px">${notifyLine}</p>`));
  } catch (e) {
    res.status(e.status || 500).send(page('Imeshindikana / Could not decide',
      `<div class="note bad">${esc(e.message || String(e))}</div>`));
  }
}

export default async function handler(req, res) {
  // Vercel's res.send() infers a content type from the value; named explicitly here rather
  // than relied on, since a wrong inference would leave this page rendering as plain text or,
  // worse, being offered as a download on some clients.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const id = String(req.query.id || '').trim();
  const token = String(req.query.token || '').trim();
  if (!id || !token) { res.status(400).send(page('Kiungo hakikamiliki / Incomplete link', '<p>Missing id or token.</p>')); return; }
  try {
    if (req.method === 'GET') { await handleGet(supabase, req, res, id, token); return; }
    if (req.method === 'POST') {
      // Vercel parses application/x-www-form-urlencoded and JSON bodies into req.body alike.
      await handlePost(supabase, req, res, id, token, req.body || {});
      return;
    }
    res.status(405).send(page('Njia si sahihi / Method not allowed', ''));
  } catch (e) {
    res.status(500).send(page('Hitilafu / Error', `<div class="note bad">${esc(e.message || String(e))}</div>`));
  }
}
