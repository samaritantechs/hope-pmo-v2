import fs from 'node:fs';
import { supabase } from './_lib/supabase.js';
import { authCodeResolved, withApi } from './_lib/auth.js';
import { isSystemOpen, isAdminUser } from './_lib/system-gate.js';
import { canSwitchWorkspace } from './_lib/workspace.js';

// GET /api/me?code=XXX
// Who is this code, and what may they open? The launcher (public/home.html) calls this to
// sign someone in once and then show only the tiles they can actually use -- so the same
// home screen works for a field officer, a team leader and an admin without three builds.
//
// `tabs` is the union of the code's own tabs and its role's tabs, matching how can() in
// _lib/auth.js resolves permissions -- one rule, not a second copy of it here.
export default withApi(async (req, res) => {
  /* Deliberately NOT behind the open/closed switch. This is how the launcher finds out who
     somebody is AND whether the system is open at all -- gate it and the closed message could
     never be drawn, only a bare "invalid code". */
  const user = await authCodeResolved(req.query.code);
  const tabs = user.tabs;
  const admin = isAdminUser(user);
  const open = admin || await isSystemOpen(supabase);
  return {
    name: user.name,
    role: user.role,
    teams: user.teams,                       // null = every team
    teamCount: user.teams ? user.teams.length : null,
    tabs,
    /* The version of public/app.html this deployment is serving. The page compares it against
       its own stamp and reloads past the cache when it is behind -- see appBuild() above for
       the permission change that arrived on the server and not on the screen. */
    build: appBuild(),
    /* Whether the system side is open to everybody. An admin always sees it as open, because
       for them it is -- they are the ones who close it, and they have to be able to get back
       in and turn it on again. */
    systemOpen: open,
    /* Whether HOPE Loan's own nav items belong in this code's sidebar at all -- "i thout we
       killing the sandbox shotcut and having one flow from now on". There is no separate
       switch to draw any more: an admin, or a code ticked for at least one of HOPE Loan's
       tabs, simply finds its screens sitting in the SAME sidebar as everything else, gated
       item-by-item exactly like every HOPE PMO tab. False for anybody holding none of those
       tabs, and false even for an admin until the second database is configured -- so an
       officer is never told the sandbox exists, and a half-set-up deployment offers no door
       that leads nowhere. */
    hopeLoanAvailable: await canSwitchWorkspace(user),
    can: {
      // Closed, there is no portal to offer. The server refuses these routes too; this is only
      // so the launcher does not draw a door that will not open.
      dashboard: open,
      upload: open && tabs.includes('upload'),
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

/* =====================================================================================
   WHICH VERSION OF THE PAGE OUGHT TO BE ON THAT SCREEN.
   =====================================================================================
     "I logged in using a code of someone i didnt assign any nav and when entered through the
      switch found many of them, even if i refresh they are there"

   The server had already stopped granting those tabs. What was drawing them was an OLD COPY
   OF THE PAGE -- the one that still carried the ALWAYS list -- served out of the browser's or
   the WebView's cache. A permission change is the worst possible thing to have arrive late,
   because the screen is the only evidence anybody has that it arrived at all, and a stale page
   says the opposite of the truth with complete confidence.

   Refreshing is not a reliable answer: /dashboard is already sent no-cache and it still
   happened, which is what an Android WebView holding its own copy looks like. Nor is telling
   somebody to clear a browser cache on a phone -- this file's own reload button exists because
   that is not an answer.

   So the page is TOLD which version it should be, on the one request every session makes, and
   reloads itself past the cache when it is behind. public/app.html carries the stamp as a
   plain string and is served exactly as written, so reading it here is reading the same fact
   the page will report about itself -- there is no build step for the two to drift across.

   Read once per cold start through `new URL(..., import.meta.url)`, which is the form Vercel's
   file tracer follows -- a cwd-based path traces to nothing and would throw in production. A
   failure returns null and the page carries on exactly as it does today. */
let buildStamp;
function appBuild() {
  if (buildStamp !== undefined) return buildStamp;
  try {
    const src = fs.readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');
    const m = src.match(/var BUILD = '([^']{1,40})'/);
    buildStamp = m ? m[1] : null;
  } catch (e) {
    buildStamp = null;
  }
  return buildStamp;
}

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
