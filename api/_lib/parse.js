// Shared CSV -> typed-value helpers for the migration.
//
// A few of these exist specifically BECAUSE of bugs that cost real time in the Sheets
// version -- documented inline so nobody "fixes" them back to the naive version later.

/** Row objects from csv-parse keep whatever header text was in row 1. Sheets exports
    sometimes have trailing spaces or slightly different casing across tabs that are
    "the same" column -- this matches by normalized name so a migration doesn't silently
    drop a column just because one tab's header has a trailing space and another doesn't. */
export function normalizeHeader(h) {
  return String(h || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export function col(row, headerMap, ...candidates) {
  for (const c of candidates) {
    const key = headerMap[normalizeHeader(c)];
    if (key !== undefined && row[key] !== undefined && row[key] !== '') return row[key];
  }
  return null;
}

export function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => { map[normalizeHeader(h)] = i; });
  return map;
}

/** Tolerant number parser: strips commas/currency text, returns null (not 0) for blank
    so a genuinely-missing value doesn't get silently recorded as zero in a numeric column. */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Slash dates arrive in BOTH orders and neither source announces which: a Sheets CSV export
    follows the sheet's locale (d/m/yyyy here), while a browser-side XLSX parse used to render
    Dates as m/d/yyyy. Reading one as the other is silent corruption, not a visible failure --
    7/23/2026 was refused outright (month 23) and 7/5/2026 quietly became 7 May instead of
    5 July. So: whichever component CANNOT be a month decides the order, and only when both
    are <= 12 do we fall back to d/m/yyyy, the convention of the sheets this system reads.
    (The browser path now sends yyyy-mm-dd, which is unambiguous and skips all of this.) */
/** `dayFirst` is optional and comes from inferDayFirst over the whole column: it only decides
    the cases the value itself cannot, like 06/07/2026. Everything else is read from the value.
    Omitted, this behaves exactly as it always has.

    THE FORMATS (handbook Part 95). Two forms were read until 17 Nov 2026 -- ISO, and a/b/yyyy -- and
    every other way a spreadsheet writes a date came back as NOTHING, in silence: "09-Jul-2026",
    "9 July 2026", "Jul 9, 2026", "09.07.2026", "2026/07/09", "20260709", an Excel serial number
    ("46210": a date cell that arrived as a number), and a slash date with a clock ("7/9/2026 14:03").
    "different excels might come with different formats" -- the owner, 17 Nov 2026. They are read now,
    by `moreDateParts_`, AFTER the two old forms: whatever the old reader read is read exactly as before.
    The one thing that changed for an old form is that a date which does not exist (31 February) is no
    longer returned as a date: a database refuses it and the whole slice of the upload fails, where the
    stamp reader rolled it into March without a word. */
export function dateOrNull(v, dayFirst) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || /^no\s+due\s+date$/i.test(s)) return null;
  const p = dateParts_(s, dayFirst);
  return p ? isoOf_(p) : null;
}

/** The day and the month of a pair a/b, in the order the pair itself or the file shows. ONE definition of
    "which of the two is the month", for slash, dash and dotted dates alike (the order rule above). */
function dayMonthOf_(a, b, dayFirst) {
  if (a > 12 && b <= 12) return { d: a, mo: b };                       // 23/7 -> only d/m is possible
  if (b > 12 && a <= 12) return { d: b, mo: a };                       // 7/23 -> only m/d is possible
  if (dayFirst === false) return { d: b, mo: a };                      // the file said month-first
  return { d: a, mo: b };                                              // both <= 12 -> the sheets' own d/m
}

const isLeap_ = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** A date that EXISTS. The old check was "day 1 to 31", which let 31 February through as the text
    "2026-02-31": a database refuses it (the whole slice of the upload fails), and the stamp reader
    rolled it into the third of March with no word. */
const DAYS_IN_MONTH_ = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function validDate_(y, mo, d) {
  return Number.isInteger(y) && Number.isInteger(mo) && Number.isInteger(d) && y >= 1 && mo >= 1 && mo <= 12 && d >= 1
    && d <= (mo === 2 && isLeap_(y) ? 29 : DAYS_IN_MONTH_[mo - 1]);
}
const isoOf_ = ({ y, mo, d }) => validDate_(y, mo, d) ? `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;

/** The year, month and day a text holds, or null: the two old forms first (exactly as they were read), then the new ones. */
function dateParts_(s, dayFirst) {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);                      // ISO first -- never ambiguous
  if (m) return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) { const { d, mo } = dayMonthOf_(Number(m[1]), Number(m[2]), dayFirst); return { y: Number(yearOf(m[3])), mo, d }; }
  return moreDateParts_(s, dayFirst);
}

/* MONTH NAMES, English and Swahili, whole words only ("sept" and "septemba", never a guess at a prefix). */
const MONTH_NAMES_ = {
  jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2, mar: 3, march: 3, machi: 3, apr: 4, april: 4, aprili: 4, may: 5, mei: 5,
  jun: 6, june: 6, juni: 6, jul: 7, july: 7, julai: 7, aug: 8, august: 8, agosti: 8, sep: 9, sept: 9, september: 9, septemba: 9,
  oct: 10, october: 10, oktoba: 10, nov: 11, november: 11, novemba: 11, dec: 12, december: 12, desemba: 12,
};
// An optional clock after the date ("14:03", "2:03:11 PM"), and an optional weekday before it ("Thu, ", "Alhamisi ").
const CLOCK_TAIL_ = '(?:[\\sT,]+\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?\\s*(?:[AaPp]\\.?[Mm]\\.?)?)?';
const WEEKDAY_HEAD_ = '(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili)\\.?[,\\s]+';
const DMY_ = new RegExp('^\\s*(?:' + WEEKDAY_HEAD_ + ')?(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{2,4})' + CLOCK_TAIL_ + '$', 'i');                              // 09.07.2026, 7/9/2026 14:03
const YMD_ = new RegExp('^\\s*(\\d{4})[\\/.](\\d{1,2})[\\/.](\\d{1,2})' + CLOCK_TAIL_ + '$');                                                                              // 2026/07/09, 2026.07.09
const D_MON_Y_ = new RegExp('^\\s*(?:' + WEEKDAY_HEAD_ + ')?(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-\\/.,]+([A-Za-z]{3,9})\\.?[\\s\\-\\/.,]+(\\d{2,4})' + CLOCK_TAIL_ + '$', 'i');   // 09-Jul-2026, 9 July 2026
const MON_D_Y_ = new RegExp('^\\s*(?:' + WEEKDAY_HEAD_ + ')?([A-Za-z]{3,9})\\.?[\\s\\-\\/.]+(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-\\/.,]+(\\d{2,4})' + CLOCK_TAIL_ + '$', 'i');   // Jul 9, 2026
const COMPACT_ = /^((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;                                                                                                  // 20260709
const SERIAL_ = /^(\d{5})(?:\.(\d{4,}))?$/;                                                                                                                                         // 46210, 46210.4375 (a fraction is a clock: four digits or more, so that an amount like 45000.00 is not one)
// Excel's day numbers, counted from 1899-12-30 (the 1900 leap-year error only touches the first 60). Only 2010 to 2040 is taken for one: a five-digit
// number in a date column is nearly always a date, but an amount in a misplaced column must not become a date of the year 2063.
const SERIAL_FROM_ = 40179, SERIAL_TO_ = 51501;                                                                                                                              // 2010-01-01, 2040-12-31

/** The forms nothing read before 17 Nov 2026, or null. `secs` is the clock of a serial number's fraction. */
function moreDateParts_(s, dayFirst) {
  let m = s.match(YMD_);
  if (m) return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
  m = s.match(DMY_);
  if (m) { const { d, mo } = dayMonthOf_(Number(m[1]), Number(m[2]), dayFirst); return { y: Number(yearOf(m[3])), mo, d }; }
  m = s.match(D_MON_Y_);
  if (m && MONTH_NAMES_[m[2].toLowerCase()]) return { y: Number(yearOf(m[3])), mo: MONTH_NAMES_[m[2].toLowerCase()], d: Number(m[1]) };
  m = s.match(MON_D_Y_);
  if (m && MONTH_NAMES_[m[1].toLowerCase()]) return { y: Number(yearOf(m[3])), mo: MONTH_NAMES_[m[1].toLowerCase()], d: Number(m[2]) };
  m = s.match(COMPACT_);
  if (m) return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
  m = s.match(SERIAL_);
  if (m) {
    const n = Number(m[1]);
    if (n < SERIAL_FROM_ || n > SERIAL_TO_) return null;
    const t = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), secs: m[2] ? Math.round(Number('0.' + m[2]) * 86400) : undefined };
  }
  return null;
}

/** 'HH:MM' from a clock value. A time-only cell comes back from the XLSX parse as a Date on
    Excel's epoch day, so the DATE part is meaningless and only the clock survives. */
export function timeOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** IS THIS FILE WRITTEN DAY-FIRST OR MONTH-FIRST?

    23/07/2026 can only be d/m. 07/23/2026 can only be m/d. 06/07/2026 is genuinely both, and
    guessing wrong moves a comment by up to eleven months while looking perfectly reasonable.

    A whole COLUMN usually settles it: one unambiguous value anywhere in the file decides every
    value in it, because a single export does not switch conventions halfway down. So this
    reads the column, not the cell.

    Returns true (day-first), false (month-first), or null when the file offers no evidence
    either way -- a caller that gets null should say so rather than pretend it knew. */
/** A two-digit year, turned into a four-digit one. "23-06-26" is how a person writes the
    twenty-third of June twenty twenty-six, and refusing it silently lost every promise date in
    a file that happened to be exported that way.

    Under fifty means this century. Fifty and over means the last one -- the usual convention,
    and safe here because these are loan dates: there is no 1998 promise date, and a birth year
    would never reach this function. */
export function yearOf(raw) {
  const t = String(raw == null ? '' : raw).trim();
  if (t.length === 4) return t;
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return String(n < 50 ? 2000 + n : 1900 + n);
}

export function inferDayFirst(values) {
  let dayFirst = 0, monthFirst = 0;
  for (const v of (values || [])) {
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
  }
  /* A file carrying BOTH kinds of evidence is malformed -- somebody pasted two exports
     together. The larger pile of evidence wins, and an exact tie gives up rather than guessing
     from a coin flip. */
  /* A file carrying BOTH kinds of evidence is malformed -- somebody pasted two exports
     together. The larger pile of evidence wins, and an exact tie gives up rather than guessing
     from a coin flip. Null means UNDECIDED, and it stays undecided here: a caller that has a
     safe way to break the tie can use tightestSpanIsDayFirst below, and one that has not --
     a comment log legitimately spans a year -- must not have a guess made on its behalf. */
  if (dayFirst === monthFirst) return null;
  return dayFirst > monthFirst;
}

/** WHICH READING PUTS THE FILE IN THE TIGHTER SPAN, for the files where nothing else can tell.

    An approved-loans report for the first week of August is 8/3, 8/4 ... 8/10: every value has
    both components under thirteen, so inferDayFirst counts nothing and gives up -- and giving
    up means day-first, which read that week as THE EIGHTH OF SIX DIFFERENT MONTHS:

      "Replaced 7 days, 2026-03-08 to 2026-10-08"     "i uploaded approved and now getting 0 sales!"

    Eight months of history out of a one-week report, and August's sales then read zero because
    nothing landed in August.

    A REPORT covers a stretch of days. It does not cover the same day-of-month across most of a
    year. So where the components cannot decide, the shape of the result can -- seven days
    against seven months is not a close call.

    Deliberately NOT part of inferDayFirst. This reasoning is only sound for a file that covers
    one short period, which a day's or a week's report does and a year of imported comment
    history does not. Null when it genuinely cannot tell. */
export function tightestSpanIsDayFirst(values) {
  const span = first => {
    let lo = null, hi = null;
    for (const v of (values || [])) {
      const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (!m) continue;
      const d = first ? Number(m[1]) : Number(m[2]);
      const mo = first ? Number(m[2]) : Number(m[1]);
      let y = Number(m[3]); if (y < 100) y += 2000;
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;      // not a real date this way round
      const t = Date.UTC(y, mo - 1, d);
      if (lo === null || t < lo) lo = t;
      if (hi === null || t > hi) hi = t;
    }
    return lo === null ? null : (hi - lo);
  };
  const dSpan = span(true), mSpan = span(false);
  if (dSpan === null || mSpan === null || dSpan === mSpan) return null;
  return dSpan < mSpan;
}

/** WHICH READING LANDS NEAREST THE DAY THE FILE WAS UPLOADED, for the file the two rules
    above both give up on: ONE day's report, every value the same date, both components under
    thirteen.

      "Sales of 31st aug are not counting at dashboard" -- and, checked on the way, the day
      after it: a Tuesday approvals file of nothing but "9/1/2026".

    No component is over twelve, so there is no evidence; every value is the same day, so both
    readings span zero days and the tighter-span rule cannot choose either. It fell through to
    day-first -- and 9/1/2026 read day-first is the ninth of January. A report uploaded on the
    second of September is about days near the second of September: the reading that puts the
    file's dates closest to the upload day is the one meant. Null when the two are equally
    near, which for a real report they never are. */
export function nearestToDayIsDayFirst(values, nearKey) {
  const m0 = String(nearKey == null ? '' : nearKey).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m0) return null;
  const near = Date.UTC(Number(m0[1]), Number(m0[2]) - 1, Number(m0[3]));
  const farthest = first => {
    let worst = null;
    for (const v of (values || [])) {
      const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (!m) continue;
      const d = first ? Number(m[1]) : Number(m[2]);
      const mo = first ? Number(m[2]) : Number(m[1]);
      let y = Number(m[3]); if (y < 100) y += 2000;
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;      // not a real date this way round
      const gap = Math.abs(Date.UTC(y, mo - 1, d) - near);
      if (worst === null || gap > worst) worst = gap;
    }
    return worst;
  };
  const dGap = farthest(true), mGap = farthest(false);
  if (dGap === null && mGap === null) return null;
  if (dGap === null) return false;
  if (mGap === null) return true;
  if (dGap === mGap) return null;
  return dGap < mGap;
}

/** A full moment -- date AND clock -- as an ISO timestamp, for a log whose ORDER matters.

    dateOrNull deliberately throws the time away: a due date has no clock. A comment log is the
    opposite. Its rows are what somebody said and when, several in the same afternoon, and the
    screen shows them newest first -- so collapsing every comment of a day onto midnight loses
    the order they were actually made in.

    `dayFirst` comes from inferDayFirst over the whole column. Null means undecided, and the
    caller decides what to do about that; here it falls back to day-first, which is what
    dateOrNull has always assumed.

    Returns null rather than a wrong answer, so an unreadable stamp is visible as missing
    instead of quietly becoming the moment of upload. */
export function stampOrNull(v, dayFirst) {
  if (v == null || v === '') return null;
  // The XLSX reader hands real date cells back as Date objects, which already carry the clock.
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  if (!s) return null;

  let y, mo, d, secs;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);                  // ISO -- never ambiguous
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) { y = +yearOf(m[3]); ({ d, mo } = dayMonthOf_(+m[1], +m[2], dayFirst)); }
    else {
      const p = moreDateParts_(s, dayFirst);                         // the forms nothing read before 17 Nov 2026: dateOrNull's list
      if (!p) return null;
      y = p.y; mo = p.mo; d = p.d; secs = p.secs;
    }
  }
  /* A date that EXISTS: `new Date("2026-02-31T10:00:00+03:00")` is the third of March, not an error, so the
     check is made here, before the date is built. */
  if (!validDate_(y, mo, d)) return null;

  // The clock, if there is one. 12-hour times carry am/pm; a bare 24-hour time does not.
  let hh = 0, mi = 0, ss = 0;
  const t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (t) {
    hh = +t[1]; mi = +t[2]; ss = t[3] ? +t[3] : 0;
    const ap = t[4] ? t[4].toUpperCase() : '';
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    if (hh > 23 || mi > 59 || ss > 59) { hh = 0; mi = 0; ss = 0; }
  } else if (secs !== undefined) {                                   // an Excel serial number's fraction of a day is the clock
    const day = secs % 86400;
    hh = Math.floor(day / 3600); mi = Math.floor((day % 3600) / 60); ss = day % 60;
  }

  /* Read as EAT (UTC+3) and stored as the UTC instant it was. The clock in a v1 export is the
     wall clock in the office, and treating 11:29 as 11:29 UTC would file every comment three
     hours early -- enough to move an evening one onto the next day. */
  const p2 = n => String(n).padStart(2, '0');
  const iso = `${y}-${p2(mo)}-${p2(d)}T${p2(hh)}:${p2(mi)}:${p2(ss)}+03:00`;
  const when = new Date(iso);
  return isNaN(when.getTime()) ? null : when.toISOString();
}

/** D.S / D.C are "paid/target" TEXT, e.g. "3/6" -- this is the one field that broke
    repeatedly in the Sheets version because Excel/Sheets kept silently re-interpreting
    it as a date. Here it's read as a plain string into a TEXT column with no numeric or
    date coercion possible anywhere in the pipeline -- if the CSV cell already got
    Excel-mangled into something like "Jun-03" before it ever reached this script, that's
    upstream of us and worth a visual spot-check on the export, but nothing in THIS
    pipeline can introduce the corruption itself. */
export function dsText(v) {
  return v === null || v === undefined ? null : String(v).trim();
}

/** Phone normalization matching pnorm_() from Code.gs: strip everything but digits,
    drop a leading 255 country code, drop leading zeros, keep the last 9 digits. Same
    normalization means the same customer matches the same phone across old and new data. */
export function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('255')) d = d.slice(3);
  d = d.replace(/^0+/, '');
  return d.slice(-9) || null;
}

export function textOrNull(v) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
}

/* A DASH IS NOT A PERSON.

     "unassigned teams count text at collection slide counted only for pmo collection not for
      early collection and recovery after uploading. so the dash was not respected"

   The leaders sheet writes a dash in a role nobody holds -- 162 of them in the file that
   raised this -- and the importer stored each one as a name. Every screen that then asked "is
   somebody named here" saw a non-empty cell and said yes, so eleven early-collection teams and
   nine recovery teams with no officer at all were counted as staffed. Collection was immune
   only because it counts PMO access codes, not the sheet.

   This is the one definition of "nobody named": blank, any run of dashes or underscores, N/A,
   NONE, NIL, HAKUNA, or a bare 0. The importer stores such a cell as NULL and every reader
   asks this function rather than testing the cell for emptiness, so the sheet and the boards
   cannot disagree about who is unassigned. */
const NOBODY = /^(?:[-\u2010-\u2015_.\u00B7]+|n\/?a|none|nil|null|hakuna|0)$/i;
export function nameOrNull(v) {
  const s = textOrNull(v);
  return s === null || NOBODY.test(s) ? null : s;
}

/** Team names are identifiers used for matching and foreign keys, not free text -- "Tunduru"
    and "TUNDURU" are the same team to a person but different strings to an exact-match database
    constraint. Normalizing every team value through this, everywhere a team gets read (Teams
    upload AND every table that references it), means that mismatch can't happen again -- not
    guarded against case by case, structurally not possible. */
export function normTeam(v) {
  const s = textOrNull(v);
  return s ? s.toUpperCase().replace(/\s+/g, ' ') : null;
}

/* THE STAFF_FUNDS WORKBOOK STORED NUMBERS WHERE THERE WERE IDENTIFIERS. A phone came back as
   677111910.0, an account as 10214592156.0, a NIDA number as 2.001072167122e+19 -- the sheet
   had already rounded that one to fifteen significant digits, so its last digits are gone for
   good and only the first eight (the birth date) can be trusted. Every identifier is read back
   to its digits first; a text cell with leading zeros ("0152826626000") keeps them. */
export function digitsCell(v) {
  if (v == null || v === '' || v instanceof Date) return null;
  let s = String(v).trim();
  // "20010721671220000000.00" is the whole number with a zero fraction: the digits are all
  // there, so they are kept as they are rather than rounded through a double.
  if (/^\d+\.\d+$/.test(s)) s = s.replace(/\..*$/, '');
  else {
    // "2.001072167122e+19": the point moved by the exponent, on the digits as written -- never
    // through a double, which would turn the sheet's own ...220000000 into ...219998720.
    const m = s.match(/^(\d+)(?:\.(\d+))?e\+?(\d+)$/i);
    if (m) {
      const digits = m[1] + (m[2] || ''), want = m[1].length + Number(m[3]);
      s = digits.length >= want ? digits.slice(0, want) : digits + '0'.repeat(want - digits.length);
    }
  }
  s = s.replace(/\D/g, '');
  return s || null;
}
/** A bank account: digits with their leading zeros when the cell is a number or digits, else
    the text as it is -- some banks write letters into theirs. */
export function accountCell(v) {
  const s = textOrNull(v);
  if (s === null) return null;
  return /^[\d.e+\-\s]+$/i.test(s) ? digitsCell(s) : s;
}
/** IS THIS CELL A BANK ACCOUNT NUMBER? One definition, the owner's (RUN-ME-069, docs/HANDOFF.md Part 99): no account number is a cell that is
    empty, blank, has no digit in it ("N/A", "NONE", "ON PROCESS", "-", "HAINA") or whose digits are all zeros; a cell with a digit other than
    zero in it counts as given, however short it looks. The SQL says the same in one line (the digits of the cell match '^0*$'): a test
    compares the two. The advance report uses it to tell a request's own copy of an account from junk that was copied beside it. */
export function hasAccount(v) { return /[1-9]/.test(String(v == null ? '' : v)); }
/** A phone from the sheet's numeric cell: back to its digits, then the system's 9-digit rule. */
export function phoneCell(v) { return normPhone(digitsCell(v)); }
/** A NIDA number carries the birth date in its first eight digits (YYYYMMDD) -- "BIRTH DATE
    (Generated from NIDA No)". Null when the number is short or the date impossible. */
export function nidaBirth(nida) {
  const d = digitsCell(nida);
  if (!d || d.length < 8) return null;
  const y = +d.slice(0, 4), m = +d.slice(4, 6), day = +d.slice(6, 8);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** A staff ID the way the sheet wrote them -- JMM/001/2026: the initials of up to three words
    of the name, a running number of at least three digits, the registration year. */
export function staffIdFor(name, year, serial) {
  const words = String(name || '').toUpperCase().split(/\s+/).map(w => w.replace(/[^A-Z]/g, '')).filter(Boolean);
  const initials = words.slice(0, 3).map(w => w[0]).join('') || 'STF';
  return `${initials}/${String(Math.max(1, Number(serial) || 1)).padStart(3, '0')}/${year}`;
}
