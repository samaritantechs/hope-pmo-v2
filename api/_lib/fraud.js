/* =====================================================================================
   FRAUD DETECTOR -- the same name or number on more than one approved loan, or on an approved
   loan and on the current defaults sheet.
   =====================================================================================
     "I need a new nav 'Fraud Detector' where every approved loan with a number or name among
      customer, guarantor or receiver that still exists in an another approved of the three
      columns or in the current defaults sheet, auto list the case list that will open card
      details containing previous involved loan details vs current. Autosorted newest to oldest"

   What Vwawa and Tunduma looked like in the book: one receiver number collecting several
   customers' disbursements, a guarantor who is somebody else's customer, a customer approved
   again while their earlier loan sits in default. None of it is visible loan by loan; it is
   visible only when the parties of every approved loan are laid side by side.

   THE RULE, in one place:
     - The parties of a loan are its CUSTOMER (name, contact, momo), its RECEIVER (name, momo)
       and its GUARANTOR (name, contact). A number is compared as normPhone writes it (the last
       nine digits); a name as its letters, uppercased, and only when it has at least two words
       and six letters -- a lone JOHN matches half the book and says nothing.
     - A CASE is an approved loan (the sales stages: approved, pending_disb, disbursed, funded,
       closed) with at least one LINK:
         * a party of ANOTHER CUSTOMER's approved loan (another docket), any of the three
           columns against any of the three. The customer's own earlier loans are not a link:
           a repeat customer is the ordinary business of this company;
         * a row of the CURRENT DEFAULTS SHEET (the latest current deck, every weekday) that is
           not the loan's own row: another customer's name or number, or the customer's own
           earlier loan still in default when this one was approved.
     - A link by NUMBER is strong; by name alone, weak. The case carries both, labelled, and the
       card lays this loan's parties beside each linked loan's and each defaults row's.
     - Cases are sorted newest first by approved date, then by creation.

   TEAM SCOPING AT THE DATABASE on both reads: a scoped code compares its own teams' loans
   against its own teams' loans and defaults, and the screen says so. Two reads, kept a minute
   per scope (answer-cache.js); never on /api/upload or /api/call. */
import { fetchAll } from './supabase.js';
import { teamMatchList, latestDeckAnyWeekday } from './snapshots.js';
import { docketKeyOf, refFor } from './docket.js';
import { normPhone } from './parse.js';
import { SALES_STAGES } from './dashboard-core.js';
import { cachedAnswer } from './answer-cache.js';
import { todayKey } from './time.js';

const LOAN_COLS = 'id, docket_no, loan_id, track_no, full_name, contact, momo, recipient_full_name, recipient_momo, '
  + 'guarantor_name, guarantor_contact, team, zone, product, principal_amt, loan_amt, net_disbursed, stage, '
  + 'approved_date, disb_date, approved_by, created_by, recommended_by, created_at';
const DEF_COLS = ['ref', 'docket_no', 'full_name', 'contact', 'guarantor_name', 'guarantor_contact', 'team', 'status',
  'dc', 'days_elapsed', 'arrears', 'balance', 'disb_date', 'snapshot_date', 'weekday'];
/** Links kept on a case; a receiver number on fifty loans would otherwise carry fifty blocks. */
export const MAX_LINKS = 30;

const S_ = v => String(v == null ? '' : v).trim();
const digits = v => S_(v).replace(/\D/g, '');
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** A name as compared: letters only, uppercased, at least two words of two letters and six
    letters in all. '' means "too little to compare", never "matches the other blanks". */
export function nameKey(v) {
  const letters = S_(v).toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!letters) return '';
  const words = letters.split(' ').filter(w => w.length >= 2);
  if (words.length < 2 || words.join('').length < 6) return '';
  return words.join(' ');
}
/** A number as compared: the last nine digits, as every importer stores a phone. */
export function phoneKey(v) {
  const p = normPhone(v);
  return p && p.length === 9 ? p : '';
}

const partiesOfLoan = l => [
  { party: 'customer', phones: [l.contact, l.momo], names: [l.full_name] },
  { party: 'receiver', phones: [l.recipient_momo], names: [l.recipient_full_name] },
  { party: 'guarantor', phones: [l.guarantor_contact], names: [l.guarantor_name] },
];
const partiesOfDefault = d => [
  { party: 'customer', phones: [d.contact], names: [d.full_name] },
  { party: 'guarantor', phones: [d.guarantor_contact], names: [d.guarantor_name] },
];
/** Every comparable key a row carries: [{ key, kind, party, value }], one per party and value. */
function keysOf(parties) {
  const out = [], seen = new Set();
  for (const p of parties) {
    for (const v of p.phones) {
      const k = phoneKey(v);
      if (!k || seen.has('P:' + k + '|' + p.party)) continue;
      seen.add('P:' + k + '|' + p.party);
      out.push({ key: 'P:' + k, kind: 'phone', party: p.party, value: S_(v) });
    }
    for (const v of p.names) {
      const k = nameKey(v);
      if (!k || seen.has('N:' + k + '|' + p.party)) continue;
      seen.add('N:' + k + '|' + p.party);
      out.push({ key: 'N:' + k, kind: 'name', party: p.party, value: S_(v) });
    }
  }
  return out;
}
/** The loan's reference digits: the loan_id where the row carries one, else docket + track. */
const loanRef = l => digits(l.loan_id) || (l.docket_no && l.track_no != null ? digits(refFor(l.docket_no, l.track_no)) : '');
const loanDocket = l => docketKeyOf(loanRef(l), l.docket_no);

const loanSummary = l => ({
  id: l.id, ref: loanRef(l), docket: S_(l.docket_no), team: S_(l.team), zone: S_(l.zone), product: S_(l.product), stage: S_(l.stage),
  name: S_(l.full_name), contact: S_(l.contact), momo: S_(l.momo),
  receiver: S_(l.recipient_full_name), receiverMomo: S_(l.recipient_momo),
  guarantor: S_(l.guarantor_name), guarantorContact: S_(l.guarantor_contact),
  principal: num(l.principal_amt), loanAmt: num(l.loan_amt), netDisbursed: num(l.net_disbursed),
  approvedDate: l.approved_date || null, disbDate: l.disb_date || null,
  approvedBy: S_(l.approved_by), createdBy: S_(l.created_by), recommendedBy: S_(l.recommended_by),
  createdAt: l.created_at || null,
});
const defSummary = d => ({
  ref: S_(d.ref), docket: S_(d.docket_no), team: S_(d.team), name: S_(d.full_name), contact: S_(d.contact),
  guarantor: S_(d.guarantor_name), guarantorContact: S_(d.guarantor_contact),
  status: S_(d.status), dc: d.dc == null ? null : num(d.dc), daysElapsed: d.days_elapsed == null ? null : num(d.days_elapsed),
  arrears: num(d.arrears), balance: num(d.balance), disbDate: d.disb_date || null, deckDate: d.snapshot_date || null,
});

/** The rule itself, over rows already read: exported so the test can hand it a book and the
    screen's function can hand it the database's. */
export function detect(loans, defaults) {
  const byKey = new Map();
  const add = (key, entry) => { if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(entry); };
  const loanKeys = loans.map(l => keysOf(partiesOfLoan(l)));
  loans.forEach((l, i) => loanKeys[i].forEach(k => add(k.key, { t: 'loan', i, party: k.party })));
  defaults.forEach((d, j) => keysOf(partiesOfDefault(d)).forEach(k => add(k.key, { t: 'def', j, party: k.party })));
  const refs = loans.map(loanRef), dockets = loans.map(loanDocket);
  const cases = [];
  loans.forEach((l, i) => {
    const links = [], seen = new Set();
    for (const k of loanKeys[i]) {
      for (const e of byKey.get(k.key) || []) {
        if (e.t === 'loan') {
          if (e.i === i) continue;
          if (dockets[i] && dockets[i] === dockets[e.i]) continue;          // the customer's own history
          const id = 'L|' + loans[e.i].id + '|' + k.party + '|' + e.party + '|' + k.key;
          if (seen.has(id)) continue;
          seen.add(id);
          links.push({ t: 'loan', kind: k.kind, mine: k.party, theirs: e.party, value: k.value, own: false, with: loanSummary(loans[e.i]) });
        } else {
          const d = defaults[e.j], dRef = digits(d.ref);
          if (dRef && dRef === refs[i]) continue;                            // the loan's own row on the sheet
          const own = !!dockets[i] && dockets[i] === docketKeyOf(dRef, d.docket_no);
          const id = 'D|' + dRef + '|' + k.party + '|' + e.party + '|' + k.key;
          if (seen.has(id)) continue;
          seen.add(id);
          links.push({ t: 'def', kind: k.kind, mine: k.party, theirs: e.party, value: k.value, own, with: defSummary(d) });
        }
      }
    }
    if (!links.length) return;
    // strong first, loans before defaults, so the capped list keeps what matters most
    links.sort((a, b) => (b.kind === 'phone') - (a.kind === 'phone') || (a.t === 'def') - (b.t === 'def'));
    const loanIds = new Set(links.filter(x => x.t === 'loan').map(x => x.with.id));
    const defRefs = new Set(links.filter(x => x.t === 'def').map(x => x.with.ref));
    cases.push({
      ...loanSummary(l),
      strong: links.some(x => x.kind === 'phone'),
      ownDefault: links.some(x => x.t === 'def' && x.own),
      nLoans: loanIds.size, nDefaults: defRefs.size, nLinks: links.length,
      links: links.slice(0, MAX_LINKS), more: Math.max(0, links.length - MAX_LINKS),
    });
  });
  cases.sort((a, b) => String(b.approvedDate || '').localeCompare(String(a.approvedDate || ''))
    || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return cases;
}

/** THE BOOK, read once a minute per scope and shared by the case list and the look-up: every
    approved loan this code may see, and the current defaults deck. */
async function readBook_(db, user, nowMs) {
  return cachedAnswer(db, 'fraudbook', user, nowMs, async () => {
    const teams = user.teams && user.teams.length ? user.teams : null;
    const [loans, deck] = await Promise.all([
      fetchAll(() => {
        let q = db.from('loans').select(LOAN_COLS).in('stage', SALES_STAGES);
        if (teams) q = q.in('team', teamMatchList(teams));
        return q;
      }),
      latestDeckAnyWeekday(db, 'defaulter_snapshots', { snapshot_type: 'current' },
        { notAfter: todayKey(nowMs), teams, columns: DEF_COLS }),
    ]);
    return { loans: loans || [], deck, teams: teams ? teams.slice() : null };
  });
}

/** The screen's list. */
export async function fraudCases(db, user, _args, nowMs = Date.now()) {
  return cachedAnswer(db, 'fraud', user, nowMs, async () => {
    const book = await readBook_(db, user, nowMs);
    const cases = detect(book.loans, book.deck.rows || []);
    return {
      ok: true, cases,
      scanned: { loans: book.loans.length, defaults: (book.deck.rows || []).length },
      deck: { date: book.deck.date || null, weekdays: book.deck.weekdays || [] },
      scope: book.teams,
      stages: SALES_STAGES.slice(),
    };
  });
}

/** THE LOOK-UP BEFORE APPROVAL.
      "the search in here will help credit analysts to search a number among the list before
       approval - but return active customer even if not in the list - for search character only"
    The typed characters against the WHOLE book this code may see, not only the cases: every
    approved loan's six party fields and the defaults sheet's four. Digits typed find a number
    containing them (a local 0712… or a 255712… is read as the same nine digits); letters find a
    name containing them. The same book as the case list, so a number that is clean here is
    clean in the detector too. Loans first, newest first, then the sheet; capped, and the total
    said. */
export const FIND_MIN = 3, FIND_MAX = 100;
export async function fraudFind(db, user, args, nowMs = Date.now()) {
  const raw = S_(args && args.q).slice(0, 80);
  const bare = raw.replace(/[\s\-+().]/g, '');
  const isNumber = /^\d+$/.test(bare);
  const q = isNumber
    ? (/^255\d{9}$/.test(bare) ? bare.slice(3) : /^0\d{9}$/.test(bare) ? bare.slice(1) : bare)
    : raw.toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < FIND_MIN) {
    const e = new Error('Andika angalau herufi au tarakimu ' + FIND_MIN + '. / Type at least ' + FIND_MIN + ' letters or digits.');
    e.status = 400; throw e;
  }
  const book = await readBook_(db, user, nowMs);
  const has = isNumber
    ? v => { const d = S_(v).replace(/\D/g, ''); return !!d && d.includes(q); }
    : v => S_(v).toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').includes(q);
  const hits = [];
  for (const l of book.loans) {
    const fields = isNumber
      ? [['customer', 'contact', l.contact], ['customer', 'momo', l.momo], ['receiver', 'momo', l.recipient_momo], ['guarantor', 'contact', l.guarantor_contact]]
      : [['customer', 'name', l.full_name], ['receiver', 'name', l.recipient_full_name], ['guarantor', 'name', l.guarantor_name]];
    const where = fields.filter(f => has(f[2])).map(f => ({ party: f[0], field: f[1], value: S_(f[2]) }));
    if (where.length) hits.push({ t: 'loan', where, with: loanSummary(l) });
  }
  for (const d of book.deck.rows || []) {
    const fields = isNumber
      ? [['customer', 'contact', d.contact], ['guarantor', 'contact', d.guarantor_contact]]
      : [['customer', 'name', d.full_name], ['guarantor', 'name', d.guarantor_name]];
    const where = fields.filter(f => has(f[2])).map(f => ({ party: f[0], field: f[1], value: S_(f[2]) }));
    if (where.length) hits.push({ t: 'def', where, with: defSummary(d) });
  }
  hits.sort((a, b) => ((a.t === 'def') - (b.t === 'def'))
    || String(b.with.approvedDate || b.with.deckDate || '').localeCompare(String(a.with.approvedDate || a.with.deckDate || '')));
  return {
    ok: true, q: raw, kind: isNumber ? 'number' : 'name', hits: hits.slice(0, FIND_MAX), total: hits.length,
    scanned: { loans: book.loans.length, defaults: (book.deck.rows || []).length },
    deck: { date: book.deck.date || null }, scope: book.teams,
  };
}
