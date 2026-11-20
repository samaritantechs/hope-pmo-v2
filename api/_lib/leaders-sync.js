import { looseSame, canonNames, wordsOf, cleanName } from './holders.js';

/* =======================================================================================
   THE ACCESS CODES HOLD THE LATEST LEADER OF EACH TEAM, AND TEAMS & STAFF FOLLOWS THEM.

     "The access codes hold the latest staff / leader per team, so unless not there, will be set
      at teams and staff but teams and staff (Wafanyakazi / Staff -- by person and its Orodha /
      List of team's leaders) must always update the leaders as from settings (Misimbo ya
      kuingia / Access codes)" ... "and that should affect all the current teams and staff nav
      data right away" -- the owner, 20 Nov 2026

   Who leads a team is written down twice: on an ACCESS CODE (a person, a role, the teams they
   hold: what the owner keeps current, "the teams i set in access codes are the ones correct")
   and in the teams table's role columns (the GMO of KONGOWE: what the rotation, the phone, the
   commission boards and every Teams & Staff screen read). saveAccessCode has always carried the
   ONE code just saved across to the sheet. Nothing carried all of them, so every code edited by
   any other road, and every code saved before that rule existed, left the two registers saying
   different things.

   THIS IS THE PLAN, PURE: given the sheet as stored and the codes, it says which cells of the
   sheet the codes change, which they leave alone and why, and which they cannot decide. Nothing
   here reads or writes a database.

   THE RULES, and each one stops a specific accident:

   1. A CELL NO CODE NAMES KEEPS WHAT TEAMS & STAFF SAYS. "Unless not there". A code never
      clears anybody: a person dropped from a code is taken off by saveAccessCode at the moment
      the code is saved (it knows who the code used to be), never by a sweep that cannot.

   2. A CODE NAMES A CELL WHEN IT HOLDS THE TEAM EXPLICITLY AND ITS ROLE IS A COLUMN. A code with
      no team list means every team and is nobody's portfolio: writing it through would make one
      person the GMO of every team. A role that is not a column (ADMIN, MANAGEMENT ...) names
      nothing, and is counted so it can be told.

   3. TWO PEOPLE ON ONE CELL IS NOT DECIDED. When two codes of one role hold the same team and
      name different people, nothing is written and the cell is reported: which of them is the
      leader is a person's to say, and a rule that picks is a guess ("a rule that has to choose is
      a guess"). The same person under two spellings is ONE claimant (holders.js looseSame and
      canonNames: the rule the history of who held what already uses), and two different people
      who share a first name are never merged.

   4. THE SAME PERSON IS NOT RE-SPELT SHORTER. A code that says MARY where the sheet says MARY
      SAMPLE names the same person: the sheet's fuller spelling stays and the cell is reported as
      kept, so the owner can make the code's name the full one. A code that spells the person
      fuller than the sheet upgrades the sheet's spelling.

   5. A NEW PERSON DOES NOT INHERIT THE LAST ONE'S NUMBER. A cell that changes hands carries the
      previous leader's phone number and staff ID beside it, and an SMS or a call sent there
      reaches the wrong person. The new leader's number and ID are the ones that same person
      already has beside that role on another team, and otherwise nothing: the screen shows a
      missing number in red, which is true. A cell whose person is the same keeps its number.

   6. ONLY COLUMNS THE BOOK HAS ARE WRITTEN. The phone and ID columns arrived by migrations run by
      hand: a column that no row carries is not sent, or the whole write would fail.

   7. THE PLAN DOES NOT DEPEND ON THE ORDER OF THE CODES. It is made over a sorted copy, so the
      same book gives the same plan however the database happened to return its rows.

   No access code is ever put in the plan: a code is a password, and the plan goes to a screen.
   ======================================================================================= */

const K = s => String(s == null ? '' : s).trim().toUpperCase();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** @param {object} a
 *  @param {object[]} a.teams     the teams table AS STORED (never the overlay)
 *  @param {object[]} a.codes     access codes: { name, role, teams } (the code itself is not read)
 *  @param {string[]} a.cols      the role columns a code may name, in the order the screen shows them
 *  @param {(role:string)=>string|null} a.colOf  which column a role names, or null (ONE definition, the caller's)
 *  @param {object} [a.phoneOf]   column -> its phone column
 *  @param {object} [a.idOf]      column -> its staff-ID column (or null)
 *  @param {(team:string)=>boolean} [a.allowed]  the teams the caller may change */
export function planLeaderSync({ teams, codes, cols, colOf, phoneOf = {}, idOf = {}, allowed = () => true }) {
  const rows = (teams || []).filter(t => t && t.team && allowed(t.team))
    .slice().sort((a, b) => K(a.team).localeCompare(K(b.team)));
  const present = col => rows.some(t => has(t, col));

  // ---- what the codes claim ------------------------------------------------------------
  const claims = new Map();               // K(team) + '|' + col -> [names]
  const people = [];                      // who the codes name, for the "off their code" note
  const unmapped = new Map();             // role -> how many codes with a team list name no column
  let allTeamsCodes = 0;
  const ordered = (codes || []).filter(c => c && cleanName(c.name))
    .slice().sort((a, b) => K(a.name).localeCompare(K(b.name)) || K(a.role).localeCompare(K(b.role)));
  for (const c of ordered) {
    const name = cleanName(c.name);
    const col = colOf(c.role);
    const list = [...new Set((Array.isArray(c.teams) ? c.teams : []).map(K).filter(Boolean))];
    if (!list.length) { if (col) allTeamsCodes++; continue; }               // rule 2: every team is nobody's portfolio
    if (!col) { const r = K(c.role) || '(no role)'; unmapped.set(r, (unmapped.get(r) || 0) + 1); continue; }
    people.push({ name, col, teams: new Set(list) });
    for (const t of list) {
      const k = t + '|' + col;
      if (!claims.has(k)) claims.set(k, []);
      claims.get(k).push(name);
    }
  }

  // ---- the same person's number and staff ID elsewhere on the sheet ------------------------
  const sameOf = (col, name) => {
    const no = phoneOf[col], id = idOf[col];
    for (const t of rows) {
      const holder = cleanName(t[col]);
      if (!holder || !looseSame(holder, name)) continue;
      const n = no && has(t, no) && String(t[no] == null ? '' : t[no]).trim() ? t[no] : null;
      const i = id && has(t, id) && String(t[id] == null ? '' : t[id]).trim() ? t[id] : null;
      if (n || i) return { no: n, id: i };
    }
    return null;
  };

  // ---- the cells -------------------------------------------------------------------------
  const changes = [], kept = [], conflicts = [];
  const nowAt = new Map();                // K(team) + '|' + col -> the name the cell will hold
  for (const t of rows) {
    for (const col of cols) {
      if (!present(col)) continue;                                           // rule 6
      const named = claims.get(K(t.team) + '|' + col);
      if (!named || !named.length) continue;                                 // rule 1
      const folded = canonNames([...new Set(named)]);
      const distinct = [...new Map([...folded.values()].map(n => [K(n), n])).values()];
      if (distinct.length > 1) {                                             // rule 3
        conflicts.push({ team: t.team, col, names: distinct.map(String).sort() });
        continue;
      }
      const now = distinct[0];
      const was = cleanName(t[col]);
      let why;
      if (!was) why = 'filled';
      else if (K(was) === K(now)) continue;                                  // the same name, case and blanks aside
      else if (looseSame(was, now)) {
        if (wordsOf(now).length > wordsOf(was).length) why = 'fuller';       // rule 4: the code spells it out
        else { kept.push({ team: t.team, col, sheet: was, code: now }); continue; }
      } else why = 'replaced';
      const patch = { [col]: now };
      const no = phoneOf[col], id = idOf[col];
      if (why !== 'fuller') {                                                // rule 5
        const same = sameOf(col, now);
        if (no && has(t, no)) patch[no] = same && same.no ? same.no : null;
        if (id && has(t, id)) patch[id] = same && same.id ? same.id : null;
      }
      const was_ = { [col]: t[col] == null ? null : t[col] };
      if (no && has(t, no) && has(patch, no)) was_[no] = t[no] == null ? null : t[no];
      if (id && has(t, id) && has(patch, id)) was_[id] = t[id] == null ? null : t[id];
      changes.push({ team: t.team, col, was: was || null, now, why, patch, undo: was_ });
      nowAt.set(K(t.team) + '|' + col, now);
    }
  }

  // ---- told, not changed: people whose own code does not hold teams the sheet gives them --------
  const offBy = new Map();
  for (const p of people) {
    for (const t of rows) {
      if (!present(p.col) || p.teams.has(K(t.team))) continue;
      const holder = nowAt.has(K(t.team) + '|' + p.col) ? nowAt.get(K(t.team) + '|' + p.col) : cleanName(t[p.col]);
      if (!holder || !looseSame(holder, p.name)) continue;
      const k = K(p.name) + '|' + p.col;
      if (!offBy.has(k)) offBy.set(k, { name: p.name, col: p.col, teams: [] });
      offBy.get(k).teams.push(t.team);
    }
  }
  const offCode = [...offBy.values()].map(o => ({ ...o, teams: o.teams.sort() }))
    .sort((a, b) => (a.col + a.name).localeCompare(b.col + b.name));

  return {
    changes, kept, conflicts, offCode, allTeamsCodes,
    unmapped: [...unmapped.entries()].map(([role, n]) => ({ role, codes: n })).sort((a, b) => a.role.localeCompare(b.role)),
  };
}

/** The writes a plan makes, GROUPED BY THE SET OF COLUMNS EACH ONE CARRIES. A batch of rows with
    different keys sent to PostgREST as one upsert gives every row the keys it lacks as NULL, which
    on a conflict BLANKS them: the GMO's row of a team whose manager changed would lose its GMO.
    Rows with the same keys are safe together, so each group is one statement. */
export function groupPatches(changes, stamp) {
  const byTeam = new Map();
  for (const c of changes) {
    if (!byTeam.has(c.team)) byTeam.set(c.team, { team: c.team });
    Object.assign(byTeam.get(c.team), c.patch);
  }
  const groups = new Map();
  for (const row of byTeam.values()) {
    if (stamp) row.updated_at = stamp;
    const sig = Object.keys(row).sort().join(',');
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(row);
  }
  return [...groups.values()];
}
