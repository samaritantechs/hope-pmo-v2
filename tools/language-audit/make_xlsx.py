#!/usr/bin/env python3
"""Stage 5: the three vocabularies -> one Excel workbook (exactly three sheets)."""
import json, re, hashlib, sys, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

src = sys.argv[1] if len(sys.argv) > 1 else 'rows3.json'
out = sys.argv[2] if len(sys.argv) > 2 else 'HOPE-system-language-audit.xlsx'
meta = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
R = json.load(open(src))

def norm(s):
    s = re.sub(r'\{\d+\}', ' ', s or '')
    s = re.sub(r'[^\w\s]', ' ', s.lower())
    return re.sub(r'\s+', ' ', s).strip()

def hid(prefix, *parts):
    h = hashlib.sha1('\u0000'.join(parts).encode('utf-8')).hexdigest()[:6]
    return f'{prefix}-{h}'

def areas(e):
    a = e['areas']
    s = ' | '.join(a[:3])
    return s + (f' | +{len(a)-3} more' if len(a) > 3 else '')

def where(e):
    w = e['where'][:4]
    s = '; '.join(w)
    extra = e['count'] - len(w)
    return s + (f' (+{extra} more)' if extra > 0 and len(e['where']) <= 4 else (' …' if len(e['where']) > 4 else ''))

def kinds(e):
    return ' / '.join(sorted(set(e['kinds'])))

# English side -> Swahili wordings seen in pairs
en2sw = {}
for p in R['pairs']:
    en2sw.setdefault(norm(p['en']), set()).add(p['sw'])

PLACES = {x.lower() for x in ['Arusha','Dar es Salaam','Dodoma','Geita','Iringa','Kagera','Katavi','Kigoma','Kilimanjaro','Lindi','Manyara','Mara','Mbeya','Morogoro','Mtwara','Mwanza','Njombe','Pemba North','Pemba South','Pwani','Coast','Rukwa','Ruvuma','Shinyanga','Simiyu','Singida','Songwe','Tabora','Tanga','Unguja North','Unguja South','Kaskazini Pemba','Kusini Pemba','Kaskazini Unguja','Kusini Unguja','Mjini Magharibi','Magharibi','North Pemba','South Pemba','North Unguja','South Unguja','Zanzibar','Zanzibar West','Zanzibar Central South','Zanzibar North','Zanzibar South','Zanzibar Urban West','Kahama','Dar','Mjini']}
SW_HINT = re.compile(r'\b(ya|wa|na|kwa|hakuna|bado|kwenye|kila|hii|huu|sasa|tafadhali|imeshindikana|imehifadhiwa)\b', re.I)

wb = Workbook()
HEAD = PatternFill('solid', fgColor='0B2A6B')
OWNER = PatternFill('solid', fgColor='FDE68A')
NOTE = PatternFill('solid', fgColor='EEF2FF')
thin = Side(style='thin', color='D1D5DB')

def sheet(ws, title, banner, headers, widths, rows, owner_cols):
    ws.title = title
    ws['A1'] = banner
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
    ws['A1'].alignment = Alignment(wrap_text=True, vertical='top')
    ws['A1'].fill = NOTE
    ws['A1'].font = Font(size=10)
    ws.row_dimensions[1].height = 62
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=2, column=i, value=h)
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = OWNER if i in owner_cols else HEAD
        if i in owner_cols:
            c.font = Font(bold=True, color='000000')
        c.alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[get_column_letter(i)].width = widths[i - 1]
    ws.row_dimensions[2].height = 32
    for r, row in enumerate(rows, 3):
        for i, v in enumerate(row, 1):
            c = ws.cell(row=r, column=i, value=v)
            c.alignment = Alignment(wrap_text=True, vertical='top')
            if i in owner_cols:
                c.fill = PatternFill('solid', fgColor='FFFBEB')
    ws.freeze_panes = 'C3'
    ws.auto_filter.ref = f'A2:{get_column_letter(len(headers))}{max(3, len(rows) + 2)}'

# ---------------- sheet 1: English only
en_rows = []
for e in R['en']:
    flags = []
    if e.get('conf') == 'neutral':
        flags.append('language unsure: name, brand, abbreviation or mixed words')
    if SW_HINT.search(e['text']):
        flags.append('has Swahili words')
    if e.get('why') and e['why'] not in ('single', 'run'):
        flags.append(e['why'])
    if e['text'].strip().lower() in PLACES:
        flags.append('place name: not translated')
    sw = sorted(en2sw.get(norm(e['text']), []))[:2]
    en_rows.append((areas(e), e['text'].lower(), [
        hid('EN', e['text']), e['text'], '', '', kinds(e), areas(e), e['count'], where(e),
        ' || '.join(sw), '; '.join(flags),
    ]))
en_rows.sort(key=lambda x: (x[0].lower(), x[1]))
# ---------------- sheet 2: Swahili + English
pr_rows = []
for p in R['pairs']:
    flags = []
    if p.get('flag'):
        flags.append(p['flag'])
    if p['sw'].strip().lower() == p['en'].strip().lower():
        flags.append('same words on both sides: needs a real Swahili version?')
    order = 'English / Swahili' if p['order'] == 'en-sw' else ('Swahili / English' if p['order'] == 'sw-en' else p['order'])
    full = ' || '.join(p.get('fulls', []))
    pr_rows.append((areas(p), p['sw'].lower(), [
        hid('PR', p['sw'], p['en']), p['sw'], p['en'], '', '', kinds(p), areas(p), p['count'], where(p), order, '; '.join(flags), full,
    ]))
pr_rows.sort(key=lambda x: (x[0].lower(), x[1]))
# ---------------- sheet 3: Swahili only
sw_rows = []
for e in R['sw']:
    flags = []
    if e.get('conf') == 'neutral':
        flags.append('language unsure')
    if e.get('why') and e['why'] not in ('single', 'run'):
        flags.append(e['why'])
    sw_rows.append((areas(e), e['text'].lower(), [
        hid('SW', e['text']), e['text'], '', '', '', kinds(e), areas(e), e['count'], where(e), '; '.join(flags),
    ]))
sw_rows.sort(key=lambda x: (x[0].lower(), x[1]))

today = datetime.date.today().isoformat()
sheet(wb.active, '1 English only',
      'HOPE PMO · system language audit · sheet 1 of 3 · PHRASES THAT EXIST IN ENGLISH ONLY (' + today + ').  '
      'Write the Swahili you accept in the yellow column "Acceptable Swahili (owner)". Leave it empty if the English should stay as it is (names, abbreviations, brands). '
      '{1} {2} … stand for values the system fills in (a number, a name, an amount): keep them in your wording, in the order you need. '
      'Column "Swahili used elsewhere" shows how the system already says the same English phrase in a Swahili / English pair.',
      ['ID', 'English phrase (current)', 'Acceptable Swahili (owner)', 'Notes (owner)', 'Kind of text', 'Screen / area', 'Times used', 'Where in the system (file:line)', 'Swahili used elsewhere for this English', 'Check'],
      [12, 52, 46, 28, 20, 34, 8, 40, 40, 30], [r[2] for r in en_rows], {3, 4})
sheet(wb.create_sheet(), '2 Swahili + English',
      'HOPE PMO · system language audit · sheet 2 of 3 · PHRASES SHOWN IN SWAHILI AND ENGLISH TOGETHER (' + today + ').  '
      'Read the Swahili column; if it sounds robotic or wrong, write the wording you accept in the yellow column "Acceptable Swahili (owner)". Leave it empty to keep the current Swahili. '
      'The English column is for context (change it in the notes if it is wrong). {1} {2} … stand for values the system fills in: keep them. '
      '"Full text" shows the longer text a phrase was cut from, when it was.',
      ['ID', 'Swahili (current)', 'English (current)', 'Acceptable Swahili (owner)', 'Notes (owner)', 'Kind of text', 'Screen / area', 'Times used', 'Where in the system (file:line)', 'Order in the system', 'Check', 'Full text it was cut from'],
      [12, 52, 52, 46, 28, 20, 34, 8, 40, 16, 30, 50], [r[2] for r in pr_rows], {4, 5})
sheet(wb.create_sheet(), '3 Swahili only',
      'HOPE PMO · system language audit · sheet 3 of 3 · PHRASES THAT EXIST IN SWAHILI ONLY (' + today + ').  '
      'Write the Swahili you accept in the yellow column "Acceptable Swahili (owner)" (or leave it empty to keep it), and the English meaning in "English (owner)" so that the English side of the switch has words too. '
      '{1} {2} … stand for values the system fills in: keep them.',
      ['ID', 'Swahili phrase (current)', 'Acceptable Swahili (owner)', 'English (owner)', 'Notes (owner)', 'Kind of text', 'Screen / area', 'Times used', 'Where in the system (file:line)', 'Check'],
      [12, 56, 46, 46, 28, 20, 34, 8, 40, 24], [r[2] for r in sw_rows], {3, 4, 5})

# unique ids?
for name, rows in (('en', en_rows), ('pr', pr_rows), ('sw', sw_rows)):
    ids = [r[2][0] for r in rows]
    assert len(ids) == len(set(ids)), name + ' ids collide'
wb.save(out)
print('saved', out, 'rows:', len(en_rows), len(pr_rows), len(sw_rows))
