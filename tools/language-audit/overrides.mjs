// Texts the automatic splitter cannot read (a "/" that is a list, not a pair): written out by hand.
export const FIX = {
  '🔒 Orodha ya kusoma tu ya wafanyakazi wa zone zako ({1}). Ukiona jina linalokosekana, wadhifa, timu, simu au benki isiyo sahihi, tuma kwa HR / admin: JINA KAMILI (kama benki) · WADHIFA · TIMU · SIMU · BENKI + AKAUNTI · TIN. Marekebisho hufanywa na {2} au admin. / Read-only list of your zones\' staff. A missing name or a wrong role, team, phone or bank: send HR / admin full name (as at the bank) · role · team · phone · bank + account · TIN. Changes are made by {2} or an admin.': [{ type: 'pair',
    sw: '🔒 Orodha ya kusoma tu ya wafanyakazi wa zone zako ({1}). Ukiona jina linalokosekana, wadhifa, timu, simu au benki isiyo sahihi, tuma kwa HR / admin: JINA KAMILI (kama benki) · WADHIFA · TIMU · SIMU · BENKI + AKAUNTI · TIN. Marekebisho hufanywa na {2} au admin.',
    en: 'Read-only list of your zones\' staff. A missing name or a wrong role, team, phone or bank: send HR / admin full name (as at the bank) · role · team · phone · bank + account · TIN. Changes are made by {2} or an admin.' }],
  'Wadaiwa wapo ({1}), lakini hakuna aliyepangwa kwa GMO / MANAGER / BIKE. Angalia mgawanyo (ASSIGN_ACTIVE / EXPIRED / CHRONIC) kwenye Settings.': [{ type: 'sw', text: 'Wadaiwa wapo ({1}), lakini hakuna aliyepangwa kwa GMO / MANAGER / BIKE. Angalia mgawanyo (ASSIGN_ACTIVE / EXPIRED / CHRONIC) kwenye Settings.' }],
  '⚠️ Maombi {1} hayamfikii mtu isipokuwa admin / {1} request(s) reach nobody but an admin: {2}. Weka mwidhinishaji au timu ya zone hiyo kwenye Nafasi na ruhusa / Misimbo. / Set an approver, or give a code of the approver role a team in that zone, on Roles & access / Access codes.': [
    { type: 'pair', sw: '⚠️ Maombi {1} hayamfikii mtu isipokuwa admin', en: '{1} request(s) reach nobody but an admin: {2}.' },
    { type: 'pair', sw: 'Weka mwidhinishaji au timu ya zone hiyo kwenye Nafasi na ruhusa / Misimbo.', en: 'Set an approver, or give a code of the approver role a team in that zone, on Roles & access / Access codes.' }],
  'Tarehe ya ugunduzi / kikao / Date discovered (meeting)': [{ type: 'pair', sw: 'Tarehe ya ugunduzi / kikao', en: 'Date discovered (meeting)' }],
  'Andika maamuzi / maelezo. / Write the decision.': [{ type: 'pair', sw: 'Andika maamuzi / maelezo.', en: 'Write the decision.' }],
  'Ugunduzi / kikao / Discovered': [{ type: 'pair', sw: 'Ugunduzi / kikao', en: 'Discovered' }],
  '🌴 Ombi la likizo / Ruhusa / Leave & holiday request': [{ type: 'pair', sw: '🌴 Ombi la likizo / Ruhusa', en: 'Leave & holiday request' }],
  'Kijani / green = {1} Nyekundu / red = imeshuka kuliko wiki iliyopita / lower than the week before. Nyeusi / black = imeshikilia au inapanda / holding or climbing.': [
    { type: 'pair', sw: 'Kijani', en: 'green' }, { type: 'pair', sw: 'Nyekundu', en: 'red' },
    { type: 'pair', sw: 'imeshuka kuliko wiki iliyopita', en: 'lower than the week before' }, { type: 'pair', sw: 'Nyeusi', en: 'black' },
    { type: 'pair', sw: 'imeshikilia au inapanda', en: 'holding or climbing' }],
  'Pakia Defaulters Initial na Current Defaulters ili kupima cleared / reduced / bad / static. / Both uploads are needed to measure the four states.': [{ type: 'pair', sw: 'Pakia Defaulters Initial na Current Defaulters ili kupima cleared / reduced / bad / static.', en: 'Both uploads are needed to measure the four states.' }],
  'Officers’ working list rebuilt: {1} customer(s) now visible in the app’s Def / Exp / Chr tabs.': [{ type: 'en', text: 'Officers’ working list rebuilt: {1} customer(s) now visible in the app’s Def / Exp / Chr tabs.' }],
  'Andika maamuzi / maelezo. / Write the decision (details).': [{ type: 'pair', sw: 'Andika maamuzi / maelezo.', en: 'Write the decision (details).' }],
  'Timu hazina majina ya viongozi / no leader names are set on the teams table, so there is nobody to group these teams under. Fill in the recovery / GMO / manager columns under Teams.': [{ type: 'pair', sw: 'Timu hazina majina ya viongozi', en: 'no leader names are set on the teams table, so there is nobody to group these teams under. Fill in the recovery / GMO / manager columns under Teams.' }],
  'Tafuta jina / ref / timu — search': [{ type: 'pair', sw: 'Tafuta jina / ref / timu', en: 'search' }],
  'Tafuta afisa / jina / ref / timu — search': [{ type: 'pair', sw: 'Tafuta afisa / jina / ref / timu', en: 'search' }],
};
