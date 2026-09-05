/** THE SAME QUESTION, ASKED ONCE.

    Two answers in this system cost more than everything else put together: the dashboard and
    the officer boards. Both are pure sums over a whole week of snapshots, both are the first
    thing anybody opens, and the figures behind them only move when somebody uploads a report --
    a few times a day. The Presentation deck asks for BOTH before it can draw a single slide,
    which is why it was the slowest screen in the system.

    So an answer is kept for a minute, per set of teams. The first person through pays for it;
    everyone else on the same teams, and the same person moving away and back, gets it at once.

    ONE MINUTE IS THE PROMISE, and it is deliberately short: an upload made on another server
    cannot reach in here to clear this, so a minute is the longest anybody waits to see their
    own upload reflected. Long enough to be worth having, short enough that nobody is left
    wondering whether the file went in.

    Held in the running process, which the platform reuses between requests and may discard at
    any moment. An empty cache just means doing the work -- which is what used to happen every
    single time. */

import { upperTeams } from './snapshots.js';
import { todayKey } from './time.js';

export const ANSWER_TTL_MS = 60000;

/* Kept against the DATABASE CLIENT, not in a single shared map. In production there is one
   long-lived client, so this behaves exactly as one map would. In a test there is a fresh fake
   per case -- and a shared map would have handed one test's figures to the next, which is a
   test suite that passes while the system is wrong. Weak, so a discarded client takes its
   cache with it. */
const caches = new WeakMap();

function bucketFor(db) {
  let m = caches.get(db);
  if (!m) { m = new Map(); caches.set(db, m); }
  return m;
}

/** The teams a person may see, plus the date -- everything that changes the answer. Somebody
    who sees everything gets 'ALL'; two officers on the same one team share a single answer.
    The date is in the key so an answer cannot survive midnight. */
export function scopeKey(user, nowMs) {
  const teams = (user && user.teams) ? upperTeams(user.teams).slice().sort().join(',') : 'ALL';
  return teams + '|' + todayKey(nowMs);
}

/* AND A WRITE THAT CHANGES THE ANSWER DROPS IT AT ONCE.
   =====================================================================================
   A minute is the right promise for an UPLOAD -- it lands on another server and cannot reach
   in here anyway, so a minute is the floor. It is the wrong promise for a person who has just
   typed something into THIS server and pressed Save: an admin who sets the commission payout
   note and is told "saved", then reads the same screen and sees the old note, has no way to
   tell a working system from a broken one. The same rule `settings` and `teams` already follow
   (noteSettingsWritten, noteTeamsWritten): remembered for the crowd, dropped for the author.

   The whole bucket goes, not one key. These answers overlap -- the commission board reads the
   rates, the weekly report stamps the records the history tab reads -- and working out exactly
   which of them a given write touches is the kind of bookkeeping that is right on the day it
   is written and wrong six months later. Throwing the lot away costs one recomputation on one
   request and cannot be subtly wrong. */
export function noteAnswersChanged(db) { if (db) caches.delete(db); }

/** Run `compute` unless the same question was already answered within the last minute.
    `name` separates one kind of answer from another in the shared map. */
export async function cachedAnswer(db, name, user, nowMs, compute) {
  const bucket = bucketFor(db);
  const key = name + '::' + scopeKey(user, nowMs);
  const hit = bucket.get(key);
  // hit.at <= nowMs guards a clock that jumps backwards, which would otherwise make a stale
  // answer look brand new for as long as the clock stayed behind.
  if (hit && hit.value !== undefined && hit.at <= nowMs && (nowMs - hit.at) < ANSWER_TTL_MS) return hit.value;
  /* THE QUESTION IN FLIGHT IS SHARED TOO.

       "Seva haijibu ndani ya sekunde 45" -- and then again, and again, as people pressed the
       tab.

     Only a FINISHED answer was remembered, so on a slow morning every retry of the dashboard
     started a second full computation beside the first -- a dozen reads each -- against a
     database that was already the reason for the retry. The pile-up is the storm. Now the
     pending computation itself is handed to everyone who asks the same question while it
     runs: one computation per scope, however many people press the tab. A computation that
     fails is forgotten at once, so the next press asks afresh. */
  if (hit && hit.pending) return hit.pending;
  const pending = compute().then(value => {
    bucket.set(key, { at: nowMs, value });
    return value;
  }, e => {
    if (bucket.get(key) && bucket.get(key).pending === pending) bucket.delete(key);
    throw e;
  });
  bucket.set(key, { at: nowMs, pending });
  return pending;
}
