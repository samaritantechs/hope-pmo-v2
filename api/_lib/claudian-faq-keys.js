/* =====================================================================================
   THE KEYS OF THE READY ANSWERS -- the words a person types when they want one (handbook Part 163).

     "People ain't seeing the keypad to ask agent.. there are only opts"      -- the owner, 25 Nov 2026

   DATA FOR THE MATCHER (claudian-match.js), never shown to anybody and left out of the language audit like the other files the helper reads for itself. One list for each ready
   answer of claudian-faq.js, in Swahili and English together, written so that a question typed the way staff type (slang, abbreviations, no spaces, a typo, English words mixed in)
   touches it. The engine is the knowledge cards' own (claudian-cards.js `keyHit`):

     - a key of three letters or fewer is a WHOLE word ("def", "exp", "dc");
     - a longer key is a STEM and touches any word that holds it ("tafut" touches "natafutaje", "kutafuta", "nimtafute"), so a stem and its longer form are NOT both listed (the lint
       fails on it: one word would count twice); a key of seven letters or more also forgives one slip in a word;
     - a key joined by underscores is a PHRASE: its words one after the other ("d_c" is "D.C", "ana_namba_nyingine" the field of that name), each a whole word or, from four letters, the start of one;
     - an ORDINARY word of the two languages (claudian-match.js FAQ_COMMON) weighs half: two of them together answer, one alone only offers the entry as a choice.

   TOPIC WORDS go in each of the few entries of their topic (collection, recovery, advance: at most three entries share a key, the test fails on a fourth); INTENT WORDS (what to do, what is
   the target, how is it worked out, where do I switch it) go in the one entry they mean. A key is a word of the two languages, never a person, a customer, a team or a figure.

   MEASURED, NOT TRUSTED. These were tuned on questions written by other people than their author (test/fixtures/claudian-faq-questions.json) and the test holds the rates they reached.
   When a ready answer is added or changed, its keys are written here in the same commit and put to questions somebody else wrote.
   ===================================================================================== */
export const FAQ_KEYS = {
  'portfolio-call': ['portfolio', 'nje_ya', 'non_portfolio', 'hesabiwa', 'count_as', 'mdhamini', 'guarantor', 'simu_gani', 'which_calls'],
  'targets': ['lengo', 'target', 'goal', 'kiwango', 'takiwa', 'company', 'kampuni', 'early_col', 'ecol', 'yapi', 'makusanyo', 'urejeshaji', 'collection', 'recovery', 'mauzo', 'sales', 'simu_za_portfolio', 'hit'],
  'improve': ['kufikia', 'boresha', 'improve', 'to_reach', 'reach_the', 'reach_my', 'reach_our', 'reach_target', 'nyuma', 'behind', 'ushauri', 'advice', 'nifanye', 'should_i_do', 'how_to_reach', 'ongez', 'increase', 'lengo', 'target', 'rekebisha', 'tips', 'nianze', 'nianzie', 'start', 'chini', 'low', 'hit', 'makusanyo', 'urejeshaji', 'collection', 'recovery'],
  'reached': ['reached', 'fikiwa', 'connected', 'zilizopokelewa', 'zungumza', 'spoke_to', 'spoken_to', 'reached_percent', 'reach_percent'],
  'percentages': ['makusanyo', 'urejeshaji', 'collection', 'recovery', 'mauzo', 'sales', 'asilimia', 'percent', 'hesabiwa', 'calculated', 'formula', 'rec', 'col', 'divided', 'tofauti', 'difference', 'inatokaje', 'inapimwa', 'worked_out'],
  'dc-ds': ['d_c', 'd_s', 'dc', 'ds', 'installment', 'instalment', 'yaliyokosekana', 'yaliyolipwa', 'missed_installments', 'vifupisho'],
  'no-access': ['sioni', 'kwa_nini_sioni', 'why_cant_i_see', 'siwezi_kuona', 'cannot_see', 'cant_see', 'can_t_see', 'dont_see', 'not_see', 'kurasa', 'tab_missing', 'ruhusa', 'access', 'permission', 'nafasi_na_ruhusa', 'kutikiwa', 'granted', 'hakuna_tab', 'menu', 'page', 'tab', 'siwaoni', 'umefichwa', 'hidden', 'wenzangu'],
  'call-not-ticked': ['pigiwa', 'tick', 'tiki', 'alama', 'marked', 'haijaonekana', 'haionekani', 'hajapata_alama', 'grey_tick', 'kijivu', 'mdhamini', 'guarantor', 'bado_anaonekana'],
  'call-other-number': ['namba_nyingine', 'namba_mpya', 'namba_ya_pili', 'namba_mbili', 'another_number', 'other_number', 'new_number', 'second_number', 'second_phone', 'extra_number', 'extra_phone', 'another_phone', 'add_number', 'badilisha_namba', 'kuongeza_namba', 'mumewe', 'mkewe', 'ndugu', 'relative', 'spouse', 'wife', 'husband', 'rekodi'],
  'call-lists': ['def', 'exp', 'chr', 'chronic', 'expired', 'kesho', 'lists', 'tabs', 'orodha_gani', 'aina_za_orodha', 'exp_def', 'leo_na_kesho', 'orodha_ya_leo', 'orodha_ya_kesho', 'kesho_list', 'leo_list', 'siku_ya_kazi'],
  'call-search': ['tafut', 'search', 'search_for', 'search_box', 'find', 'find_a', 'find_a_customer', 'look_up', 'lookup', 'find_customer', 'search_customer', 'kadi', 'customer_card', 'jina', 'kwa_ref', 'by_ref', 'kuona_deni'],
  'call-report': ['ripoti_ya_simu', 'ripoti_za_simu', 'call_report', 'calls_report', 'call_reports', 'ripoti', 'report', 'talk_time', 'muda_wa_mazungumzo', 'maafisa', 'officers', 'ripoti_ya_viongozi', 'ripoti_ya_maafisa', 'report_ya_simu', 'report_ya_maafisa'],
  'dash-arrows': ['mshale', 'arrow', 'dashboard', 'dashibodi', 'dashbodi', 'triangle', 'wiki_iliyopita', 'last_week', 'hafifu', 'faint', 'juu_na_chini', 'up_and_down'],
  'expdef-list': ['expected_defaulters', 'expected_defaulter', 'exp_def', 'cleared', 'initial', 'faili_la_asubuhi', 'morning_file', 'asubuhi', 'jioni', 'evening', 'morning', 'aliyelipa', 'waliolipa', 'paid', 'already_paid', 'bado_yupo', 'still_on_list', 'still_show', 'recovered', 'mzunguko', 'cycle', 'cycle_day', 'inatoka', 'inatoka_wapi', 'taken_from', 'which_file', 'what_file', 'chanzo', 'source'],
  'expdef-report': ['exp_def', 'exp_def_report', 'expdef_report', 'report_ya_exp_def', 'ripoti_ya_exp_def', 'rep', 'tl', 'kiongozi', 'viongozi', 'leader', 'rec_percent', 'deni', 'owed', 'week_or_month', 'wiki_au_mwezi'],
  'followup-record': ['ufuatiliaji', 'followup', 'follow_up', 'ahadi', 'ahidi', 'promise', 'promise_to_pay', 'maoni', 'comment', 'rekodi', 'record', 'kufuatilia', 'weka_ahadi', 'defaulters_followup'],
  'calls-report': ['ripoti_ya_simu', 'ripoti_za_simu', 'call_report', 'calls_report', 'call_reports', 'callreport', 'calls_tab', 'portfolio_share', 'non_portfolio', 'nje_ya_portfolio', 'ripoti', 'report', 'talk_time', 'muda_wa_mazungumzo', 'report_ya_simu', 'ripoti_ya_maafisa'],
  'legal-notice': ['notisi', 'notice', 'madai', 'demand', 'demand_notice', 'second_notice', 'sheria', 'legal', 'kutoa_notisi', 'issue_notice'],
  'deduct-earners': ['walioripoti', 'aliyeripoti', 'reporter', 'earners', 'earnings', 'malipo_ya_walioripoti', 'deduction', 'makato', 'kesi', 'kila_kesi', 'per_case', 'kwa_kesi', 'analipwa_kwa', 'analipwa_per', 'unique_case', 'unique_cases', 'rate', 'boost', 'kiasi_cha_kila_kesi'],
  'advance-ask': ['advance', 'mshahara', 'salary', 'omba', 'omba_advance', 'request_advance', 'how_to_request', 'reject', 'disapproved', 'kataliwa', 'next_month', 'mwezi_ujao'],
  'advance-approve': ['advance', 'kubali', 'approve', 'approval', 'idhini', 'kataa', 'reject', 'tick_several'],
  'advance-finalize': ['advance', 'finalize', 'finalise', 'reopen', 'fungwa', 'fungua', 'kufunga_mwezi', 'funga_mwezi', 'kufunga', 'close_month', 'closing_month', 'closed', 'finance', 'fedha', 'kufungua_tena'],
  'leave-ask': ['likizo', 'leave', 'omba', 'annual_leave', 'siku_za_likizo', 'siku_26', 'leave_days', 'omba_likizo', 'naomba_leave', 'omba_leave', 'remaining_leave', 'request_leave', 'apply_leave', 'apply_for_leave', 'for_leave', 'leave_balance', 'leave_request', 'take_leave', 'my_leave', 'days_off', 'time_off'],
  'teams-leaders': ['kiongozi', 'viongozi', 'leader', 'change', 'badili', 'change_leader', 'change_team_leader', 'change_a_team_leader', 'team_leader', 'team_leaders', 'who_leads', 'hama', 'mweka', 'weka_kiongozi', 'new_leader', 'replace', 'mwingine', 'gmo', 'msimbo', 'misimbo', 'access_code', 'teams_staff', 'teams_and_staff', 'team_s_leader'],
  'settings-claudian': ['claudian', 'washa', 'kuzima', 'zima_claudian', 'zima_ai', 'swichi', 'switch', 'turn', 'enable', 'disable', 'switch_on', 'turn_on', 'switch_ai', 'ai_key', 'ufunguo', 'ai_on', 'ai_off', 'api_key', 'keypad', 'machaguo', 'choices', 'options', 'opts', 'box', 'typing', 'kuandika', 'sanduku', 'ask_box', 'maswali_ya_kawaida', 'ready_questions', 'standard_questions', 'limit', 'kikomo', 'daily_limit', 'maswali_kwa_siku', 'questions_a_day'],
  'hopeai-read': ['claudian', 'mazungumzo', 'hope_ai', 'hopeai', 'chats', 'soma_mazungumzo', 'what_people_asked', 'people_asked', 'asked', 'uliza', 'waliyouliza', 'walioulizwa', 'walichouliza', 'wanachouliza', 'maswali_ya_watu', 'maswali_ya_staff', 'read_chats', 'kuona_maswali', 'tumia', 'nani_anatumia', 'who_uses', 'staff_asked', 'what_staff', 'questions_asked', 'ai_questions', 'by_team', 'by_role'],
};
