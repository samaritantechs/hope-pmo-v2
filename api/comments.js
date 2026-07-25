import { supabase } from './_lib/supabase.js';
import { authCode, teamAllowed, withApi } from './_lib/auth.js';

// GET /api/comments?code=XXX&ref=2202981621
export default withApi(async (req, res) => {
  const { code, ref } = req.query;
  const user = await authCode(code);
  if (!ref) { const e = new Error('ref is required'); e.status = 400; throw e; }

  const { data: status } = await supabase.from('followup_status').select('team').eq('ref', ref).maybeSingle();
  if (status && !teamAllowed(user, status.team)) {
    const e = new Error(`You do not have access to team ${status.team}.`); e.status = 403; throw e;
  }

  const { data, error } = await supabase.from('followup_comments').select('*').eq('ref', ref).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return { rows: data || [] };
});
