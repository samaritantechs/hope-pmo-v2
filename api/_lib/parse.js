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
export function dateOrNull(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || /^no\s+due\s+date$/i.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);                      // ISO first -- never ambiguous
  if (m) {
    const month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), year = m[3];
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }                      // 23/7 -> only d/m is possible
    else if (b > 12 && a <= 12) { month = a; day = b; }                 // 7/23 -> only m/d is possible
    else { day = a; month = b; }                                        // both <= 12 -> the sheets' own d/m
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

/** Team names are identifiers used for matching and foreign keys, not free text -- "Tunduru"
    and "TUNDURU" are the same team to a person but different strings to an exact-match database
    constraint. Normalizing every team value through this, everywhere a team gets read (Teams
    upload AND every table that references it), means that mismatch can't happen again -- not
    guarded against case by case, structurally not possible. */
export function normTeam(v) {
  const s = textOrNull(v);
  return s ? s.toUpperCase().replace(/\s+/g, ' ') : null;
}
