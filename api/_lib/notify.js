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
/* `nowMs` is injected like every other core function in this system. It used to read the real
   clock for the promise window, which made the bell the one thing that could not be tested at a
   pinned time -- and a notification about a DATE is exactly the thing worth testing at a pinned
   time. */
export async function notifCore(db, user, seenKey, nowMs = Date.now()) {
  const teams = user && user.teams ? upper(user.teams) : null;
  const newest = (table, cols) => {
    let q = db.from(table).select(cols).order('created_at', { ascending: false }).limit(NOTIF_LIMIT);
    if (teams && teams.length) q = q.in('team', teams);
    return q;
  };
  /* PROMISES THAT HAVE COME DUE.
     "Ameweka ahadi should also pop into notification when their date reaches"

     A promise is the one thing in this system with a date attached that nobody is told about.
     It was logged days ago, it sits in the Promise to Pay tab, and unless somebody opens that
     tab on the right morning it passes silently -- which is exactly the day it was worth
     acting on.

     TODAY AND THE DAYS JUST BEHIND IT, not today alone: a promise that came due on Saturday
     has to still be on the bell on Monday, and one nobody chased on Tuesday is more urgent on
     Wednesday, not less. Bounded at a week so the bell stays a list of what is live rather
     than a graveyard.

     A promise whose customer has since cleared is dropped -- they paid, which is the outcome
     the promise existed for, and telling somebody to chase it would be worse than saying
     nothing. */
  const todayKey = new Date(nowMs + 3 * 3600 * 1000).toISOString().slice(0, 10);   // EAT
  const weekBack = new Date(nowMs + 3 * 3600 * 1000 - 7 * 86400000).toISOString().slice(0, 10);
  const promiseQ = () => {
    let q = db.from('followup_status')
      .select('ref, team, full_name, contact, arrears, promise_date, promise_amt, fu_status, comment_by')
      .gte('promise_date', weekBack).lte('promise_date', todayKey)
      .order('promise_date', { ascending: false }).limit(NOTIF_LIMIT);
    if (teams && teams.length) q = q.in('team', teams);
    return q;
  };
  const [compRes, cmtRes, promRes, seenRes] = await Promise.all([
    /* logged_by, not created_by -- that is the column complaints actually has, and asking for
       the other one failed the WHOLE read, which is what left the bell saying it could not
       load. The comment log does use created_by; the two tables simply name it differently. */
    runQuery(() => newest('complaints', 'id, ref, team, complainant, details, category, created_at, logged_by')),
    runQuery(() => newest('followup_comments', 'id, ref, team, full_name, comment, fu_status, created_at, created_by')),
    runQuery(promiseQ),
    runQuery(() => db.from('settings').select('key, value').eq('key', seenKey)),
  ]);
  for (const r of [compRes, cmtRes, seenRes]) if (r.error) throw new Error(r.error.message || String(r.error));
  /* The promise read is allowed to fail quietly. It is an addition to the bell, and a bell that
     stops showing complaints and comments because one extra query was refused is a worse bell
     than one without promises in it. */
  const comp = compRes.data || [], cmts = cmtRes.data || [], seenRows = seenRes.data || [];
  const proms = (promRes && !promRes.error && promRes.data) ? promRes.data : [];
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
    ...scoped(user, proms)
      .filter(p => p.promise_date && Number(p.arrears || 0) > 0)
      .map(p => {
        const due = String(p.promise_date).slice(0, 10);
        const late = due < todayKey;
        return {
          kind: 'promise', id: 'p' + p.ref + due, ref: p.ref, team: p.team,
          who: p.full_name || '', by: p.comment_by || '',
          what: (late ? 'Ahadi imepita / promise overdue' : 'Ahadi ya leo / promise due today')
            + (Number(p.promise_amt || 0) > 0 ? ' \u00B7 TZS ' + Math.round(Number(p.promise_amt)) : '')
            + ' \u00B7 ' + due,
          /* Stamped at the START of the due day rather than when the promise was written, so it
             surfaces on the morning it matters -- a promise made a fortnight ago would
             otherwise arrive already buried under everything logged since. */
          at: due + 'T06:00:00.000Z',
          due, late,
        };
      }),
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
