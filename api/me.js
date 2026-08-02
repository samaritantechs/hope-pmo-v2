import { supabase } from './_lib/supabase.js';
import { authCode, withApi, resolveTabs } from './_lib/auth.js';

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
  const tabs = resolveTabs(user, roleRow && roleRow.tabs);
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
    /* THE THREE CADENCES THE PORTAL RUNS ON, which were numbers typed into the page.

       They ride along with sign-in because every user needs them and nobody but an admin may
       read the settings table. An officer cannot ask for settings; they can ask who they are,
       and this is part of who they are as far as the screen is concerned.

       Each is clamped to a range that keeps the app usable: a slide timer of one second, or a
       remembered screen that lasts an hour, is not a preference -- it is a broken portal that
       somebody has to be talked through undoing over the phone. */
    ui: await uiCadences(),
  };
});

export const clampNum = (raw, dflt, lo, hi) => {
  const n = parseInt(String(raw == null ? '' : raw).replace(/[^0-9]/g, ''), 10);
  return (!n || isNaN(n)) ? dflt : Math.max(lo, Math.min(hi, n));
};
async function uiCadences() {
  const keys = ['PRESENT_SECONDS', 'REFRESH_SECONDS', 'HINT_INTERVAL', 'HINT_LIFETIME'];
  let rows = [];
  // A settings table that will not answer must not stop anybody signing in. The defaults are
  // the numbers that were hard-coded before, so a failure here reads exactly like today.
  try {
    const { data } = await supabase.from('settings').select('key, value').in('key', keys);
    rows = data || [];
  } catch (e) { /* fall through to defaults */ }
  const get = k => { const r = rows.find(x => x.key === k); return r && r.value; };
  return {
    presentSeconds: clampNum(get('PRESENT_SECONDS'), 15, 5, 300),
    refreshSeconds: clampNum(get('REFRESH_SECONDS'), 90, 10, 900),
    hintIntervalSeconds: clampNum(get('HINT_INTERVAL'), 240, 30, 3600),
    hintLifetimeSeconds: clampNum(get('HINT_LIFETIME'), 7, 3, 60),
  };
}
