/* WHO IS AN ADVANCE APPROVER -- the one rule behind "the approval tab is for approvers".

     "I expect all credit don't see approval tab except the approver I chose" ... "It's not just
      credit but roles that have their own approver" ... "Behave so"

   Ticking the approval tab on a role was the only thing that showed it, so a stray tick -- or a
   department that approves itself -- showed it to every holder of the role whatever the routing
   said. The tab is now shown to the people the routing makes approvers, whatever is ticked:

     - the holder of a role that is the approver of ANOTHER role (every GMO, for the field officers);
     - the person named as the one supervisor of a whole role (roles.approver_code);
     - a person named as the supervisor of any code (access_codes.supervisor);
     - the holders of a role that approves ONLY ITSELF, when nobody is named for the role or any
       of its codes -- they decide each other's, and there is nobody else to.

   Everyone else -- a role that has its own approver, a role with none -- is not, and the tab is
   not drawn for them. ADMIN is not asked (it holds every tab). The server's own gate on the
   desk is unchanged; this only decides what the sidebar offers. A database without RUN-ME-045 /
   RUN-ME-046 (no approver columns) hides nothing: fall back, never fail. */
const K = s => String(s == null ? '' : s).trim().toUpperCase();

/** The rule, on rows already read: roleRows {role, approver_role, approver_code}, codeRows
    {code, role, supervisor} (at least every code that names a supervisor). */
export function isAdvApprover(roleRows, codeRows, user) {
  const role = K(user && user.role), code = K(user && user.code);
  for (const r of (roleRows || [])) {
    if (K(r.approver_role) === role && K(r.role) !== role) return true;     // approves another role, by role
    if (r.approver_code && K(r.approver_code) === code) return true;        // the one supervisor of a whole role
  }
  for (const c of (codeRows || [])) if (c.supervisor && K(c.supervisor) === code) return true;   // a code's own supervisor
  const mine = (roleRows || []).find(r => K(r.role) === role);
  if (mine && K(mine.approver_role) === role) {
    const named = !!mine.approver_code || (codeRows || []).some(c => c.supervisor && K(c.role) === role);
    return !named;                                                          // approving itself: only while nobody is named
  }
  return false;
}

/** `tabs` without the approval tab when this sign-in is not an approver. Two small reads, and
    only for somebody who holds the tab at all; any trouble leaves the tabs exactly as they are. */
export async function withoutIdleApprovalTab(db, user, tabs) {
  if (!Array.isArray(tabs) || !tabs.includes('advappr')) return tabs;
  try {
    const [roles, codes] = await Promise.all([
      db.from('roles').select('role, approver_role, approver_code'),
      db.from('access_codes').select('code, role, supervisor').not('supervisor', 'is', null),
    ]);
    if (roles.error || codes.error) return tabs;
    return isAdvApprover(roles.data || [], codes.data || [], user) ? tabs : tabs.filter(t => t !== 'advappr');
  } catch (e) {
    return tabs;
  }
}
