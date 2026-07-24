import { supabase, fetchAll } from './lib/supabase.js';
import { authCode, teamAllowed, withApi } from './lib/auth.js';

// GET  /api/followup?code=XXX             -> list, team-scoped
// POST /api/followup  { code, ref, comment, fuStatus, promiseDate, promiseAmt, newNumber, dockNo, fullName, team }
//        -> appends a comment row AND updates followup_status in one call (matching what
//           addCommentAs_ did in Code.gs: the comment log is the history, followup_status
//           is always "whatever the latest comment said", kept in sync on every write
//           instead of being rebuilt from a scan).
export default withApi(async (req, res) => {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  const e = new Error('Method not allowed'); e.status = 405; throw e;
});

async function handleGet(req) {
  const { code } = req.query;
  const user = await authCode(code);
  const data = await fetchAll(() => supabase.from('followup_status').select('*').order('arrears', { ascending: false }));
  const rows = (data || []).filter(r => teamAllowed(user, r.team));
  return { rows, count: rows.length };
}

async function handlePost(req) {
  const { code, ref, comment, fuStatus, promiseDate, promiseAmt, newNumber, dockNo, fullName, team } = req.body || {};
  const user = await authCode(code);
  if (!ref) { const e = new Error('ref is required'); e.status = 400; throw e; }

  const { data: existing } = await supabase.from('followup_status').select('team').eq('ref', ref).maybeSingle();
  if (existing && !teamAllowed(user, existing.team)) {
    const e = new Error(`You do not have access to team ${existing.team}.`); e.status = 403; throw e;
  }

  // Same rule as FU_NEED_DATE / FU_NEED_COMMENT / FU_NEED_NUMBER in Code.gs -- kept here
  // rather than trusted purely client-side, since this is exactly the kind of check that's
  // cheap to enforce server-side and expensive to have silently skipped.
  if (fuStatus === 'AMETOA AHADI' && !promiseDate) {
    const e = new Error('A promise date is required for "Ametoa Ahadi".'); e.status = 400; throw e;
  }
  if (['AMETOA AHADI', 'AMETUMA KWA AFISA', 'REJESHO LIMELIWA', 'OTHERS'].includes(fuStatus) && !comment) {
    const e = new Error('A comment is required for that follow-up status.'); e.status = 400; throw e;
  }
  if (fuStatus === 'ANA NAMBA NYINGINE' && !newNumber) {
    const e = new Error('A new phone number is required for "Ana namba nyingine".'); e.status = 400; throw e;
  }

  const now = new Date().toISOString();
  const { error: cErr } = await supabase.from('followup_comments').insert({
    ref, docket_no: dockNo, team, full_name: fullName, comment, fu_status: fuStatus,
    promise_date: promiseDate || null, promise_amt: promiseAmt || null, new_number: newNumber || null,
    created_by: user.name, created_at: now,
  });
  if (cErr) throw new Error(cErr.message);

  const { error: uErr } = await supabase.from('followup_status').update({
    fu_status: fuStatus, promise_date: promiseDate || null, promise_amt: promiseAmt || null,
    last_comment: comment, comment_by: user.name, comment_at: now, updated_at: now,
  }).eq('ref', ref);
  if (uErr) throw new Error(uErr.message);

  return { ref, savedAt: now };
}
