import { supabase } from './supabase.js';

/** Same shape and job as auth_() in Code.gs: resolve an access code to
    {code, name, role, teams, tabs}. Throws on an invalid code -- callers don't need to
    re-check, same as before. */
export async function authCode(code) {
  if (!code) throw new AuthError('Access code required.');
  const { data, error } = await supabase.from('access_codes').select('*').eq('code', code).maybeSingle();
  if (error) throw new AuthError('Auth lookup failed: ' + error.message);
  if (!data) throw new AuthError('Invalid access code.');
  return {
    code: data.code,
    name: data.name,
    role: data.role,
    teams: data.teams && data.teams.length ? data.teams : null,   // null = ALL teams, matching Code.gs's convention
    tabs: data.tabs || [],
  };
}

/** Same as teamAllowed_() -- null teams (ALL access) always passes. */
export function teamAllowed(user, team) {
  if (!user.teams) return true;
  return user.teams.some(t => String(t).trim().toUpperCase() === String(team || '').trim().toUpperCase());
}

/** ADMIN always holds every tab -- that is the rule the live system's auth_() uses
    (isAdmin -> ADMIN_TABS), and it is why Upload/Settings can go missing here: an ADMIN
    row whose TABS cell happens to be blank ends up with nothing granted. Resolving tabs in
    ONE place keeps /api/me (which draws the UI) and /api/portal (which enforces) agreeing. */
export const USER_TABS = ['dashboard', 'apps', 'followup', 'assignments', 'promises', 'fureport',
  'complaints', 'restructure', 'legal', 'expected', 'defexp', 'credit', 'abnormal', 'reports',
  'weekly', 'par', 'present', 'teams', 'commission', 'calls'];
export const ADMIN_TABS = USER_TABS.concat(['upload', 'settings']);

export function resolveTabs(user, roleTabs) {
  if (String(user.role || '').trim().toUpperCase() === 'ADMIN') return ADMIN_TABS.slice();
  const merged = [...new Set([...(user.tabs || []), ...(roleTabs || [])])];
  return merged.length ? merged : USER_TABS.slice();
}

/** Same as can_() -- checks the role's tab permissions. Extend ROLE_TABS as roles are migrated. */
export async function can(user, tab) {
  // ADMIN holds every tab, same as resolveTabs and the live system's auth_(). Without this an
  // ADMIN whose TABS cell is blank was refused by /api/upload ("Upload permission is required
  // for your access code") even though the portal UI showed the tab -- the UI and the
  // enforcement have to read the SAME rule, and this is the third caller of it.
  if (String(user.role || '').trim().toUpperCase() === 'ADMIN') return true;
  if (user.tabs && user.tabs.includes(tab)) return true;
  const { data } = await supabase.from('roles').select('tabs').eq('role', user.role).maybeSingle();
  return !!(data && data.tabs && data.tabs.includes(tab));
}

export class AuthError extends Error {
  constructor(message) { super(message); this.name = 'AuthError'; this.status = 401; }
}

/** Wraps a Vercel API handler so AuthError/any thrown error becomes a clean JSON error
    response instead of a raw 500 -- every route below uses this. */
export function withApi(handler) {
  return async (req, res) => {
    // These endpoints are deliberately callable from another origin: the upload page carries an
    // "API endpoint" field so one deployment can feed another, and a phone that saved a
    // different site URL still has to reach this API. Without these headers the browser
    // refuses the POST before it is ever sent and the page can only report "Failed to fetch".
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    try {
      const result = await handler(req, res);
      if (result !== undefined) res.status(200).json({ ok: true, ...result });
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ ok: false, error: e.message || String(e) });
    }
  };
}
