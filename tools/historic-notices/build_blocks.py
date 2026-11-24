#!/usr/bin/env python3
"""THE LEGAL TEAM'S SHEET OF OLD DEMAND NOTICES -> the data blocks of db/TEMPLATE-historic-demand-notices-import.sql (handbook Part 138).

  "We have our system demands from mid-May 2026, but the notices were supplied since 2025 so am sending you the file so that you extract
   all those that don't exist in the system ... look the dates as they ascend so that you don't import with mistakes ... You may left out
   those without ref no" -- the owner, 23 Nov 2026

It reads the workbook the owner sent (two sheets: the system's own export, and the legal team's sheet with ISSUED BY, the customer, REF NO,
TEAM, PRINCIPAL, TOTAL LOAN, TOTAL PAID, ARREAS AT NOTICE, NOTICE DATE) and writes, into a folder of your choosing, one text file for each
data block (each under 10,000 characters, flush-left, with its END line), the engine built for exactly that many rows, and a report with
no customer in it. THE BLOCKS CARRY CUSTOMERS' NAMES: they are pasted in the chat and never committed, and the folder is never inside the
repository. EACH BLOCK CARRIES THE FINGERPRINT OF ITS OWN LINES (md5 of the lines joined by a newline): pasted with one character changed,
or cut, it writes nothing and says so; and the engine writes nothing unless the list holds every row of every block.

HOW A DATE IS READ (the report counts each kind):
  T  text, day first (15/10/2025, 19/01/26). Every text date of the sheet has a day over twelve: a spreadsheet that reads month first
     could not turn those into dates, so it left them as text.
  C  text with a typing slip that has one reading (17,03,2026; 16//01/2026; a year typed 20205): corrected, and the cell is kept.
  S  a real date cell whose day is over twelve, or equal to its month, or that the system already holds for that loan number: as stored.
  X  a real date cell with a day of twelve or under where only ONE reading falls inside the sheet's own period (PERIOD below): a cell
     that says 1 December 2026 was typed 12/01/2026 and read month first, so it is 12 January 2026.
  x  both readings fall inside the period, and THE OFFICER'S OWN ROWS DECIDE: an officer whose rows hold text dates typed day first
     into a sheet that reads month first, so their date cells are exchanged; (s) an officer with no text date at all and real date
     cells with days over twelve has a sheet that reads dates right, so theirs stand. Sundays agree wherever they can speak (of the
     dates that are certain, about one in a hundred is a Sunday; on the 2025 sheet the rule never chose a Sunday where the other
     reading was a weekday, and three times the reading it rejected was one).
  U  nobody can read it (31/04/2026; 09/054/2026): the row goes into the list with no date, the engine leaves it out and names its row.
Rows with no REF NO are not written at all (the owner brings them later).

    python3 -I tools/historic-notices/build_blocks.py <workbook.xlsx> <output folder outside the repository>
Needs openpyxl. """
import sys, re, datetime, collections, os, hashlib
import openpyxl

PERIOD = (datetime.date(2025, 7, 20), datetime.date(2026, 5, 31))    # the first text date of the sheet is 26/07/25; the system's own notices begin 13 May 2026
NEW, OLD = 'NEW IMPORT IF NOT IN EXISTING', 'EXISTING DEMANDS'
MAX_BLOCK = 9600

def refnorm(v):
    s = '' if v is None else str(v).strip()
    if re.fullmatch(r'\d+\.0', s): s = s[:-2]
    return re.sub(r'\s+', '', s).upper()
def clean(v): return re.sub(r'\s+', ' ', str(v or '').replace(',', ' ')).strip().strip('.').upper()
def amount(v):
    """Whole shillings: a number cell as it is; a text cell by its digits ("4,080,000/-", "1,768'000", "416/000"), keeping a decimal part
    only where the text ends in a point and one or two digits. None for an empty cell or one with no digit."""
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip()
    m = re.search(r'\.(\d{1,2})\s*$', s)
    digits = re.sub(r'\D', '', s[:m.start()] if m else s)
    return float(digits + ('.' + m.group(1) if m else '')) if digits else None
def day(y, m, d):
    try: return datetime.date(y, m, d)
    except ValueError: return None
def text_date(raw):
    t = re.sub(r'/+', '/', re.sub(r'[,.\-]+', '/', raw.strip()))
    m = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{2,5})', t)
    if not m: return None, False
    dd, mm, yy = int(m.group(1)), int(m.group(2)), m.group(3)
    fixed = t != raw.strip()
    if len(yy) == 2: y = 2000 + int(yy)
    elif len(yy) == 4: y = int(yy)
    elif len(yy) == 5:                                        # one digit too many: only a year of the period can be meant
        c = sorted({int(yy[:i] + yy[i + 1:]) for i in range(5)} & {PERIOD[0].year, PERIOD[1].year})
        if len(c) != 1: return None, False
        y, fixed = c[0], True
    else: return None, False
    return day(y, mm, dd), fixed

def read(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    held = collections.defaultdict(set)
    if OLD in wb.sheetnames:
        for r in list(wb[OLD].iter_rows(values_only=True))[1:]:
            d = r[2].date() if isinstance(r[2], datetime.datetime) else None
            if d is None and isinstance(r[2], str):
                try: d = datetime.date.fromisoformat(r[2][:10])
                except ValueError: d = None
            if d: held[refnorm(r[3])].add(d)
    rows = list(wb[NEW].iter_rows(values_only=True))[1:]
    texts = collections.Counter()                             # the officer's own habit: do their rows hold text dates at all?
    for r in rows:
        if r[8] is not None and not isinstance(r[8], (datetime.datetime, datetime.date)) and str(r[8]).strip(): texts[clean(r[0])] += 1
    out, noref = [], 0
    for line, r in enumerate(rows, start=2):
        ref = refnorm(r[2])
        if not ref: noref += 1; continue
        who, v = clean(r[0]), r[8]
        rec = dict(line=line, by=who, name=clean(r[1]), ref=ref, team=re.sub(r'\s+', ' ', str(r[3] or '')).strip().upper(),
                   principal=amount(r[4]), loan=amount(r[5]), paid=amount(r[6]), arrears=amount(r[7]), date=None, how='U', cell='')
        if isinstance(v, (datetime.datetime, datetime.date)):
            st = v.date() if isinstance(v, datetime.datetime) else v
            sw = day(st.year, st.day, st.month)
            a, b = PERIOD[0] <= st <= PERIOD[1], sw is not None and PERIOD[0] <= sw <= PERIOD[1]
            if st in held.get(ref, ()) or st.day > 12 or st.day == st.month: rec.update(date=st, how='S')
            elif a and not b: rec.update(date=st, how='S')
            elif b and not a: rec.update(date=sw, how='X')
            elif a and b: rec.update(date=sw, how='x') if texts[who] else rec.update(date=st, how='s')
            else: rec.update(cell='cell ' + st.isoformat())
        elif v is not None and str(v).strip():
            d, fixed = text_date(str(v))
            if d: rec.update(date=d, how='C' if fixed else 'T', cell=' '.join(str(v).split()) if fixed else '')
            else: rec.update(cell=' '.join(str(v).split()))
        out.append(rec)
    return out, noref

def num(v): return '' if v is None else (str(int(v)) if v == int(v) else ('%.2f' % v))
def line_of(r, codes):
    f = [str(r['line']), codes[r['by']], r['name'], r['ref'], r['team'], num(r['principal']), num(r['loan']), num(r['paid']), num(r['arrears']),
         r['date'].strftime('%y%m%d') if r['date'] else '', r['how'], r['cell']]
    assert not any('|' in x or '$' in x or '\n' in x for x in f), 'a cell of row %d holds a character the block cannot carry' % r['line']
    return '|'.join(f)

def fingerprint(lines):
    """What the block's own SQL computes: md5 of its lines, blanks at their ends and empty lines aside, joined by a newline."""
    assert all(l and l == l.strip() and '\r' not in l for l in lines), 'a line with a blank at its end, or empty, has no stable fingerprint'
    return hashlib.md5('\n'.join(lines).encode('ascii')).hexdigest()
def once(text, a, b):
    assert text.count(a) == 1, 'the template does not hold this exactly once: ' + a[:60]
    return text.replace(a, b)

def blocks(recs, template):
    codes = {who: chr(65 + i) for i, who in enumerate(sorted({r['by'] for r in recs}))}
    a = template.index('create table if not exists public.demand_import_2025')
    b = template.index('-- END OF DATA BLOCK 1 OF 1')
    shape = template[a:b]
    i, j = shape.index('$d$\n') + 4, shape.index('\n$d$', shape.index('$d$\n') + 4)
    head, made_up, tail = shape[:i], shape[i:j].split('\n'), shape[j:]
    case = "case split_part(l, '|', 2) " + ' '.join("when '%s' then '%s'" % (c, w.replace("'", "''")) for w, c in sorted(codes.items(), key=lambda x: x[1])) + " else split_part(l, '|', 2) end,"
    old = [l for l in tail.split('\n') if l.startswith("case split_part(l, '|', 2)")]
    assert len(old) == 1; tail = once(tail, old[0], case)
    lines = [line_of(r, codes) for r in recs]
    groups, cur, size = [], [], 0
    room = MAX_BLOCK - len(head) - len(tail) - 400
    for l in lines:
        if cur and size + len(l) + 1 > room: groups.append(cur); cur, size = [], 0
        cur.append(l); size += len(l) + 1
    if cur: groups.append(cur)
    out, total = [], 0
    for n, g in enumerate(groups, start=1):
        total += len(g)
        t = once(tail, "= '%s' as ok" % fingerprint(made_up), "= '%s' as ok" % fingerprint(g))
        t = once(t, "'DATA BLOCK 1 OF 1 DID NOT ARRIVE WHOLE", "'DATA BLOCK %d OF %d DID NOT ARRIVE WHOLE" % (n, len(groups)))
        t = once(t, "'data block 1 of 1 is in, BUT", "'data block %d of %d is in, BUT" % (n, len(groups)))
        t = once(t, "'data block 1 of 1: OK'", "'data block %d of %d: OK'" % (n, len(groups)))
        t = once(t, 'when (select c from n) < 3 then', 'when (select c from n) < %d then' % total)
        t = once(t, '3 as rows_there_should_be_after_this_block', '%d as rows_there_should_be_after_this_block' % total)
        text = ('-- HISTORIC DEMAND NOTICES, DATA BLOCK %d OF %d: rows of the legal team\'s sheet that have a loan number. It fills a private list and\n'
                '-- changes no notice. Paste ALL of it in a NEW tab, see that the last line says END, run. Safe to run again. Run the blocks in order.\n'
                '-- Its answer must say OK. A block that was cut or altered on the way writes nothing and says so.\n' % (n, len(groups))
                + head + '\n'.join(g) + t + '-- END OF DATA BLOCK %d OF %d\n' % (n, len(groups)))
        assert len(text) < 10000 and not any(l[:1] in (' ', '\t') for l in text.split('\n')) and all(ord(c) < 127 for c in text), 'block %d is not a block the owner can paste' % n
        out.append(text)
    return out, codes

def engine(template, rows):
    """The engine as the template has it, built for exactly this many rows in the list (it writes nothing on any other count)."""
    a = template.index('-- HISTORIC DEMAND NOTICES: COUNT, THEN IMPORT.')
    text = once(template[a:], '(select count(*) from public.demand_import_2025) = 3 as ok)', '(select count(*) from public.demand_import_2025) = %d as ok)' % rows)
    assert text.rstrip('\n').endswith('-- END OF THE ENGINE') and "upper(btrim('COUNT')) as m)" in text, 'the engine is not whole, or does not say COUNT'
    assert len(text) < 10000 and not any(l[:1] in (' ', '\t') for l in text.split('\n')) and all(ord(c) < 127 for c in text), 'the engine is not a block the owner can paste'
    return text

if __name__ == '__main__':
    book, outdir = sys.argv[1], sys.argv[2]
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    assert not os.path.abspath(outdir).startswith(root + os.sep), 'the blocks carry customers\' names: write them outside the repository'
    recs, noref = read(book)
    template = open(os.path.join(root, 'db', 'TEMPLATE-historic-demand-notices-import.sql'), encoding='utf-8').read()
    out, codes = blocks(recs, template)
    os.makedirs(outdir, exist_ok=True)
    for n, t in enumerate(out, start=1): open(os.path.join(outdir, 'block-%d.sql' % n), 'w', encoding='utf-8').write(t)
    eng = engine(template, len(recs))
    open(os.path.join(outdir, 'engine.sql'), 'w', encoding='utf-8').write(eng)
    how = collections.Counter(r['how'] for r in recs)
    rep = ['rows of the sheet with no REF NO (left out): %d' % noref, 'rows with a REF NO (written): %d' % len(recs), 'officers: %d' % len(codes),
           'how the dates were read: ' + ', '.join('%s %d' % (k, how[k]) for k in 'TCSXxsU' if how[k]),
           'unreadable (their rows of the sheet, and the cell): ' + '; '.join('%d [%s]' % (r['line'], r['cell']) for r in recs if r['how'] == 'U'),
           'corrected text (row, cell, read as): ' + '; '.join('%d [%s] %s' % (r['line'], r['cell'], r['date']) for r in recs if r['how'] == 'C'),
           'by month of the date read: ' + ', '.join('%s: %d' % kv for kv in sorted(collections.Counter(r['date'].strftime('%Y-%m') for r in recs if r['date']).items())),
           'blocks: %d, characters: %s; the engine: %d characters, built for %d rows' % (len(out), ', '.join(str(len(t)) for t in out), len(eng), len(recs))]
    open(os.path.join(outdir, 'report.txt'), 'w', encoding='utf-8').write('\n'.join(rep) + '\n')
    print('\n'.join(rep))
