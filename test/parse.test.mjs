// Date parsing is where silent data loss lived: the browser upload path used to render
// Excel dates as m/d/yyyy while the parser read d/m/yyyy, so 23 July was refused outright
// ("month 23") and 5 July quietly became 7 May. These lock the fixed behaviour in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOrNull, timeOrNull, dsText, num, normPhone, normTeam } from '../api/_lib/parse.js';

test('ISO dates are taken as-is', () => {
  assert.equal(dateOrNull('2026-07-23'), '2026-07-23');
  assert.equal(dateOrNull('2026-7-5'), '2026-07-05');
  assert.equal(dateOrNull('2026-07-23T06:47:00Z'), '2026-07-23');
});

test('an impossible month proves the order -- neither day is guessed away', () => {
  assert.equal(dateOrNull('7/23/2026'), '2026-07-23');     // m/d: 23 cannot be a month
  assert.equal(dateOrNull('23/7/2026'), '2026-07-23');     // d/m: same date, other order
  assert.equal(dateOrNull('12/31/2026'), '2026-12-31');
  assert.equal(dateOrNull('31/12/2026'), '2026-12-31');
});

test('genuinely ambiguous slash dates follow the sheets own d/m convention', () => {
  assert.equal(dateOrNull('5/7/2026'), '2026-07-05');      // 5 July, not 7 May
  assert.equal(dateOrNull('01/02/2026'), '2026-02-01');
});

test('nonsense is refused rather than guessed', () => {
  assert.equal(dateOrNull('32/7/2026'), null);
  assert.equal(dateOrNull('7/32/2026'), null);
  assert.equal(dateOrNull('No Due Date'), null);
  assert.equal(dateOrNull(''), null);
  assert.equal(dateOrNull(null), null);
});

test('times survive the epoch-day a time-only cell arrives on', () => {
  assert.equal(timeOrNull('1899-12-30 06:47'), '06:47');   // XLSX renders a bare time this way
  assert.equal(timeOrNull('06:47'), '06:47');
  assert.equal(timeOrNull('6:47'), '06:47');
  assert.equal(timeOrNull('25:00'), null);
  assert.equal(timeOrNull(''), null);
});

test('D.S stays paid/target text, never a date', () => {
  assert.equal(dsText('3/6'), '3/6');
  assert.equal(dsText('7-12'), '7-12');
});

test('numbers, phones and teams normalise the way the rest of the system expects', () => {
  assert.equal(num('1,234.50'), 1234.5);
  assert.equal(num(''), null);                             // an empty cell is unknown, NOT zero
  assert.equal(num('-'), null);
  assert.equal(normPhone('+255 712 345 678'), '712345678'); // country code and leading 0 stripped
  assert.equal(normPhone('0712345678'), '712345678');       // so both spellings match each other
  assert.equal(normTeam('  kongowe '), 'KONGOWE');
});
