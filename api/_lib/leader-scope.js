import { teamAllowed } from './auth.js';

/* =======================================================================================
   A RECYCLING LEADER'S OWN BOOK, AND THE TEAMS THEIR OWN CODE CANNOT SEE.

     "There were also some lalamentions that gmo or opm is seeing expected defaulters of gmo or
      manager where that manager in their code ain't seeing them, they getting just a little like
      two yet a Manager's gmo sees the manager has many or opm sees o has many so make sure the
      distribution is okay" -- the owner, 16 Nov 2026

   THE DISTRIBUTION ITSELF IS ONE RULE AND IT IS NOT WHAT DIFFERS. Who a defaulter is handed to
   is assignFor (the clock) read through the teams sheet's gmo / manager / bike columns, in one
   place (buildRows_, expdf.js), for the phone, the portal's lists and the report alike. Where a
   GMO's report says a manager holds thirty customers and the manager's own list says two, the
   same thirty customers are in both reads: what differs is WHO IS READING.

     the report is read with the GMO's / OPM's code, which holds the whole zone;
     the manager's own list is read with the MANAGER'S code, which holds what the owner typed
     on it -- and "the teams i set in access codes are the ones correct": the code decides what
     a person sees and the sheet never widens it (call-core.js scopeFor, portal-core.js
     overlayCodes_). The teams sheet and the code are two registers typed by two hands, and they
     drift: a manager is moved on the sheet and his code is not touched, or the other way round.

   That rule is the owner's and is NOT changed here. What was wrong is the silence: the report
   credited a manager with customers his own screen could not show, and neither screen said so.
   "Say what was not done" -- so each of them now does:

     * the leader's own screen names the teams the sheet gives them that their code does not hold;
     * the report marks a leader whose own access code does not hold teams of the book credited
       to them, so the GMO or OPM looking at it knows WHY the manager sees less and WHO to fix;
     * db/RUN-ME-059 lists every such person from the live book in one read-only query.

   No read is added anywhere: the teams sheet is already read by every one of these screens, and
   the access codes' names are already read by the report's week-work step (weekWork) -- one more
   column of the same read. Nothing here runs on /api/upload, and on /api/call it is arithmetic
   over rows the Exp.Def list already holds.
   ======================================================================================= */

const K = s => String(s == null ? '' : s).trim().toUpperCase();

/** A PERSON'S NAME AS IT IS COMPARED from one register to the next: trimmed, in capitals, runs of
    blanks as one -- the way normTeam files a team and zone.js compares a GMO. 'MARY  M' on one
    team and 'MARY M' on another are one leader, not two rows of a report, and a manager whose
    code says 'MARY M' finds their own list under either. (A name that differs in a WORD is not
    this function's business: that is two spellings of a person, which only a person can settle.) */
export function leaderKey(s) { return K(s).replace(/\s+/g, ' '); }

/** The teams on which Teams & Staff names this person as the GMO, the MANAGER or the BIKE
    officer, and which their own access code does not hold -- the customers the rotation hands
    them there that their own screen will never show. `user.teams` null is every team (nothing is
    outside it); a team-code user holds one team and is not a leader of record; a name that no
    team carries has no book to lose. Pure: the caller hands it the teams it has already read. */
export function teamsOutsideScope(user, teamRows) {
  if (!user || !user.teams || user.teamCode) return [];
  const me = leaderKey(user.name);
  if (!me) return [];
  const out = [];
  const seen = new Set();
  for (const t of teamRows || []) {
    if (!t || !t.team || seen.has(K(t.team))) continue;
    if (teamAllowed(user, t.team)) continue;
    if (['gmo', 'manager', 'bike'].some(c => leaderKey(t[c]) === me)) { seen.add(K(t.team)); out.push(String(t.team)); }
  }
  return out.sort();
}

/** Of the teams a leader's book is made of, the ones their own access code does not hold.
    `codeTeams` is the code's list as stored: null / empty is every team (nothing is outside it),
    and `undefined` is "no single code carries this name" -- nothing can be said, so nothing is. */
export function codeGapOf(codeTeams, bookTeams) {
  if (codeTeams === undefined || codeTeams === null || !Array.isArray(codeTeams) || !codeTeams.length) return [];
  const held = new Set(codeTeams.map(K));
  const out = [], seen = new Set();
  for (const t of bookTeams || []) {
    const k = K(t);
    if (!k || held.has(k) || seen.has(k)) continue;
    seen.add(k); out.push(String(t));
  }
  return out.sort();
}
