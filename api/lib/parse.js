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

/** Tolerant date parser. Handles d/M/yyyy -- the Tanzania/British convention your raw exports
    actually use (confirmed from real rows: 20/04/2026, 23/07/2026 -- the first number being a
    month would be impossible in either case) -- and yyyy-MM-dd. Returns null rather than
    guessing on "No due date", blank, or a genuinely invalid combination -- the Sheets version's
    worst bugs all came from a date field silently becoming something that WASN'T actually a
    date; this refuses to guess and just leaves it null instead. */
export function dateOrNull(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || /^no\s+due\s+date$/i.test(s)) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const day = Number(m[1]), month = Number(m[2]), year = m[3];
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;   // not a valid date either way -- don't guess, just refuse it
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
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
