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
     3. ELSE NOTHING. A code that holds every team and is named nowhere (an admin, the head
        office) has no zone, and none is invented for it.

   A zone is compared and shown in capitals, as the advance desk has always read it. Several
   zones are listed in alphabetical order; past ZONE_SHOWN of them the rest are counted.

   COST. One read of the teams table (one row a team, eleven columns), and ONLY when the
   sign-in asks for it (/api/me?zone=1). The page's fifteen-minute version check and the
   deck's three-minute one call /api/me without it and read exactly what they read before.
   Nothing on /api/upload, nothing on /api/call. A database without the zone column, a read
   that fails, or one that has not answered inside ZONE_BUDGET_MS answers "no zone": the name
   is drawn as it always was, and the sign-in is never kept waiting on its decoration. */
import { teamAllowed } from './auth.js';

const K = s => String(s == null ? '' : s).trim().toUpperCase();

/** The columns of Teams & Staff that hold a person's name. */
export const ZONE_ROLE_COLS = ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike', 'legal', 'collection'];
/** How many zones are written out beside a name before the rest are counted. */
export const ZONE_SHOWN = 2;
/** How long the sign-in waits for the zone before it answers without one. The read runs beside
    the sign-in's other reads, so this is a ceiling on a slow teams table, not a wait. */
export const ZONE_BUDGET_MS = 1500;
const ZONE_READ = ['team', 'zone'].concat(ZONE_ROLE_COLS).join(', ');

/** The distinct zones of some teams, as Teams & Staff spells them, in capitals and in order. */
export function zonesOfTeams(teamRows) {
  return [...new Set((teamRows || []).map(t => K(t && t.zone)).filter(Boolean))].sort();
}

/** The rule above, over rows already read. */
export function zonesOfUser(user, teamRows) {
  if (!user) return [];
  const rows = (teamRows || []).filter(t => t && teamAllowed(user, t.team));   // step 0: all of them for an all-teams code
  const me = user.teamCode ? '' : K(user.name);
  if (me) {
    const mine = zonesOfTeams(rows.filter(t => ZONE_ROLE_COLS.some(c => K(t[c]) === me)));
    if (mine.length) return mine;
  }
  return user.teams ? zonesOfTeams(rows) : [];
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
    const zones = zonesOfUser(user, res.data);
    return { zone: zoneLabel(zones), zones };
  } catch (e) {
    return none;
  } finally {
    clearTimeout(timer);
  }
}
