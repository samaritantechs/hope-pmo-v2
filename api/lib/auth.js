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

/** Same as can_() -- checks the role's tab permissions. Extend ROLE_TABS as roles are migrated. */
export async function can(user, tab) {
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
    try {
      const result = await handler(req, res);
      if (result !== undefined) res.status(200).json({ ok: true, ...result });
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ ok: false, error: e.message || String(e) });
    }
  };
}
