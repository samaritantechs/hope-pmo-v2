/* THE LETTERHEAD AND THE INVOICE, as real .docx files with a real header and footer.
   Both are TEMPLATES: the words in <angle brackets> are the ones to replace, and everything
   else -- the rule under the header, the column widths, the totals block -- is set so it stays
   put when somebody types into it. */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageNumber,
  PositionalTab, PositionalTabAlignment, PositionalTabLeader,
} from 'docx';

const NAVY = '0B2A6B', GOLD = 'F2A413', INK = '0E1726', SLATE = '5A6B85', LINE = 'D7DEEA';
const HERE = new URL('.', import.meta.url).pathname;
const logo = readFileSync(HERE + 'png/samaritantechs-logo-1200.png');
const mark = readFileSync(HERE + 'png/samaritantechs-mark-256.png');

/* A4, because that is what an office in Dar es Salaam prints on and what every local printer
   is loaded with. US Letter would come out with a strip missing off the bottom. */
const A4 = { width: 11906, height: 16838 };
const F = 'Arial';                                  // metric-mate of the wordmark; see the guide

const t = (text, o = {}) => new TextRun({ text, font: F, ...o });
const p = (runs, o = {}) => new Paragraph({ children: [].concat(runs), ...o });
const rule = (space = 120) => new Paragraph({
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 4 } },
  spacing: { after: space }, children: [t('')],
});

/* THE HEADER: the lockup on the left, the company line on the right, a hairline under both.
   The logo goes in at its own aspect ratio -- 1200x280 -- because a letterhead with a squashed
   logo on it is the first thing a client notices and the last thing anybody checks. */
const header = new Header({
  children: [
    new Paragraph({
      children: [new ImageRun({ type: 'png', data: logo, transformation: { width: 210, height: 49 } })],
      spacing: { after: 40 },
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT, spacing: { after: 60 },
      children: [t('Software for the field · Dar es Salaam, Tanzania', { size: 15, color: SLATE })],
    }),
    rule(200),
  ],
});

/* THE FOOTER carries the things a letter is judged on: how to reach them, and a page number
   that is a FIELD rather than a typed number, so it stays right when the letter grows. */
const footer = new Footer({
  children: [
    rule(60),
    new Paragraph({
      children: [
        t('SamaritanTechs', { bold: true, size: 15, color: NAVY }),
        t('   ·   samaritantechs@gmail.com   ·   +255 ', { size: 15, color: SLATE }),
        t('<phone>', { size: 15, color: SLATE }),
        new PositionalTab({ alignment: PositionalTabAlignment.RIGHT, relativeTo: 'margin',
          leader: PositionalTabLeader.NONE }),
        /* A FIELD, NOT A TYPED NUMBER. "Page 1 of 1" typed in by hand is wrong the moment the
           letter runs to two pages, and nobody re-reads the footer of their own letter. */
        t('Ukurasa / Page ', { size: 15, color: SLATE }),
        new TextRun({ children: [PageNumber.CURRENT], font: F, size: 15, color: SLATE }),
        t(' / ', { size: 15, color: SLATE }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: F, size: 15, color: SLATE }),
      ],
    }),
  ],
});

const page = { size: A4, margin: { top: 1400, right: 1134, bottom: 1000, left: 1134 } };

/* ------------------------------------------------------------------ 1. the letterhead ---- */
const letter = new Document({
  creator: 'SamaritanTechs', title: 'SamaritanTechs letterhead',
  sections: [{
    properties: { page },
    headers: { default: header }, footers: { default: footer },
    children: [
      p(t('<Date>', { size: 20, color: SLATE }), { spacing: { after: 260 } }),
      p(t('<Recipient name>', { bold: true, size: 22, color: INK })),
      p(t('<Organisation>', { size: 20, color: INK })),
      p(t('<Address>', { size: 20, color: SLATE }), { spacing: { after: 300 } }),
      p(t('Dear <name>,', { size: 22, color: INK }), { spacing: { after: 200 } }),
      p(t('<Your letter goes here. This template carries the header, the footer, the margins '
        + 'and the type sizes; replace only the words in angle brackets.>',
        { size: 22, color: INK }), { spacing: { after: 200, line: 300 } }),
      p(t('Yours sincerely,', { size: 22, color: INK }), { spacing: { before: 300, after: 700 } }),
      p(t('<Name>', { bold: true, size: 22, color: NAVY })),
      p(t('<Title>, SamaritanTechs', { size: 20, color: SLATE })),
    ],
  }],
});
writeFileSync(HERE + 'docs/SamaritanTechs-letterhead.docx', await Packer.toBuffer(letter));

/* --------------------------------------------------------------------- 2. the invoice ---- */
/* Column widths sum to the table width, and every cell states its own -- both in DXA, because
   percentages come apart the moment somebody opens the file in Google Docs. */
const W = 9638, COLS = [4600, 1300, 1800, 1938];
const cell = (children, o = {}) => new TableCell({
  width: { size: o.w, type: WidthType.DXA }, children: [].concat(children),
  shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
  margins: { top: 90, bottom: 90, left: 120, right: 120 },
  borders: {
    top:    { style: BorderStyle.SINGLE, size: 2, color: LINE },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: LINE },
    left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  },
});
const head = (label, w, right) => cell(
  p(t(label, { bold: true, size: 17, color: 'FFFFFF' }),
    { alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT }), { w, fill: NAVY });
const body = (label, w, right, o = {}) => cell(
  p(t(label, { size: 19, color: INK, ...o }),
    { alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT }), { w });

const itemRows = [];
for (let i = 0; i < 5; i++) {
  itemRows.push(new TableRow({ children: [
    body(i === 0 ? '<Description of work>' : ' ', COLS[0]),
    body(i === 0 ? '<1>' : ' ', COLS[1], true),
    body(i === 0 ? '<0.00>' : ' ', COLS[2], true),
    body(i === 0 ? '<0.00>' : ' ', COLS[3], true),
  ] }));
}
const totalRow = (label, value, strong) => new TableRow({ children: [
  cell(p(t('')), { w: COLS[0] }), cell(p(t('')), { w: COLS[1] }),
  cell(p(t(label, { bold: !!strong, size: 19, color: strong ? NAVY : SLATE }),
    { alignment: AlignmentType.RIGHT }), { w: COLS[2], fill: strong ? 'F4F7FB' : undefined }),
  cell(p(t(value, { bold: !!strong, size: 19, color: strong ? NAVY : INK }),
    { alignment: AlignmentType.RIGHT }), { w: COLS[3], fill: strong ? 'F4F7FB' : undefined }),
] });

const invoice = new Document({
  creator: 'SamaritanTechs', title: 'SamaritanTechs invoice',
  sections: [{
    properties: { page },
    headers: { default: header }, footers: { default: footer },
    children: [
      p([t('INVOICE', { bold: true, size: 40, color: NAVY })], { spacing: { after: 40 } }),
      p([t('Ankara / Invoice no.  ', { size: 19, color: SLATE }),
         t('<INV-0001>', { bold: true, size: 19, color: INK }),
         t('        Tarehe / Date  ', { size: 19, color: SLATE }),
         t('<date>', { bold: true, size: 19, color: INK }),
         t('        Inalipwa / Due  ', { size: 19, color: SLATE }),
         t('<date>', { bold: true, size: 19, color: INK })], { spacing: { after: 300 } }),
      p(t('KWA / BILL TO', { bold: true, size: 16, color: SLATE }), { spacing: { after: 60 } }),
      p(t('<Client name>', { bold: true, size: 22, color: INK })),
      p(t('<Organisation>', { size: 20, color: INK })),
      p(t('<Address>   ·   <email>', { size: 19, color: SLATE }), { spacing: { after: 320 } }),
      new Table({
        width: { size: W, type: WidthType.DXA }, columnWidths: COLS,
        rows: [
          new TableRow({ tableHeader: true, children: [
            head('Maelezo / Description', COLS[0]), head('Idadi / Qty', COLS[1], true),
            head('Bei / Rate (TZS)', COLS[2], true), head('Jumla / Amount (TZS)', COLS[3], true),
          ] }),
          ...itemRows,
          totalRow('Jumla ndogo / Subtotal', '<0.00>'),
          totalRow('VAT <18>%', '<0.00>'),
          totalRow('JUMLA / TOTAL (TZS)', '<0.00>', true),
        ],
      }),
      p(t('MALIPO / PAYMENT', { bold: true, size: 16, color: SLATE }),
        { spacing: { before: 360, after: 60 } }),
      p(t('Benki / Bank  <bank name>   ·   Akaunti / Account  <number>   ·   Jina / Name  SamaritanTechs',
        { size: 19, color: INK })),
      p(t('M-Pesa / Tigo Pesa  <number>', { size: 19, color: INK }), { spacing: { after: 240 } }),
      rule(120),
      p(t('Asante kwa kufanya kazi na sisi. / Thank you for working with us.',
        { size: 19, color: SLATE, italics: true })),
    ],
  }],
});
writeFileSync(HERE + 'docs/SamaritanTechs-invoice.docx', await Packer.toBuffer(invoice));
console.log('docs/SamaritanTechs-letterhead.docx\ndocs/SamaritanTechs-invoice.docx');
