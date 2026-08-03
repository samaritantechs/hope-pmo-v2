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

import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';

const NOTIF_LIMIT = 60;

const scoped = (user, rows) => rows.filter(r => teamAllowed(user, r.team));

/** Where "I have read up to here" is remembered. Keyed on whoever is asking -- an access code
    for the portal, a handset's user id for the app -- so marking things read on one screen
    never silently marks them read for somebody else. */
export const notifKeyFor = who => 'NOTIF_SEEN_' + String(who || '').toUpperCase();

export async function notifCore(db, user, seenKey) {
  const [comp, cmts, seenRows] = await Promise.all([
    fetchAll(() => db.from('complaints').select('id, ref, team, complainant, details, category, created_at, created_by')),
    fetchAll(() => db.from('followup_comments').select('id, ref, team, full_name, comment, fu_status, created_at, created_by')),
    fetchAll(() => db.from('settings').select('key, value').eq('key', seenKey)),
  ]);
  const seenAt = (seenRows[0] && seenRows[0].value) || '';

  const items = [
    ...scoped(user, comp).map(c => ({
      kind: 'complaint', id: 'c' + c.id, ref: c.ref, team: c.team,
      who: c.complainant || '', by: c.created_by || '',
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
