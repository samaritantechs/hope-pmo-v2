/* THE FORMATS A SPREADSHEET WRITES A DATE IN (handbook Part 95, matter 4 of the owner's dates order).

     "... different excels might come with different fomarts am not sure." -- the owner, 17 Nov 2026

   Until 17 Nov 2026 two forms were read (ISO, and a/b/yyyy) and every other form came back as NOTHING, in silence. They are read now, after
   the two old forms, in ONE place (`moreDateParts_`, parse.js) for the date reader and the stamp reader alike. What these tests hold:

     1. each new form reads as the date it is, by both readers, and the clock comes with the stamp;
     2. whatever the OLD readers read is read exactly as before: the old code is kept below as it was and the two are compared over tens of
        thousands of generated strings (the only difference allowed is a date that does not exist: the database refuses it, the stamp reader
        rolled it into the next month);
     3. a date that does not exist is not a date (31 February, 31 April, 29 February of a year that has none, month 0, day 0, year 0);
     4. nothing that is not a date becomes one: phones, accounts, amounts with or without decimals, five-digit numbers outside 2010 to 2040,
        eight-digit numbers that are no date, words, a month name that is no month;
     5. the order of a dotted date is decided by the same rule as a slash date, and the file's own evidence reads dotted dates too. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dateOrNull, stampOrNull, inferDayFirst, tightestSpanIsDayFirst, nearestToDayIsDayFirst, yearOf, validDate_ } from '../api/_lib/parse.js';

// ---- the readers as they were until 17 Nov 2026, kept as a yardstick ------------------------------------------------------------------
function oldDateOrNull(v, dayFirst) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || /^no\s+due\s+date$/i.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), year = yearOf(m[3]);
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else if (dayFirst === false) { month = a; day = b; }
    else { day = a; month = b; }
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}
function oldStampOrNull(v, dayFirst) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  if (!s) return null;
  let y, mo, d;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    y = +yearOf(m[3]);
    if (a > 12 && b <= 12) { d = a; mo = b; }
    else if (b > 12 && a <= 12) { mo = a; d = b; }
    else if (dayFirst === false) { mo = a; d = b; }
    else { d = a; mo = b; }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let hh = 0, mi = 0, ss = 0;
  const t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (t) {
    hh = +t[1]; mi = +t[2]; ss = t[3] ? +t[3] : 0;
    const ap = t[4] ? t[4].toUpperCase() : '';
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    if (hh > 23 || mi > 59 || ss > 59) { hh = 0; mi = 0; ss = 0; }
  }
  const p2 = n => String(n).padStart(2, '0');
  const when = new Date(`${y}-${p2(mo)}-${p2(d)}T${p2(hh)}:${p2(mi)}:${p2(ss)}+03:00`);
  return isNaN(when.getTime()) ? null : when.toISOString();
}
let seed = 20261117;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = a => a[int(0, a.length - 1)];
const p2 = n => String(n).padStart(2, '0');

// ---- 1. each new form --------------------------------------------------------------------------------------------------------------------
const NEW_FORMS = [
  ['09-Jul-2026', '2026-07-09'], ['9-Jul-26', '2026-07-09'], ['09/Jul/2026', '2026-07-09'], ['09 Jul 2026', '2026-07-09'], ['9 July 2026', '2026-07-09'], ['9th July 2026', '2026-07-09'],
  ['09 JULY 2026', '2026-07-09'], ['09-jul-2026', '2026-07-09'], ['9 Sept 2026', '2026-09-09'], ['9 Sep. 2026', '2026-09-09'], ['1 Feb 2024', '2024-02-01'],
  ['Jul 9, 2026', '2026-07-09'], ['July 9 2026', '2026-07-09'], ['July 9th, 2026', '2026-07-09'], ['Jul-09-2026', '2026-07-09'], ['Dec 31, 2026', '2026-12-31'],
  ['Thu, 09 Jul 2026', '2026-07-09'], ['Thursday 9 July 2026', '2026-07-09'], ['Thu 9-Jul-2026', '2026-07-09'],
  ['9 Julai 2026', '2026-07-09'], ['12 Agosti 2026', '2026-08-12'], ['3 Machi 2026', '2026-03-03'], ['5 Mei 2026', '2026-05-05'], ['28 Septemba 2026', '2026-09-28'],
  ['30 Oktoba 2026', '2026-10-30'], ['1 Desemba 2026', '2026-12-01'], ['Alhamisi, 9 Julai 2026', '2026-07-09'], ['2 Januari 2026', '2026-01-02'], ['2 Februari 2026', '2026-02-02'],
  ['4 Aprili 2026', '2026-04-04'], ['6 Juni 2026', '2026-06-06'], ['11 Novemba 2026', '2026-11-11'],
  ['09.07.2026', '2026-07-09'], ['23.07.2026', '2026-07-23'], ['9.7.26', '2026-07-09'], ['2026/07/09', '2026-07-09'], ['2026/7/9', '2026-07-09'], ['2026.07.09', '2026-07-09'],
  ['20260709', '2026-07-09'], ['19991231', '1999-12-31'],
  ['7/23/2026 14:03', '2026-07-23'], ['23/7/2026 2:03 PM', '2026-07-23'], ['09.07.2026 14:03:11', '2026-07-09'], ['9-Jul-2026 14:03', '2026-07-09'], ['2026/07/09 14:03', '2026-07-09'],
  ['Jul 9, 2026 2:03:11 PM', '2026-07-09'], ['24/09/2026 10:15', '2026-09-24'],
  ['46210', '2026-07-07'], ['46210.4375', '2026-07-07'], ['40179', '2010-01-01'], ['51501', '2040-12-31'], ['45000', '2023-03-15'],
];
test('every form nothing read before is read as the date it is, by the date reader', () => {
  for (const [text, want] of NEW_FORMS) assert.equal(dateOrNull(text), want, text);
});
test('and by the stamp reader, which also reads the clock (the wall clock of the office, East Africa time)', () => {
  const day = (iso) => iso.slice(0, 10);
  for (const [text, want] of NEW_FORMS) {
    const got = stampOrNull(text);
    assert.ok(got, text);
    // the stamp is the office clock as a UTC instant: for a text with no clock, midnight in East Africa is 21:00 UTC the day before
    const eat = new Date(Date.parse(got) + 3 * 3600 * 1000).toISOString();
    assert.equal(day(eat), want, text + ' -> ' + got);
  }
  assert.equal(stampOrNull('9-Jul-2026 14:03'), '2026-07-09T11:03:00.000Z');
  assert.equal(stampOrNull('Jul 9, 2026 2:03:11 PM'), '2026-07-09T11:03:11.000Z');
  assert.equal(stampOrNull('09.07.2026 14:03:11'), '2026-07-09T11:03:11.000Z');
  assert.equal(stampOrNull('2026/07/09 00:30'), '2026-07-08T21:30:00.000Z');
  assert.equal(stampOrNull('46210.4375'), '2026-07-07T07:30:00.000Z', 'the fraction of an Excel serial number is the clock: 0.4375 of a day is 10:30');
  assert.equal(stampOrNull('46210'), '2026-07-06T21:00:00.000Z');
});
test('the forms of a spreadsheet that carries a clock are read by their date part by the date reader, as the stamp reader always did', () => {
  assert.equal(dateOrNull('7/23/2026 14:03'), '2026-07-23');
  assert.equal(dateOrNull('23-7-2026 14:03:55'), '2026-07-23');
  assert.equal(dateOrNull('23/7/2026 2:03 pm'), '2026-07-23');
  assert.equal(dateOrNull('7/23/2026 something'), null, 'anything else after the date is still not a date');
});
test('a dotted date follows the same order rule as a slash date: a part over twelve decides, then the file, then day-first', () => {
  assert.equal(dateOrNull('23.07.2026'), '2026-07-23');
  assert.equal(dateOrNull('07.23.2026'), '2026-07-23');
  assert.equal(dateOrNull('06.07.2026'), '2026-07-06');                 // both <= 12, nothing said: day-first, as a slash date
  assert.equal(dateOrNull('06.07.2026', true), '2026-07-06');
  assert.equal(dateOrNull('06.07.2026', false), '2026-06-07');          // the file said month-first
  assert.equal(dateOrNull('6/7/2026 10:15', false), '2026-06-07');
});
test('the file\'s own evidence reads dotted dates too (one order per file)', () => {
  assert.equal(inferDayFirst(['23.07.2026', '24.07.2026']), true);
  assert.equal(inferDayFirst(['07.23.2026', '07.24.2026']), false);
  assert.equal(inferDayFirst(['06.07.2026']), null);
  assert.equal(tightestSpanIsDayFirst(['11.9.2026', '11.10.2026', '11.11.2026']), false, 'three days in November, not three months of the 11th');
  assert.equal(nearestToDayIsDayFirst(['11.10.2026', '11.10.2026'], '2026-11-10'), false, 'uploaded on the 10th of November: the 10th of November, month first');
  assert.equal(nearestToDayIsDayFirst(['11.10.2026', '11.10.2026'], '2026-10-11'), true, 'uploaded on the 11th of October: the 11th of October, day first');
  assert.equal(inferDayFirst(['2026/07/09', '09-Jul-2026']), null, 'a form with its own month says nothing about the order of the others');
});

// ---- 2. the old forms, read exactly as before ------------------------------------------------------------------------------------------------
function oldFormString() {
  const y = pick([() => String(int(1990, 2040)), () => p2(int(0, 99)), () => String(int(1000, 2999))])();
  const a = int(0, 35), b = int(0, 35);
  const sep = pick(['/', '-']);
  const form = pick(['iso', 'slash', 'slash', 'slash']);
  const base = form === 'iso' ? `${String(int(1990, 2040))}-${pick([String(int(0, 14)), p2(int(0, 14))])}-${pick([String(int(0, 35)), p2(int(0, 35))])}`
    : `${pick([String(a), p2(a)])}${sep}${pick([String(b), p2(b)])}${sep}${y}`;
  return base + pick(['', '', '', ' ', ' 14:03', ' 2:03 PM', 'T06:47:00Z', ' 0:00:00', ' junk', 'x']);
}
test('whatever the old readers read is read exactly as before: 60,000 generated old-form strings, the date reader and the stamp reader, both orders', () => {
  let read = 0, changed = 0;
  for (let i = 0; i < 60000; i++) {
    const x = oldFormString(), df = pick([undefined, true, false]);
    const od = oldDateOrNull(x, df), nd = dateOrNull(x, df);
    if (od !== null) {
      read++;
      const exists = validDate_(+od.slice(0, 4), +od.slice(5, 7), +od.slice(8, 10));
      assert.equal(nd, exists ? od : null, `date reader: ${JSON.stringify(x)} (dayFirst ${df}) was ${od}, is ${nd}`);
      if (!exists) changed++;
    }
    const os = oldStampOrNull(x, df), ns = stampOrNull(x, df);
    if (os !== null) {
      // the old stamp reader built its date from the same parts: it is read as before when the date exists; where it rolled over, the new one refuses
      const parts = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || null;
      let exists;
      if (parts) exists = validDate_(+parts[1], +parts[2], +parts[3]);
      else {
        const m = x.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        const a = +m[1], b = +m[2];
        let d, mo;
        if (a > 12 && b <= 12) { d = a; mo = b; } else if (b > 12 && a <= 12) { mo = a; d = b; } else if (df === false) { mo = a; d = b; } else { d = a; mo = b; }
        exists = validDate_(+yearOf(m[3]), mo, d);
      }
      assert.equal(ns, exists ? os : null, `stamp reader: ${JSON.stringify(x)} (dayFirst ${df}) was ${os}, is ${ns}`);
    }
  }
  assert.ok(read > 5000, 'the generator produced enough strings the old reader read: ' + read);
  assert.ok(changed > 50, 'and enough impossible calendar dates to see them refused: ' + changed);
});
test('and the old readers\' own examples (the tests that were there before) still hold', () => {
  assert.equal(dateOrNull('2026-07-23'), '2026-07-23');
  assert.equal(dateOrNull('2026-7-5'), '2026-07-05');
  assert.equal(dateOrNull('2026-07-23T06:47:00Z'), '2026-07-23');
  assert.equal(dateOrNull('7/23/2026'), '2026-07-23');
  assert.equal(dateOrNull('31/12/2026'), '2026-12-31');
  assert.equal(dateOrNull('5/7/2026'), '2026-07-05');
  assert.equal(dateOrNull('32/7/2026'), null);
  assert.equal(dateOrNull('No Due Date'), null);
  assert.equal(dateOrNull(''), null);
  assert.equal(dateOrNull(null), null);
  assert.equal(dateOrNull(0), null);
  assert.equal(stampOrNull('6/22/2026 11:29:05'), '2026-06-22T08:29:05.000Z');
  assert.equal(stampOrNull('24/09/2026 10:15', true), '2026-09-24T07:15:00.000Z');
  assert.equal(stampOrNull(new Date('2026-07-09T05:00:00Z')), '2026-07-09T05:00:00.000Z');
});

// ---- 3. a date that does not exist is not a date ---------------------------------------------------------------------------------------------
test('31 February, 31 April, 29 February of a year without one, month 0, day 0 and year 0 are not dates, for either reader and every form', () => {
  for (const x of ['31/02/2026', '2026-02-31', '2026-04-31', '30/02/2026', '29/02/2026', '29/02/2025', '2026-02-29', '31 Feb 2026', 'Feb 30, 2026', '31.04.2026', '2026/02/30', '20260231', '0/7/2026', '7/0/2026', '2026-00-10', '2026-10-00', '0000-01-01', '0/0/0000']) {
    assert.equal(dateOrNull(x), null, x);
    assert.equal(stampOrNull(x), null, x);
  }
  assert.equal(dateOrNull('29/02/2024'), '2024-02-29');
  assert.equal(dateOrNull('2024-02-29'), '2024-02-29');
  assert.equal(dateOrNull('29 Feb 2024'), '2024-02-29');
  assert.equal(dateOrNull('29/02/2000'), '2000-02-29', 'a year divisible by 400 is a leap year');
  assert.equal(dateOrNull('29/02/1900'), null, 'and one divisible by 100 but not by 400 is not');
  assert.equal(stampOrNull('31/02/2026 10:00'), null, 'the stamp reader used to say the third of March');
});

// ---- 4. nothing that is not a date becomes one ------------------------------------------------------------------------------------------------
test('phones, accounts, amounts, numbers out of range, words and a month that is no month are not dates', () => {
  for (const x of ['0712345678', '255712345678', '+255 712 345 678', '123456789', '10214592156', '2001072167122', '45000.00', '45000.5', '45,000', '1,234,567', '12345', '39999', '40178', '51502', '99999',
    '123456', '1234567', '30260709', '20261301', '20260132', '18990101', '46210.5', 'Mei', 'July', 'Jul 2026', 'abc', 'N/A', '-', '--', 'TBD', 'Septemberr 9 2026', '9 Foo 2026', 'Foo 9 2026', '9 Ju 2026', '9 Julyy 2026',
    '1.5', '1.5.2', '10.5', '3/6', '7-12', '7/12', '1/2/3', '12:30', '14:03', 'No Due Date']) {
    assert.equal(dateOrNull(x), null, JSON.stringify(x));
    assert.equal(stampOrNull(x), null, JSON.stringify(x));
  }
});
test('a number that is an Excel serial is a date only between 2010 and 2040: an amount in a misplaced column must not become a date', () => {
  assert.equal(dateOrNull(46210), '2026-07-07');
  assert.equal(dateOrNull('40179'), '2010-01-01');
  assert.equal(dateOrNull('40178'), null);
  assert.equal(dateOrNull('51501'), '2040-12-31');
  assert.equal(dateOrNull('51502'), null);
  assert.equal(dateOrNull(150000), null);
  assert.equal(dateOrNull('46210.4375'), '2026-07-07', 'a fraction of four digits or more is a clock');
  assert.equal(dateOrNull('46210.50'), null, 'a fraction of two digits is an amount');
});
test('every form round-trips: 20,000 generated dates written in every form read back as the same date', () => {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  for (let i = 0; i < 20000; i++) {
    const y = int(2015, 2035), mo = int(1, 12), d = int(1, 28), want = `${y}-${p2(mo)}-${p2(d)}`;
    const clock = pick(['', '', ' 14:03', ' 2:03:11 PM']);
    const texts = [
      `${p2(d)}-${MON[mo - 1]}-${y}${clock}`, `${d} ${FULL[mo - 1]} ${y}${clock}`, `${MON[mo - 1]} ${d}, ${y}${clock}`, `${FULL[mo - 1]} ${p2(d)} ${y}${clock}`,
      `${d} ${SW[mo - 1]} ${y}${clock}`, `${y}/${p2(mo)}/${p2(d)}${clock}`, `${y}.${mo}.${d}${clock}`, `${y}${p2(mo)}${p2(d)}`,
      d > 12 ? `${p2(d)}.${p2(mo)}.${y}${clock}` : `${p2(d)}.${p2(mo)}.${y}${clock}`,
    ];
    for (const t of texts) assert.equal(dateOrNull(t), want, t);
    // an unambiguous slash date with a clock
    if (d > 12) { assert.equal(dateOrNull(`${d}/${mo}/${y}${clock}`), want); assert.equal(dateOrNull(`${mo}/${d}/${y}${clock}`), want); }
  }
  // Excel serials of every day of 2010 to 2040 read back as the right day
  for (let n = 40179; n <= 51501; n++) {
    const want = new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
    assert.equal(dateOrNull(String(n)), want, String(n));
  }
});

// ---- 5. the pins: ONE place reads the forms, and both readers use it -------------------------------------------------------------------------
test('one place reads the new forms and both readers use it: no second copy of the month names, the clock or the serial window', () => {
  const src = readFileSync(new URL('../api/_lib/parse.js', import.meta.url), 'utf8');
  assert.equal((src.match(/function moreDateParts_\(/g) || []).length, 1);
  assert.equal((src.match(/moreDateParts_\(s, dayFirst\)/g) || []).length, 3, 'dateParts_ (the date reader) and stampOrNull call it, and the definition');
  assert.equal((src.match(/const MONTH_NAMES_ = /g) || []).length, 1);
  assert.equal((src.match(/dayMonthOf_\(/g) || []).length >= 4, true, 'the order of a pair is decided in one function, by the old forms and the new alike');
  assert.equal((src.match(/validDate_\(/g) || []).length >= 3, true);
  // nothing else under api/ reads a date: the readers in importers.js call these two and no other
  const imp = readFileSync(new URL('../api/_lib/importers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(imp, /Date\.parse\(|new Date\(\s*(?:String|v|x|s)\b/, 'importers.js reads no date of its own');
});

// ---- 6. through the importers: the forms reach every upload, and the company's own sheets read a date written with spaces whole ---------------
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const IMP = await import('../api/_lib/importers.js');

test('a defaulters deck whose dates are written with month names is read, every date column of it (it used to store every one of them empty)', () => {
  const H = ['REF#', 'FULLNAME', 'DISB DATE', 'EXPIRE DATE', 'CHRONIC DATE', 'DUE DATE', 'LAST TRANS DATE', 'DAYS ELAPSED', 'TEAM'];
  const rows = [H, ['2-209-72865', 'A MADE UP', '09-Jul-2026', '8 Oct 2026', 'Oct 22, 2026', '2026.09.03', '31/Jul/2026', '31', 'GOBA'],
    ['2-209-72866', 'B MADE UP', '20260709', '20261008', '46317', '03.09.2026', '31.07.2026 14:03', '31', 'GOBA']];
  const [a, b] = IMP.importDefaulters(rows, { snapshotType: 'current', weekday: 'MON', snapshotDate: '2026-11-16' });
  assert.deepEqual([a.disb_date, a.expire_date, a.chronic_date, a.due_date, a.last_trans_date], ['2026-07-09', '2026-10-08', '2026-10-22', '2026-09-03', '2026-07-31']);
  assert.deepEqual([b.disb_date, b.expire_date, b.chronic_date, b.due_date, b.last_trans_date], ['2026-07-09', '2026-10-08', '2026-10-22', '2026-09-03', '2026-07-31']);
});
test('a payments file in month names is read and its order is not asked (a name decides the month)', () => {
  const H = ['PAYMENT DATE', 'REF NO', 'AMOUNT'];
  const out = IMP.importReceivedPayments([H, ['09-Jul-2026', '2-209-72865', '1000'], ['Jul 10, 2026', '2-209-72866', '2000'], ['11 Julai 2026', '2-209-72867', '3000']]);
  assert.deepEqual(out.map(r => r.paid_at), ['2026-07-09', '2026-07-10', '2026-07-11']);
});
test('the company\'s own sheets read a date written with spaces whole: a complaint, a restructure, a notice', () => {
  const H = ['TIMESTAMP', 'REF#', 'TEAM', 'COMPLAINANT', 'PHONE', 'CATEGORY', 'CHANNEL', 'DETAILS', 'STATUS', 'RESOLUTION', 'BY', 'RESOLVED BY', 'RESOLVED AT'];
  const row = (stamp, resolved, n) => [stamp, '22000000' + n, 'TEAM1', 'A MADE UP', '0700000000', 'Service', 'Phone', 'made up', 'Resolved', 'made up', 'OFFICER', 'OFFICER', resolved];
  const out = IMP.importComplaints([H, row('9 July 2026', 'Jul 10, 2026', 1), row('Thu, 09 Jul 2026 14:03', '10.07.2026', 2), row('9 July 2026 14:03', '', 3)]);
  assert.deepEqual(out.map(r => [r.created_at, r.resolved_at]), [['2026-07-09', '2026-07-10'], ['2026-07-09', '2026-07-10'], ['2026-07-09', null]]);
  const n = IMP.importDemandNotices([['REF#', 'TEAM', 'FULLNAME', 'NOTICE DATE', 'TOTAL DEMAND', 'BY'], ['2-209-72865', 'GOBA', 'A MADE UP', '9 July 2026', '100000', 'OFFICER']]);
  assert.equal(n[0].notice_date, '2026-07-09');
});
test('a cell the old company importers cut at its first space is still cut there: a clock, and anything that is not a date by itself', () => {
  const H = ['TIMESTAMP', 'REF#', 'TEAM', 'COMPLAINANT', 'PHONE', 'CATEGORY', 'CHANNEL', 'DETAILS', 'STATUS', 'RESOLUTION', 'BY', 'RESOLVED BY', 'RESOLVED AT'];
  const row = (stamp, resolved) => [stamp, '220000001', 'TEAM1', 'A MADE UP', '0700000000', 'Service', 'Phone', 'made up', 'Resolved', 'made up', 'OFFICER', 'OFFICER', resolved];
  const out = IMP.importComplaints([H, row('24/09/2026 10:15:00', '25/09/2026 (Friday)'), row('2026-09-07T10:15:00', '2026-09-08 at noon')]);
  assert.deepEqual(out.map(r => [r.created_at, r.resolved_at]), [['2026-09-24', '2026-09-25'], ['2026-09-07', '2026-09-08']]);
});
