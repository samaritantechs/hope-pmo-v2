/* =====================================================================================
   CLAUDIAN-PMO'S FAQ -- the questions a role could ask, with their answers, written once.

     "when I switch the agen off, it shifts to FAQs only that are choices and answers a role could
      ask and get answers"                                    -- the owner, 25 Nov 2026 (handbook Part 155)

   WHAT THIS IS. A short list of choices for each person, and the answer behind each: no model,
   no tokens, no database read beyond the settings the answers quote. It is the whole of
   Claudian-PMO while the switch in Settings is OFF, and it is the first thing shown while the
   switch is ON (a person who taps a choice costs nothing; one who types costs a question).

   WHO SEES WHICH. An entry is for everybody (`any`), for the holders of a screen (`tabs`: any one
   of them), or for the phone app (`call`: 'any', or 'leader' only). The admin holds every screen,
   so sees every screen's entries. This is the same rule the model is held to: a person is told
   about the screens they may open and no others.

   THE ANSWERS ARE THE SYSTEM'S RULES, in the words the handbook gives them (the Part is named
   beside each). A figure that is a setting is a PLACEHOLDER filled from Settings at the moment of
   the answer ({minSecs}, {salesCust}, {salesAmt}, {ecolPct}, {colPct}, {recPct}, {recAmt},
   {callsDay}, {advAmounts}): the owner changes a target in Settings and the answer follows. Swahili first in each entry, as the
   screens are; the owner reads the Swahili and corrects it (the same order of work as the
   language audit, Part 153).

   KEYS (handbook Part 163). Each entry also carries `keys`, kept in claudian-faq-keys.js (data for the matcher, left out of the language audit): the Swahili and English words a
   person would type when they want that answer. The typing box is shown to everybody; with the AI off, or no key in the host's settings, a typed question is matched to these keys,
   in memory, by the same engine that picks the knowledge cards (claudian-match.js). The test (test/claudian-faq-match.test.mjs) makes every entry find itself from its own
   question in both languages and fails on a key so common that it touches most questions. AN ENTRY ADDED HERE GETS ITS KEYS THERE, IN THE SAME COMMIT.

   WHAT THE OWNER WILL DO WITH IT: read the chats (the Hope Ai tab), see which questions people
   actually ask, and say which entries to add, change or drop. So an entry is cheap to add: one
   object below, one line of test.
   ===================================================================================== */

import { FAQ_KEYS } from './claudian-faq-keys.js';

/* =====================================================================================
   WHAT A PERSON IS TOLD, ALWAYS, WHEN A CALL DID NOT TICK THE CUSTOMER (handbook Part 165).

     "I called a customer but Amepigiwa leo did not appear" had 26 taps by 24 people ... always give them instructions of clossing app and re-opening so as to
      allow permissions or re-install the app from https://github.com/samaritantechs/hope-pmo-v2/releases/download/hope-calls-apk/HOPE-Calls.apk
                                                                                                                                 -- the owner, 26 Nov 2026

   The tick comes from a call that SYNCED, and a call reaches the system only when the app can read the phone's call log: a permission refused, never asked, or taken away by the
   phone leaves the app running and every call unseen. So the answer to this concern ends with the same instruction every time, in the words the owner gave: close the app completely and open it
   again so that it asks for its permissions (and allow them), or install it again from the release link. ONE DEFINITION: the ready answer below and the typed question the model answers
   (claudian.js appends it, exactly, whatever the model wrote) both use PERMISSIONS_HINT; the link is the app's own (app-version.json apkUrl: a test holds the two equal).
   ===================================================================================== */
export const APK_URL = 'https://github.com/samaritantechs/hope-pmo-v2/releases/download/hope-calls-apk/HOPE-Calls.apk';
export const PERMISSIONS_HINT = {
  sw: 'Ikiwa alama bado haionekani: funga programu kabisa kisha uifungue tena ili iombe ruhusa, na uzikubali. Ikiendelea, isakinishe upya kutoka hapa: ' + APK_URL,
  en: 'If it still does not appear: close the app completely and open it again so it asks for its permissions, and allow them. If it still does not, install the app again from here: ' + APK_URL,
};
/** The ready answers whose instruction goes with EVERY answer to the same concern, a typed one answered by the model included (the entry's id: its hint). */
export const ALWAYS_HINT = { 'call-not-ticked': PERMISSIONS_HINT };

const ENTRIES = [
  // ---- for everybody ----
  { id: 'portfolio-call', any: true,
    sw: { q: 'Simu ya portfolio ni nini?', a: 'Ni simu kwa namba ya mteja wa timu zako, ya mdhamini wake, au namba uliyoandika kwenye "Ana namba nyingine", ipokelewe au isipokelewe. Simu nyingine ni "nje ya portfolio". Namba moja huhesabiwa mara moja kwa siku hata ukiipigia mara nyingi, na muda wa mazungumzo ni wa simu za portfolio tu. Mteja anapata alama ya "Amepigiwa leo" simu kwa namba yake au ya mdhamini ikizidi sekunde {minSecs}.' },
    en: { q: 'What is a portfolio call?', a: 'A call, answered or not, to the number of a customer of your teams, their guarantor, or the number recorded under "Ana namba nyingine"; any other call is "nje ya portfolio". A number counts once a day however many times you dial it, and talk time counts portfolio calls only. A customer shows "Amepigiwa leo" once a call to their own or the guarantor\'s number lasts longer than {minSecs} seconds.' } },
  { id: 'targets', any: true,
    sw: { q: 'Malengo ya kampuni ni yapi?', a: 'Malengo ya kila timu: mauzo wateja {salesCust}+ na TZS {salesAmt}+ kwa siku; makusanyo ya awali (Early Col) {ecolPct}%+ kwa siku; makusanyo {colPct}%; urejeshaji {recPct}% kwa kiasi cha TZS {recAmt}+; simu za portfolio {callsDay}+ kwa siku. Njia ya kuvifikia ni simu za portfolio kila siku kwa wateja wote wa orodha yako.' },
    en: { q: 'What are the company targets?', a: 'Each team\'s targets: sales {salesCust}+ customers and TZS {salesAmt}+ a day; early collection {ecolPct}%+ a day; collection {colPct}%; recovery {recPct}% with amounts from TZS {recAmt}; portfolio calls {callsDay}+ a day. The way to reach them is portfolio calls every day to every customer on your list.' } },
  { id: 'improve', any: true,
    sw: { q: 'Nifanye nini ili kufikia malengo?', a: 'Anza na simu za portfolio: piga kila mteja wa orodha ya leo (Exp.Def, Def, Exp), andika ahadi za kulipa na uzifuatilie siku ya ahadi. Lengo ni simu {callsDay}+ kwa siku, makusanyo {colPct}% na urejeshaji {recPct}%.' },
    en: { q: 'What should I do to reach the targets?', a: 'Start with portfolio calls: call every customer on today\'s list (Exp.Def, Def, Exp), record promises to pay and follow them up on the promised day. The aim is {callsDay}+ calls a day, collection {colPct}% and recovery {recPct}%.' } },
  { id: 'reached', any: true,
    sw: { q: 'Reached % inamaanisha nini?', a: 'Ni asilimia ya namba ulizopigia ambazo mlizungumza kwa zaidi ya sekunde {minSecs}. Simu iliyoita bila kupokelewa, au iliyokatika ndani ya sekunde hizo, haihesabiwi kuwa imefikiwa.' },
    en: { q: 'What does Reached % mean?', a: 'The share of the numbers you rang that you spoke to for longer than {minSecs} seconds. A call that rang out, or ended inside that time, does not count as reached.' } },
  { id: 'percentages', any: true,
    sw: { q: 'Makusanyo %, Urejeshaji % na Mauzo % ni nini?', a: 'Makusanyo % = kilichokusanywa ÷ kilichotarajiwa. Urejeshaji % = kilichorejeshwa ÷ kisichokusanywa (kilichotarajiwa ambacho hakijakusanywa). Mauzo % = mauzo ÷ lengo la wiki la timu.' },
    en: { q: 'What are Collection %, Recovery % and Sales %?', a: 'Collection % = collected ÷ expected. Recovery % = recovered ÷ the uncollected (expected and not collected). Sales % = sales ÷ the team\'s weekly target.' } },
  { id: 'dc-ds', any: true,
    sw: { q: 'D.C na D.S zinamaanisha nini?', a: 'D.C = idadi ya malipo yaliyokosekana. D.S = malipo yaliyolipwa kati ya yaliyotakiwa (3-6 ni 3 kati ya 6).' },
    en: { q: 'What do D.C and D.S mean?', a: 'D.C = installments missed. D.S = installments paid of those due (3-6 is 3 of 6).' } },
  { id: 'no-access', any: true,
    sw: { q: 'Kwa nini sioni ukurasa au wateja fulani?', a: 'Unachoona kinategemea cheo chako, timu ulizopewa na kurasa ulizoruhusiwa. Ukihitaji ukurasa mwingine, mwambie admin akutikie kwenye "Nafasi na ruhusa".' },
    en: { q: 'Why can I not see a screen or some customers?', a: 'What you see depends on your role, your teams and the screens you were granted. If you need another screen, ask the admin to tick it under "Roles & access".' } },

  // ---- the phone app ----
  { id: 'call-not-ticked', call: 'any',
    sw: { q: 'Nimempigia mteja lakini hajapata alama ya "Amepigiwa leo"?', a: 'Alama inatokea simu iliyosawazishwa kwa namba ya mteja au ya mdhamini ikizidi sekunde {minSecs}, ikipigwa na mtu yeyote leo. Simu kwa "Ana namba nyingine" haileti alama hii, ingawa inahesabiwa kuwa simu ya portfolio. Fungua programu ili isawazishe, kisha angalia tena.\n\n' + PERMISSIONS_HINT.sw },
    en: { q: 'I called a customer but "Amepigiwa leo" did not appear?', a: 'The tick shows once a synced call, by anyone today, to the customer\'s own number or the guarantor\'s lasted longer than {minSecs} seconds. A call to the "Ana namba nyingine" number does not tick the customer, though it still counts as a portfolio call. Open the app so it syncs, then look again.\n\n' + PERMISSIONS_HINT.en } },
  { id: 'call-other-number', call: 'any',
    sw: { q: 'Nirekodi wapi namba nyingine ya mteja?', a: 'Kwenye kadi ya mteja (gusa jina lake) weka namba hiyo kwenye "Ana namba nyingine". Simu kwa namba hiyo zitahesabiwa kama simu za portfolio za mteja huyo.' },
    en: { q: 'Where do I record another number for a customer?', a: 'On the customer\'s card (tap the name) enter it under "Ana namba nyingine". Calls to that number then count as portfolio calls for that customer.' } },
  { id: 'call-lists', call: 'any',
    sw: { q: 'Orodha za Leo, Kesho, Def, Exp na Chr ni nini?', a: 'Leo: wateja wanaotarajiwa kulipa leo. Kesho: wa siku ya kazi inayofuata. Def: waliochelewa kulipa. Exp: mikopo iliyokwisha muda (Expired). Chr: ya muda mrefu (chronic). Exp.Def ni orodha ya wateja wa mzunguko wa siku; kila afisa anayo.' },
    en: { q: 'What are the Leo, Kesho, Def, Exp and Chr lists?', a: 'Leo: customers expected to pay today. Kesho: the next working day\'s. Def: defaulters. Exp: expired loans. Chr: chronic. Exp.Def is the day\'s expected-defaulters list; every officer has it.' } },
  { id: 'call-search', call: 'any',
    sw: { q: 'Namtafutaje mteja?', a: 'Tumia kisanduku cha kutafuta: andika jina, REF au namba ya simu. Kadi ya mteja inaonyesha deni, rejesho na hali yake.' },
    en: { q: 'How do I find a customer?', a: 'Use the search box: type the name, REF or phone number. The customer\'s card shows the arrears, the installment and the status.' } },
  { id: 'call-report', call: 'leader',
    sw: { q: 'Ripoti ya simu inaonyesha nini?', a: 'Kwa kila afisa: simu, muda wa mazungumzo ya portfolio, simu nje ya portfolio, asilimia ya portfolio na Reached %.' },
    en: { q: 'What does the calls report show?', a: 'For each officer: calls, portfolio talk time, non-portfolio calls, the portfolio share and Reached %.' } },

  // ---- the portal, by screen ----
  { id: 'dash-arrows', tabs: ['dashboard'],
    sw: { q: 'Mishale ▲ ▼ kwenye Dashibodi inamaanisha nini?', a: 'Inalinganisha wiki hii na wiki iliyopita; nambari hafifu kando ya mshale ni ya wiki iliyopita yenyewe. Siku ambayo haijafika haina mshale kwenye kadi za maombi na mauzo.' },
    en: { q: 'What do the ▲ ▼ arrows on the Dashboard mean?', a: 'They compare this week with last week; the faint figure beside an arrow is last week\'s own. A day that has not come yet carries no arrow on the applications and sales cards.' } },
  { id: 'expdef-list', tabs: ['defexp', 'expdfrep'],
    sw: { q: 'Orodha ya Expected Defaulters ya leo inatoka wapi?', a: 'Ni faili la asubuhi (initial) la siku hiyo: wateja ambao leo ni siku yao ya mzunguko. Mteja aliyelipa anabaki kwenye orodha akiwa "CLEARED" kama amerejesha. Faili la jioni (karibu saa 2 usiku) likiwa halijapakiwa, marejesho yanaonyesha 0.' },
    en: { q: 'Where does today\'s Expected Defaulters list come from?', a: 'It is the day\'s morning (initial) file: the customers whose cycle day is today. A customer who paid stays on the list as "CLEARED" with what was recovered. Until the later file (about 20:00) is uploaded, recovered shows 0.' } },
  { id: 'expdef-report', tabs: ['expdfrep'],
    sw: { q: 'Exp.Def Report inaonyesha nini?', a: 'Kwa kila kiongozi: wateja wake wa siku, wiki au mwezi, deni, kilichorejeshwa na Rec %. Siku inasomwa kutoka faili lake la asubuhi.' },
    en: { q: 'What does the Exp.Def Report show?', a: 'For each leader: their customers for the day, week or month, the amount owed, what was recovered and Rec %. A day is read from its own morning file.' } },
  { id: 'followup-record', tabs: ['followup', 'promises'],
    sw: { q: 'Nirekodije ufuatiliaji wa mteja?', a: 'Fungua mteja kwenye Defaulters Followup, weka hali ya ufuatiliaji na maoni; kama ameahidi kulipa, weka tarehe na kiasi cha ahadi. Ahadi zinaonekana kwenye Promise to Pay.' },
    en: { q: 'How do I record a follow-up?', a: 'Open the customer in Defaulters Followup, set the follow-up status and write the comment; if they promised to pay, enter the promise date and amount. Promises show on Promise to Pay.' } },
  { id: 'calls-report', tabs: ['calls'],
    sw: { q: 'Call Reports inaonyesha nini?', a: 'Kwa kila afisa: simu, muda wa mazungumzo ya portfolio, simu nje ya portfolio, asilimia ya portfolio na Reached % (kwa simu zilizozidi sekunde {minSecs}).' },
    en: { q: 'What do the Call Reports show?', a: 'For each officer: calls, portfolio talk time, non-portfolio calls, the portfolio share and Reached % (for calls longer than {minSecs} seconds).' } },
  { id: 'legal-notice', tabs: ['legal'],
    sw: { q: 'Notisi ya madai inatolewa lini?', a: 'Mteja awe na D.C 2 au zaidi, au D.S 11-12, na notisi yake ya mwisho iwe imefutika (amelipa au ametoka kwenye orodha). Notisi ya pili haitolewi wakati ya kwanza haijafutika.' },
    en: { q: 'When can a demand notice be issued?', a: 'The customer must be at D.C 2 or more, or at D.S 11-12, and their last notice must be cleared (paid, or off the list). A second notice is not issued while the first is not cleared.' } },
  { id: 'deduct-earners', tabs: ['deduct'],
    sw: { q: 'Malipo ya walioripoti yanahesabiwaje?', a: 'Kila kesi ya kipekee inalipa kiasi kilichokuwa kinatumika siku kesi iliporipotiwa (admin huweka kiasi kutoka tarehe fulani). Jedwali pia linaonyesha cheo na zone ya aliyeripoti.' },
    en: { q: 'How are the reporters\' earnings worked out?', a: 'Each unique case earns the amount in force on the day it was reported (the admin sets an amount from a date). The table also shows the reporter\'s role and zone.' } },
  { id: 'advance-ask', tabs: ['advreq'],
    sw: { q: 'Naombaje advance ya mshahara?', a: 'Fungua "Omba advance", chagua jina lako kwenye orodha ya kanda yako na kiasi ({advAmounts}). Ni ombi moja kwa mwezi; ombi lililokataliwa halikuzuii kuomba tena.' },
    en: { q: 'How do I request a salary advance?', a: 'Open "Advance request", pick your name from your zone\'s list and an amount ({advAmounts}). One request a month; a disapproved request does not use up the month.' } },
  { id: 'advance-approve', tabs: ['advappr'],
    sw: { q: 'Nakubali vipi maombi ya advance?', a: 'Fungua "Idhini ya advance", chagua ombi moja au weka alama kwa wengi, kisha kubali au kataa kwa maoni. Fedha wakifunga mwezi (Finalize), idhini nazo zinafungwa.' },
    en: { q: 'How do I approve advance requests?', a: 'Open "Advance approval", pick one request or tick several, then approve or disapprove with a comment. Once Finance finalizes the month, approvals close too.' } },
  { id: 'advance-finalize', tabs: ['advfinal'],
    sw: { q: 'Finalize inafanya nini?', a: 'Inafunga mwezi kwa maombi mapya na kwa idhini; Reopen inaufungua tena. Ni kazi ya Fedha pekee.' },
    en: { q: 'What does Finalize do?', a: 'It closes the month for new requests and for approvals; Reopen opens it again. It is Finance\'s alone.' } },
  { id: 'leave-ask', tabs: ['leavereq'],
    sw: { q: 'Naombaje likizo?', a: 'Fungua "Omba likizo", chagua jina lako, tarehe na sababu. Ukishachagua jina, skrini hiyo hiyo inaonyesha siku zako za mwaka, zilizotumika, zinazosubiri na zilizobaki ("Zilizobaki"). Likizo ya mwaka ni siku 26 (admin anaweza kuibadilisha kwenye Ripoti ya likizo) na inaanza upya kila mwaka wa kalenda; idhini inafuata njia ileile ya advance.' },
    en: { q: 'How do I request leave?', a: 'Open "Leave request", pick your name, the dates and the reason. Once you pick your name the same screen shows your annual days, the days taken and pending, and the days remaining ("Remaining"). Annual leave is 26 days (the admin can change it on the Leave report) and starts again each calendar year; approval follows the same route as advances.' } },
  { id: 'teams-leaders', tabs: ['teams'],
    sw: { q: 'Kiongozi wa timu anabadilishwaje?', a: 'Viongozi huchukuliwa kutoka kwenye misimbo ya kuingia (Settings): ukibadilisha jina kwenye msimbo, Teams & Staff inafuata mara moja kwa timu za msimbo huo.' },
    en: { q: 'How is a team\'s leader changed?', a: 'Leaders come from the access codes (Settings): change the name on a code and Teams & Staff follows at once for that code\'s teams.' } },
  { id: 'settings-claudian', tabs: ['settings'],
    sw: { q: 'Nawashaje Claudian-PMO?', a: 'Kwenye Settings, kadi ya Claudian-PMO: bonyeza swichi iwe ON. Inahitaji ufunguo wa API kwenye mipangilio ya seva; kikomo cha maswali kwa siku kinawekwa hapohapo. Kisanduku cha kuandika kinaonekana kwa kila mtu: AI ikiwa OFF (au hakuna ufunguo), swali lililoandikwa hujibiwa kwa jibu la kawaida linalolifaa, na yasiyopata jibu yanaorodheshwa kwenye kichupo cha Hope Ai.' },
    en: { q: 'How do I switch Claudian-PMO on?', a: 'In Settings, on the Claudian-PMO card, press the switch to ON. It needs the API key in the server\'s settings; the questions-a-day limits are set there too. The typing box is shown to everybody: with the AI OFF (or no key) a typed question is answered from the ready answer that fits it, and the ones nothing fitted are listed on the Hope Ai tab.' } },
  { id: 'hopeai-read', tabs: ['hopeai'],
    sw: { q: 'Nasomaje mazungumzo ya Claudian-PMO?', a: 'Fungua kichupo cha Hope Ai: kila mstari ni mazungumzo ya mtu mmoja kwa siku moja, yenye cheo, timu na idadi ya maswali. Gusa mstari kusoma maswali na majibu yote; chini ya orodha kuna ripoti kwa cheo, timu na siku.' },
    en: { q: 'How do I read what people asked Claudian-PMO?', a: 'Open the Hope Ai tab: each row is one person\'s chat for one day, with role, teams and the number of questions. Tap a row to read every question and answer; under the list are boards by role, team and day.' } },
];

/** The catalogue as every reader sees it: each entry with its `keys` (claudian-faq-keys.js: the words a person types to ask for it; data for the matcher, never shown). */
export const FAQ = ENTRIES.map(e => ({ ...e, keys: FAQ_KEYS[e.id] || [] }));

const langOf = l => (String(l || '').toLowerCase().startsWith('en') ? 'en' : 'sw');

/** Whether a person may be offered an entry. A portal person holds `tabs` (the admin holds every one: the portal gives an ADMIN every tab, and
    a view-only code the whole portal); the phone app has no tabs, only `call` entries, and `leader` ones for a leader. */
export function faqAllowed(entry, subject) {
  if (entry.any) return true;
  if (!subject) return false;
  if (subject.source === 'call') {
    if (!entry.call) return false;
    return entry.call === 'any' || (entry.call === 'leader' && !!subject.leader);
  }
  if (entry.call) return false;
  if (!entry.tabs) return false;
  if (subject.allTabs) return true;
  const have = new Set((subject.tabs || []).map(String));
  return entry.tabs.some(t => have.has(t));
}

/** The choices for a person: [{ id, q }] in their language. */
export function faqChoices(subject, lang) {
  const l = langOf(lang);
  return FAQ.filter(e => faqAllowed(e, subject)).map(e => ({ id: e.id, q: e[l].q }));
}

/** Fills the placeholders of an answer from the settings' figures; a placeholder with no figure is left as it is. */
export function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null && vars[k] !== '' ? String(vars[k]) : m));
}

/** The words of a ready question (for a choice, or a note): null when there is no such entry. It is the question, never the answer: it carries nothing a person must not read. */
export function faqLabel(id, lang) {
  const e = FAQ.find(x => x.id === id);
  return e ? e[langOf(lang)].q : null;
}

/** One answer, or null when the entry does not exist or the person may not be offered it (a question id cannot be used to read another screen's text). */
export function faqAnswer(id, subject, lang, vars) {
  const e = FAQ.find(x => x.id === id);
  if (!e || !faqAllowed(e, subject)) return null;
  const l = langOf(lang);
  return { id: e.id, q: e[l].q, a: fill(e[l].a, vars) };
}

