import { supabase } from './_lib/supabase.js';
import { authCode, withApi } from './_lib/auth.js';

// GET /api/me?code=XXX
// Who is this code, and what may they open? The launcher (public/home.html) calls this to
// sign someone in once and then show only the tiles they can actually use -- so the same
// home screen works for a field officer, a team leader and an admin without three builds.
//
// `tabs` is the union of the code's own tabs and its role's tabs, matching how can() in
// _lib/auth.js resolves permissions -- one rule, not a second copy of it here.
export default withApi(async (req, res) => {
  const user = await authCode(req.query.code);
  const { data: roleRow } = await supabase.from('roles').select('tabs').eq('role', user.role).maybeSingle();
  const tabs = [...new Set([...(user.tabs || []), ...((roleRow && roleRow.tabs) || [])])];
  return {
    name: user.name,
    role: user.role,
    teams: user.teams,                       // null = every team
    teamCount: user.teams ? user.teams.length : null,
    tabs,
    can: {
      dashboard: true,                       // anyone with a valid code may read their own scope
      upload: tabs.includes('upload'),
      admin: tabs.includes('settings'),
    },
  };
});
