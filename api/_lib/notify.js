/** THE BELL — what has happened on my teams since I last looked.
 *
 * Complaints logged at the desk and follow-up comments left by officers, newest first, scoped
 * to the teams the reader may see. It exists because both of those are things somebody DID
 * that somebody else needs to know about, and neither had anywhere to appear.
 *
 * ONE IMPLEMENTATION, TWO DOORS. The portal reads it with an access code; HOPE Calls reads it
 * with a registered handset. They are the same question asked by different people, and a
 * second copy of it would drift -- the field would start seeing a different set of updates
 * from the office, and nobody would notice until the two were argued about in a meeting.
 *
 * It lives in its own file rather than in portal-core because call-core cannot import
 * portal-core: portal-core already imports call-core for the shared call report, and a cycle
 * between the two would break both.
 */

import { runQuery } from './supabase.js';
import { teamAllowed } from './auth.js';

const NOTIF_LIMIT = 60;

const scoped = (user, rows) => rows.filter(r => teamAllowed(user, r.team));

/** Team names are stored uppercase; a code's list is typed by a person and may not be. */
const upper = teams => [...new Set((teams || [])
  .map(t => String(t == null ? '' : t).trim().toUpperCase()).filter(Boolean))];

/** Where "I have read up to here" is remembered. Keyed on whoever is asking -- an access code
    for the portal, a handset's user id for the app -- so marking things read on one screen
    never silently marks them read for somebody else. */
export const notifKeyFor = who => 'NOTIF_SEEN_' + String(who || '').toUpperCase();

/** THE NEWEST SIXTY, ASKED FOR AS THE NEWEST SIXTY.
 *
 *  This read used to pull EVERY complaint and EVERY follow-up comment ever written, sort them
 *  here and keep sixty. Measured against a real book after the v1 comment history was imported:
 *  204,000 rows and 40 MB, to show a list of sixty -- and on the day it was put on the phones,
 *  to show a list of NONE, because the officer's team had none of them.
 *
 *  A bell is the least important thing on any screen and it was the most expensive. Now the
 *  database does the ordering and the limiting, and the team narrowing, which is what a
 *  database is for. Two small pages instead of two whole tables.
 *
 *  The unseen count is therefore "unseen among the newest sixty" rather than unseen in all of
 *  history. That is the honest thing for a badge to mean: nobody is going to read the four
 *  hundred and first, and the badge already caps its display at 9+.
 */
export async function notifCore(db, user, seenKey) {
  const teams = user && user.teams ? upper(user.teams) : null;
  const newest = (table, cols) => {
    let q = db.from(table).select(cols).order('created_at', { ascending: false }).limit(NOTIF_LIMIT);
    if (teams && teams.length) q = q.in('team', teams);
    return q;
  };
  const [compRes, cmtRes, seenRes] = await Promise.all([
    /* logged_by, not created_by -- that is the column complaints actually has, and asking for
       the other one failed the WHOLE read, which is what left the bell saying it could not
       load. The comment log does use created_by; the two tables simply name it differently. */
    runQuery(() => newest('complaints', 'id, ref, team, complainant, details, category, created_at, logged_by')),
    runQuery(() => newest('followup_comments', 'id, ref, team, full_name, comment, fu_status, created_at, created_by')),
    runQuery(() => db.from('settings').select('key, value').eq('key', seenKey)),
  ]);
  for (const r of [compRes, cmtRes, seenRes]) if (r.error) throw new Error(r.error.message || String(r.error));
  const comp = compRes.data || [], cmts = cmtRes.data || [], seenRows = seenRes.data || [];
  const seenAt = (seenRows[0] && seenRows[0].value) || '';

  /* scoped() still runs. It is the rule, and a narrowing that quietly stopped working must not
     become a way for one team to read another's customers -- but by now there is nothing left
     for it to drop. */
  const items = [
    ...scoped(user, comp).map(c => ({
      kind: 'complaint', id: 'c' + c.id, ref: c.ref, team: c.team,
      who: c.complainant || '', by: c.logged_by || '',
      what: String(c.details || c.category || 'Complaint').slice(0, 160),
      at: String(c.created_at || ''),
    })),
    ...scoped(user, cmts).map(c => ({
      kind: 'comment', id: 'f' + c.id, ref: c.ref, team: c.team,
      who: c.full_name || '', by: c.created_by || '',
      what: String(c.comment || c.fu_status || 'Follow-up').slice(0, 160),
      at: String(c.created_at || ''),
    })),
  ].filter(x => x.at)
    /* Two sorted lists merged into one. Each arrived newest-first; interleaving them needs one
       more sort, over a hundred and twenty rows rather than two hundred thousand. */
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, NOTIF_LIMIT)
    /* Anything at all when nothing has been read yet. A brand-new reader seeing sixty unread
       items is correct: they have read none of them. */
    .map(x => ({ ...x, unseen: !seenAt || x.at > seenAt }));

  return { items, unseen: items.filter(x => x.unseen).length, seenAt };
}

/** Marks everything currently visible as read, for THIS reader only. */
export async function notifSeenCore(db, seenKey, nowMs = Date.now()) {
  const at = new Date(nowMs).toISOString();
  const { error } = await db.from('settings').upsert({ key: seenKey, value: at }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return { seenAt: at };
}
