/* tools/file-date-audit.mjs -- the parts of it that need no spreadsheet reader (docs/HANDOFF.md Part 90).

     "They might be in different orders per file so check starting with the defaulters one I sent" -- the owner, 16 Nov 2026

   The tool reads a file the owner sends and says which way round it writes its dates, and whether the system reads it
   right, judged by something that is not the order rule itself (the loan system's own 91-and-14-days pattern; the file's
   own Filters window). Reading the file needs SheetJS, which is not a dependency, so the command line is run by hand
   (the top of the tool says how); what it COUNTS is pinned here, on rows made up in this file. People are made up. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { kindOf, auditColumn, deckFit, windowFit } = await import('../tools/file-date-audit.mjs');
const { importDefaulters } = await import('../api/_lib/importers.js');
const text = v => ({ t: 's', v });

test('every kind of cell a date column holds is told apart', () => {
  assert.equal(kindOf(text('9/7/2026')), 'slash text');
  assert.equal(kindOf(text('9/7/2026 10:15:00')), 'slash text', 'a stamp with a clock is still a slash date');
  assert.equal(kindOf(text('2026-11-30')), 'ISO text');
  assert.equal(kindOf(text('No due date')), 'No due date');
  assert.equal(kindOf({ t: 'd', v: new Date(Date.UTC(2026, 8, 7)) }), 'real date cell', 'a real date cell is a date, not a text');
  assert.equal(kindOf({ t: 'n', v: 45176 }), 'number');
  assert.equal(kindOf({ t: 'z', v: '' }), 'blank');
  assert.equal(kindOf(text('see notes')), 'other text');
});

test('a column of slash dates says which way round it is written, and how much of it proves that', () => {
  const month = auditColumn(['9/7/2026', '11/16/2026', '5/5/2026', '12/1/2026'].map(text));
  assert.deepEqual([month.verdict, month.monthFirstOnly, month.dayFirstOnly, month.ambiguous], ['month-first', 1, 0, 3]);
  assert.equal(month.maxSecond, 16, 'the largest second part is a day: it can only be month-first');
  const day = auditColumn(['9/7/2026', '16/11/2026', '30/1/2026'].map(text));
  assert.deepEqual([day.verdict, day.dayFirstOnly, day.monthFirstOnly], ['day-first', 2, 0]);
  const none = auditColumn(['9/7/2026', '5/4/2026'].map(text));
  assert.match(none.verdict, /no evidence/, 'nothing in it can only be read one way: said, not guessed');
  assert.equal(auditColumn([text('2026-09-07'), text('No due date')]).verdict, 'no slash dates');
  assert.deepEqual(auditColumn([text('9/7/2026'), { t: 'd', v: new Date() }, { t: 'z', v: '' }]).kinds, { 'slash text': 1, 'real date cell': 1, blank: 1 });
});

/* The loan system's deck: every date a month-first TEXT, DUE DATE an ISO text. Disbursed 7 September 2026 (a Monday). */
const HEAD = ['REF#', 'FULLNAME', 'DISB DATE', 'EXPIRE DATE', 'CHRONIC DATE', 'DUE DATE', 'LAST TRANS DATE', 'STATUS', 'D.S', 'DAYS ELAPSED', 'TEAM'];
const deck = [HEAD,
  ['2200000001', 'A MADE UP', '9/7/2026', '12/7/2026', '12/21/2026', '2026-11-30', '11/11/2026', 'Defaulter', '8-9', 68, 'TEAM1'],
  ['2200000002', 'B MADE UP', '5/28/2026', '8/27/2026', '9/10/2026', 'No due date', '11/10/2026', 'Defaulter', '3-6', 171, 'TEAM1'],
  ['2200000003', 'C MADE UP', '10/9/2026', '1/8/2027', '1/22/2027', 'No due date', '11/9/2026', 'Defaulter', '5-6', 35, 'TEAM1']];
const META = { snapshotType: 'initial', weekday: 'MON', snapshotDate: '2026-11-16' };

test('a deck is judged by the loan system\'s own pattern: read right, every row fits; read with no order, the swapped ones do not', () => {
  const now = deckFit(importDefaulters(deck, META), '2026-11-16');
  assert.deepEqual(now, { rows: 3, expire91: 3, chronic14: 3, daysElapsed: 3, all: 3 });
  const before = deckFit(importDefaulters(deck, { ...META, dateOrder: { dayFirst: true } }), '2026-11-16');
  assert.equal(before.rows, 3);
  assert.ok(before.all < 3, 'read day-first, the loans with a swappable date do not fit the pattern (' + before.all + ' of 3 do)');
  assert.ok(before.expire91 < 3 && before.chronic14 < 3);
});

test('a loan whose pattern is broken (a restructured one) is counted as not fitting, not hidden', () => {
  const moved = [HEAD, ['2200000009', 'D MADE UP', '9/7/2026', '12/24/2026', '1/7/2027', 'No due date', '11/11/2026', 'Defaulter', '8-9', 68, 'TEAM1']];
  const f = deckFit(importDefaulters(moved, META), '2026-11-16');
  assert.deepEqual([f.rows, f.expire91, f.chronic14, f.all], [1, 0, 1, 0]);
});

test('a row whose DAYS ELAPSED disagrees with its disbursement date does not fit, even when its 91 and 14 days do', () => {
  // disbursed 7 September: seventy days before the deck's day, so DAYS ELAPSED must be 68 or 69 (or 70), never 5 and never 200
  const wrong = ['5', '200'].map((days, i) => ['22000001' + i, 'E MADE UP', '9/7/2026', '12/7/2026', '12/21/2026', 'No due date', '11/11/2026', 'Defaulter', '8-9', Number(days), 'TEAM1']);
  const f = deckFit(importDefaulters([HEAD, ...wrong], META), '2026-11-16');
  assert.deepEqual([f.rows, f.expire91, f.chronic14, f.daysElapsed, f.all], [2, 2, 2, 0, 0], 'the second witness is the one that tells a swapped date from a moved expiry');
});

test('a report\'s dates are judged by the window its own Filters sheet names, read each way round', () => {
  const w = windowFit(['9/28/2026', '9/30/2026', '10/1/2026', '', null], '2026-09-28', '2026-10-02');
  assert.deepEqual(w, { n: 3, monthFirst: 3, dayFirst: 0 }, 'read month-first they are all inside; read day-first 10/1 is the tenth of January and the rest are not dates');
  const dayFirst = windowFit(['28/9/2026', '30/9/2026', '1/10/2026'], '2026-09-28', '2026-10-02');
  assert.deepEqual([dayFirst.monthFirst, dayFirst.dayFirst], [1, 3].map((x, i) => (i === 0 ? dayFirst.monthFirst : x)), 'a day-first report is inside when read day-first');
  assert.equal(dayFirst.dayFirst, 3);
  assert.equal(windowFit(['2026-09-30'], '2026-09-28', '2026-10-02').monthFirst, 1, 'an ISO date is the same either way round');
});
