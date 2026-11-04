/* =====================================================================================
   WHO HELD EACH TEAM, WHEN -- the history Teams & Staff never kept.

     "I wish you backfill the leaders, then from the current ones whenever I change a name of
      code holder, trigger to save the previous one only if the new saved name is different.
      Because I might go there to edit something else from names."

   Teams & Staff answers "who is responsible NOW": a name in a column, overwritten on every
   move. That is right for today's boards and it is why a transfer is a one-field edit. But it
   means the past is rewritten every time somebody moves, and an annual report cannot say whose
   year a team's year was. `team_holders` is the other half: one row per team, per role, per
   stretch of days one person held it -- written automatically, never edited by hand.

   A ROW:  team (trimmed, upper-case, like every stamped row), role (the Teams & Staff column:
           gmo, manager, opm, collection = the PMO, credit, expected = early collection,
           recovery, bike, legal), name ('' = nobody held it), from_date, to_date. A stretch
           still running ends on OPEN (9999-12-31), which keeps every read one plain range
           query instead of "or is null".

   WHEN IT WRITES -- ONLY WHEN THE HOLDER CHANGED. Every Teams & Staff save asks syncHolders to
   compare who holds each role NOW (the sheet with the access codes laid over it, exactly what
   every board reads) with the stretch still open. Same person: nothing is written -- which is
   what makes it safe to open a team to change a phone number. A different person: the open
   stretch is closed the day before, and a new one opens today. A role emptied: the stretch
   closes and an empty one opens, so "nobody" is on the record as nobody and not as a gap.
   The first time a role is seen it is simply opened, from today.

   THE SAME PERSON UNDER TWO SPELLINGS IS NOT A CHANGE. The annual workbooks name a GMO
   "SULEIMAN"; Teams & Staff may carry "SULEIMAN MPOKI MWASUNGA". looseSame treats a name whose
   words all appear in another as the same person, so spelling a name out in full never records
   a transfer, and canonNames folds the two into one leader on the boards -- only when the longer
   name is the ONLY one it could be, so two different Suleimans are never merged.

   NEVER ON THE UPLOAD OR CALL PATHS, never able to break a save: the callers swallow every
   failure, including the table not existing yet (a migration run by hand).
   ===================================================================================== */
import { fetchAll } from './supabase.js';
import { todayKey, addDaysKey } from './time.js';

export const OPEN = '9999-12-31';
export const HOLDER_ROLES = ['gmo', 'manager', 'opm', 'collection', 'credit', 'expected', 'recovery', 'bike', 'legal'];
/** The portal functions after which who-holds-what may have changed. */
export const HOLDER_FNS = new Set(['saveTeam', 'deleteTeam', 'saveStaffTeams', 'saveAccessCode', 'deleteAccessCode']);

const K = s => String(s == null ? '' : s).trim().toUpperCase();
/** Team keys across spellings: letters and digits only -- "TENGERU- USARIVER " is TENGERUUSARIVER. */
export const teamKey = s => K(s).replace(/[^A-Z0-9]+/g, '');
export const cleanName = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
export const wordsOf = s => K(s).split(/[^A-Z0-9]+/).filter(Boolean);
const day = d => String(d == null ? '' : d).slice(0, 10);

/** The same person? Equal, or every word of the shorter name is in the longer. Two empty names
    (nobody, nobody) are the same; a name and nobody are not. */
export function looseSame(a, b) {
  const x = wordsOf(a), y = wordsOf(b);
  if (!x.length || !y.length) return !x.length && !y.length;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every(w => l.includes(w));
}

/** Each distinct name mapped to the fullest spelling it can only be: a name whose words are all
    in exactly one longest other name becomes that one. Two candidates and it stays as it is. */
export function canonNames(names) {
  const uniq = new Map();
  for (const n of names || []) {
    const c = cleanName(n);
    if (c && !uniq.has(K(c))) uniq.set(K(c), c);
  }
  const list = [...uniq.values()], words = list.map(wordsOf);
  const inside = (a, b) => a.length < b.length && a.every(w => b.includes(w));      // a is strictly inside b
  const next = i => {
    const cands = [];
    for (let j = 0; j < list.length; j++) if (j !== i && inside(words[i], words[j])) cands.push(j);
    const longest = cands.filter(j => !cands.some(o => o !== j && inside(words[j], words[o])));
    return longest.length === 1 ? longest[0] : null;
  };
  const out = new Map();
  list.forEach((n, i) => {
    let cur = i;
    for (let guard = 0; guard < 6; guard++) { const nx = next(cur); if (nx == null) break; cur = nx; }
    out.set(K(n), list[cur]);
  });
  return out;
}

/* ---------------------------------------------------------------------------- reading */
/** The stretches that touch [from, to], one plain range query. Team-scoped at the database
    (the stored teams are upper-case and trimmed, which teamMatchList always includes). */
export async function readHolders(db, from, to, teams = null, matchList = null) {
  try {
    const rows = await fetchAll(() => {
      let q = db.from('team_holders').select('team, role, name, from_date, to_date, source')
        .lte('from_date', to).gte('to_date', from);
      if (teams && teams.length && matchList) q = q.in('team', matchList(teams));
      return q;
    });
    return { rows: rows || [], ok: true };
  } catch (e) {
    if (tableMissing(e)) return { rows: [], ok: false };
    throw e;
  }
}
export function tableMissing(err) {
  const s = err && typeof err === 'object' ? String(err.message || '') + ' ' + String(err.code || '') : String(err || '');
  return /does not exist|Could not find the table|42P01|PGRST205/i.test(s);
}

/** An index over stretches: who held (team, role) on a date. `undefined` = history is silent
    about that day; '' = it says nobody held it; otherwise the name. */
export function holderIndex(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const k = teamKey(r.team) + '|' + r.role;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ name: cleanName(r.name), from: day(r.from_date), to: day(r.to_date) });
  }
  for (const v of by.values()) v.sort((a, b) => a.from.localeCompare(b.from));
  return {
    size: by.size,
    holderAt(team, role, date) {
      const list = by.get(teamKey(team) + '|' + role);
      if (!list) return undefined;
      const d = day(date);
      for (const s of list) if (s.from <= d && d <= s.to) return s.name;
      return undefined;
    },
  };
}

/* ---------------------------------------------------------------------------- the trigger */
/** Record any change of holder since the last look. `readTeams(db, nowMs)` is the registry as
    every board sees it (readTeamsAll: the sheet with the access codes laid over it). Reads the
    open stretches and writes ONLY what differs. Returns { added, closed, dropped }. */
export async function syncHolders(db, nowMs, readTeams) {
  const today = todayKey(nowMs), yesterday = addDaysKey(today, -1);
  const [eff, open] = await Promise.all([
    readTeams(db, nowMs),
    fetchAll(() => db.from('team_holders').select('team, role, name, from_date, to_date').eq('to_date', OPEN)),
  ]);
  const openBy = new Map();
  for (const r of open || []) openBy.set(teamKey(r.team) + '|' + r.role, r);
  const add = [], close = [], drop = [];
  const stretch = (team, role, name) => ({ team: K(team), role, name, from_date: today, to_date: OPEN, source: 'app' });
  for (const t of eff || []) {
    if (!t || !t.team) continue;
    for (const role of HOLDER_ROLES) {
      if (!(role in t)) continue;                       // a column this database does not carry
      const name = cleanName(t[role]);
      const cur = openBy.get(teamKey(t.team) + '|' + role);
      if (!cur) { if (name) add.push(stretch(t.team, role, name)); continue; }
      if (looseSame(cur.name, name)) continue;          // the same person: nothing to save
      // A stretch that began today and is already over has no days in it: it is dropped, not kept.
      if (day(cur.from_date) > yesterday) drop.push(cur); else close.push(cur);
      add.push(stretch(cur.team, role, name));          // '' = nobody holds it now
    }
  }
  for (const r of close) {
    const { error } = await db.from('team_holders').update({ to_date: yesterday })
      .eq('team', r.team).eq('role', r.role).eq('from_date', day(r.from_date));
    if (error) throw new Error(error.message);
  }
  for (const r of drop) {
    const { error } = await db.from('team_holders').delete()
      .eq('team', r.team).eq('role', r.role).eq('from_date', day(r.from_date));
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < add.length; i += 500) {
    const { error } = await db.from('team_holders').upsert(add.slice(i, i + 500), { onConflict: 'team,role,from_date' });
    if (error) throw new Error(error.message);
  }
  return { added: add.length, closed: close.length, dropped: drop.length };
}

/* ---------------------------------------------------------------------------- the backfill */
/** The workbooks' leaders, expanded from api/_lib/annual-holders-data.js: lines of
    `TEAM|role|NAME:13-17,OTHER:18-22`, months counted from January 2025 as 1 (so January 2026
    is 13) and `~` for nobody. Every stretch is CLOSED at a month's end, so the app's own rows,
    which open on the day they are recorded, never overlap one. */
export function expandHolderData(text) {
  const out = [];
  const monthStart = n => { const y = 2025 + Math.floor((n - 1) / 12), m = ((n - 1) % 12) + 1; return y + '-' + String(m).padStart(2, '0') + '-01'; };
  const monthEnd = n => addDaysKey(monthStart(n + 1), -1);
  for (const line of String(text || '').split('\n')) {
    const [team, role, runs] = line.split('|');
    if (!team || !role || !runs) continue;
    for (const run of runs.split(',')) {
      const i = run.lastIndexOf(':');
      if (i < 0) continue;
      const name = run.slice(0, i) === '~' ? '' : run.slice(0, i);
      const [a, b] = run.slice(i + 1).split('-').map(Number);
      out.push({ team: K(team), role, name, from_date: monthStart(a), to_date: monthEnd(b == null || isNaN(b) ? a : b), source: 'workbook' });
    }
  }
  return out;
}
/** Load them. Rows already there (by team, role and start day) are left exactly as they are, so
    running it twice never overwrites a correction. Returns how many rows were offered. */
export async function loadWorkbookHolders(db) {
  const { HOLDER_DATA } = await import('./annual-holders-data.js');
  const rows = expandHolderData(HOLDER_DATA);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('team_holders').upsert(rows.slice(i, i + 500), { onConflict: 'team,role,from_date', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}
