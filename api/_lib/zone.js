/* =====================================================================================
   WHOSE ZONE -- the zone a signed-in person sees beside their name.
   =====================================================================================
     "GMOs must see ther zone names infront of their name in login e.g
        MARK II - "LAKE ZONE"
        GMO · All teams · 2026-11-10-a"
     "in short after switching in system everyone must see their zone"
     "so team name with zone infront of it, manager gmo opm etc as such too"
                                                        -- the owner, 11 November 2026

   A zone is a column of Teams & Staff (teams.zone, db/migrations/2026-08-09-team-contacts.sql).
   Nothing stores a zone against a person, and the owner's own example is why a code's team
   list cannot answer alone: that GMO holds ALL teams and still has one zone.

   A TEAM'S ZONE IS ITS GMO'S (teamsZoned, below).
     "If an officer has team - zone is automatic of the GMO's" ... "to the respective team's gmo"
     "So even manager - must have gmo of one of his team and auto match gmo and zone"
                                                        -- the owner, 11 November 2026
   A zone is the teams under one GMO: the staff form has always called it "ZONE (under GMO)".
   So a team whose own ZONE cell is empty is not a team without a zone while Teams & Staff
   names its GMO: it sits in the zone that GMO's other teams carry. Nobody has to fill the cell
   for an officer of that team to be in a zone, and a manager over several teams is in the zone
   of the GMO of any one of them. What is typed in a team's own ZONE cell always stands; the
   GMO's zone is read only where the cell is empty. A cell that holds a dash, N/A or "NO GMO"
   names nobody (nameOrNull in parse.js), in the GMO column and in the ZONE column alike.
   Everything below reads the teams THROUGH teamsZoned, and so does the advance desk
   (advZones_), so the name line, the staff a code may list and the staff-change scripts (tz in
   db/TEMPLATE-staff-changes-from-gmo.sql, the same rule in SQL) give a team one zone between
   them. tools/db-checks/gmo-zone-parity.mjs reads random team tables both ways to keep the
   JavaScript and the SQL alike.

   THE RULE, in one place:
     0. ONLY THE TEAMS THE CODE MAY SEE ARE LOOKED AT. A code with a team list is looked for
        among its own teams and nowhere else: every screen it opens is scoped to those teams, so
        a zone from outside them would contradict the rest of the page -- and a namesake on
        another team would hand somebody a stranger's zone. A code that holds every team is
        looked for on every team.
     1. THE TEAMS THAT NAME THE PERSON. Teams & Staff names people in its role columns (OPM,
        Recovery, GMO, Manager, Credit, Expected, Bike, Legal, Collection). The zones of the
        teams that name this sign-in are theirs. A name is matched the way the portal already
        matches a leader to the teams table: trimmed, in capitals (iAmLeader in portal-core.js).
        A team code is signed in as the team ("VWAWA · F.O"), is nobody's name, and skips this.
     2. ELSE THE TEAMS THE CODE HOLDS. A code with a team list shows the zones of those teams:
        the advance desk's rule (advZones_ in portal-core.js), which calls zonesOfTeams below.
        So the name line never shows a zone the advance desk would not give the same code; it
        shows fewer only when the person is named on some of their teams and not the others.
        A team code holds its one team, so it shows that team's zone.
     3. ELSE IT IS SAID, NOT LEFT BLANK -- "am not seeing my zone yet" (an ADMIN over all teams,
        named on no team, looking at a name with nothing beside it and no way to tell a rule
        from a fault). A code that holds every team and is named nowhere holds every zone, which
        is how the advance desk has always read it: ALL ZONES. A person whose teams are known
        and carry no zone on Teams & Staff -- no ZONE cell of their own and no GMO whose other
        teams carry one -- reads NO ZONE SET, which is the admin's cue to fill the ZONE column
        or name the GMO. The page writes the words; this module says which case it is
        (zoneAll, zoneUnset). Only a read that failed or ran out of time leaves the name bare.

   A zone is compared and shown in capitals, as the advance desk has always read it. Several
   zones are listed in alphabetical order; past ZONE_SHOWN of them the rest are counted.

   COST. One read of the teams table (one row a team, eleven columns), and ONLY when the
   sign-in asks for it (/api/me?zone=1). The GMO's zone is worked out from those same rows (the
   GMO column was already among the eleven): no read was added for it, here or on the advance
   desk, whose teams were already read. The page's fifteen-minute version check and the
   deck's three-minute one call /api/me without it and read exactly what they read before.
   Nothing on /api/upload, nothing on /api/call. A database without the zone column, a read
   that fails, or one that has not answered inside ZONE_BUDGET_MS answers "no zone": the name
   is drawn as it always was, and the sign-in is never kept waiting on its decoration. */
import { teamAllowed } from './auth.js';
import { nameOrNull } from './parse.js';

const K = s => String(s == null ? '' : s).trim().toUpperCase();

/** The columns of Teams & Staff that hold a person's name. */
export const ZONE_ROLE_COLS = ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike', 'legal', 'collection'];
/** How many zones are written out beside a name before the rest are counted. */
export const ZONE_SHOWN = 2;
/** How long the sign-in waits for the zone before it answers without one. The read runs beside
    the sign-in's other reads, so this is a ceiling on a slow teams table, not a wait. */
export const ZONE_BUDGET_MS = 1500;
const ZONE_READ = ['team', 'zone'].concat(ZONE_ROLE_COLS).join(', ');

/* A DASH IS NOT A PERSON, AND NOT A ZONE. The GMO and ZONE cells are read through the repository's one definition of
   "nobody named" (nameOrNull in parse.js: blank, dashes, N/A, NONE, NIL, HAKUNA, a bare 0), plus the two ways a sheet
   says it in words, which the annual deck already reads so ("NO GMO", "(unassigned)"). Without this, every team whose
   GMO cell holds a dash would be "the teams of one GMO", and a team with no zone would take the zone of a stranger's. */
const NO_ONE = /^(?:NO[ -]|\(UNASSIGNED\))/i;
const cell = v => { const s = nameOrNull(v); return s === null || NO_ONE.test(s) ? '' : s; };
/** A GMO's name as it is compared from one team to the next: trimmed, in capitals, runs of blanks as one. '' for nobody. */
const G = s => cell(s).toUpperCase().replace(/\s+/g, ' ');
/** A team's own ZONE cell as the rule reads it: trimmed, in capitals. '' when the cell names no zone. */
const Z = s => cell(s).toUpperCase();

/** A TEAM'S ZONE IS ITS GMO'S. The rows of Teams & Staff, each with its zone: the team's own
    ZONE cell where it has one; else the zone most of its GMO's other teams carry (a tie goes to
    the first in A-to-Z order, so the answer never depends on the order of the rows). A team with
    no ZONE cell and no GMO, or whose GMO has no team with a zone, stays without one (and a cell
    that only holds a dash comes back as the empty cell it is). Takes ALL the rows -- a GMO's
    other teams can lie outside the teams a code holds -- and is asked BEFORE any filter by
    team. The rows given are not changed; a row that took its GMO's zone is a copy marked
    zoneFromGmo. */
export function teamsZoned(teamRows) {
  const rows = teamRows || [];
  const carried = new Map();                     // GMO -> zone -> how many of their teams carry it
  for (const t of rows) {
    const g = t ? G(t.gmo) : '', z = t ? Z(t.zone) : '';
    if (!g || !z) continue;
    if (!carried.has(g)) carried.set(g, new Map());
    carried.get(g).set(z, (carried.get(g).get(z) || 0) + 1);
  }
  return rows.map(t => {
    if (!t || Z(t.zone)) return t;                // what is typed in the team's own cell stands
    const of = carried.get(G(t.gmo));
    if (of) {
      let zone = '', n = 0;
      for (const [z, c] of of) if (c > n || (c === n && z < zone)) { zone = z; n = c; }
      return { ...t, zone, zoneFromGmo: true };
    }
    // no zone from anywhere. A cell that holds a dash is handed on as the empty cell it is, so that the team reads
    // NO ZONE SET and is named on the advance desk, rather than sitting in a zone called "-".
    return K(t.zone) ? { ...t, zone: '' } : t;
  });
}

/** The distinct zones of some teams, as Teams & Staff spells them, in capitals and in order.
    Reads the rows as given: pass them through teamsZoned first (before any filter by team). */
export function zonesOfTeams(teamRows) {
  return [...new Set((teamRows || []).map(t => K(t && t.zone)).filter(Boolean))].sort();
}

/** The rule above, over rows already read. */
export function zonesOfUser(user, teamRows) { return zonesOver_(user, teamsZoned(teamRows)); }
/** ... over rows that already carry their GMO's zone. */
function zonesOver_(user, zoned) {
  if (!user) return [];
  const rows = (zoned || []).filter(t => t && teamAllowed(user, t.team));   // step 0: all of them for an all-teams code
  const me = user.teamCode ? '' : K(user.name);
  if (me) {
    const mine = zonesOfTeams(rows.filter(t => ZONE_ROLE_COLS.some(c => K(t[c]) === me)));
    if (mine.length) return mine;
  }
  return user.teams ? zonesOfTeams(rows) : [];
}

/** The sign-in's answer over rows already read: the zones and their label, or which kind of
    "no zone" this is. zoneAll: holds every team and is named nowhere, so every zone. zoneUnset:
    the person's teams are known and none of them carries a zone on Teams & Staff, its GMO's included. */
export function zoneAnswer(user, teamRows) {
  const zones = zonesOver_(user, teamsZoned(teamRows));
  if (zones.length || !user) return { zone: zoneLabel(zones), zones };
  const me = user.teamCode ? '' : K(user.name);
  const named = !!me && (teamRows || []).some(t => t && teamAllowed(user, t.team) && ZONE_ROLE_COLS.some(c => K(t[c]) === me));
  return !user.teams && !named ? { zone: '', zones, zoneAll: true } : { zone: '', zones, zoneUnset: true };
}

/** What is written beside the name: '' for no zone, the zones while they are few, a count past that. */
export function zoneLabel(zones) {
  const z = zones || [];
  if (z.length <= ZONE_SHOWN) return z.join(', ');
  return z.slice(0, ZONE_SHOWN).join(', ') + ' +' + (z.length - ZONE_SHOWN);
}

/** The sign-in's answer. One read; a failure or a slow answer is "no zone", never a failed or a
    held sign-in. `budgetMs` is for the tests; the route uses ZONE_BUDGET_MS. */
export async function zoneOfSignIn(db, user, budgetMs = ZONE_BUDGET_MS) {
  const none = { zone: '', zones: [] };
  let timer;
  try {
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), budgetMs); });
    const read = Promise.resolve(db.from('teams').select(ZONE_READ)).catch(() => null);
    const res = await Promise.race([read, late]);
    if (!res || res.error || !res.data) return none;
    return zoneAnswer(user, res.data);
  } catch (e) {
    return none;
  } finally {
    clearTimeout(timer);
  }
}
