-- =====================================================================================
-- RUN-ME-049 -- THE ANNUAL REPORT: the collection and recovery months the system did not see.
--
--   "stamp monthly collection and recovery data jan 2025 - july 2026 ... customer retention
--    comes from sales which we already have ... a new tab 'Annual' - this will always update the
--    annual statistics, GM wants to always have the report autoupdating"
--
-- The Annual tab (public/mod/annual.js, api/_lib/annual.js) reads a whole year per team and per
-- month: sales, count, first-time and repeat customers from the LOANS TABLE (every sale since
-- April 2024 is there, so those are never stamped), and collection, early collection and
-- recovery from the MONTH LEDGER the month report fills (August 2026 onward, the months the
-- HOPE Loan app has run). The months before the app are only in the annual workbooks, so this
-- file carries them into `team_months`, and the tab reads a month from here when it has rows
-- and from the ledger when it has not.
--
-- WHAT IS STAMPED, AND WHAT IS NOT
--   2025         The 2025 workbook kept no monthly collection or recovery figures at all -- only
--                the year's collection % and PAR per team (COLLECTION = 100 - PAR, PAR = total
--                def / total loan, as the 2025 report defined them). So 2025 gets ONE YEAR ROW per
--                team (ym = '2025') with that collection %, total def and PAR, plus the year's
--                leaders as the 2025 FINAL sheet named them. 2025's months show sales only.
--   2026 Jan-Jul One row per team per month: EXPECTED, COLLECTED, UNCOLLECTED, EARLY COL %,
--                RECOVERED, exactly as the monthly sheets stand (February-April's collected
--                column repeats March's in the workbook; stamped as kept). An early-collection %
--                of 0 is NOT recorded as 0: February-April carry 0 for every team and a few teams
--                carry 0 in a measured month, and 0 would drag a year's average down for a month
--                nobody measured. It is stamped NULL and the tab says "not measured".
--   2026 Aug+    Not stamped. The system has those months itself.
--   Sales        Never stamped -- see above. The tab judges every month's sales against the
--                SALES_TARGET_WEEKLY x 4 target, the same rule as the month report.
--   Leaders      The 2026 month rows carry NO leader names: a team's holders come from Teams &
--                Staff as it stands today. (How a leader who moved teams should carry the months
--                they actually held is a separate decision -- the columns are here for it.)
--
-- Team names are the workbook's, upper-cased and trimmed ("GONGOLAMBOTO ", "Tunduru" and
-- "TENGERU- USARIVER " become GONGOLAMBOTO, TUNDURU, TENGERU- USARIVER). The tab joins a stamped
-- row to the registry on letters and digits only, so a hyphen or a space that differs between the
-- sheet and Teams & Staff still lands on one row.
--
-- SAFE TO RE-RUN: every insert is `on conflict (team, ym) do update`. OPTIONAL like every
-- migration here: without this table the Annual tab opens on the loans table and the ledger and
-- says the stamps are missing; without the function below it sums the year's sales on the server
-- and says so. Paste the whole file; nothing here is slow (a few hundred small rows and one
-- function). The index at the very end is the only line that touches a large table.
-- =====================================================================================

create table if not exists team_months (
  team text not null,
  ym text not null,                       -- 'YYYY-MM' for a month; 'YYYY' for a figure only the year measured
  source text not null default 'sheet',   -- 'sheet' = from an annual workbook
  -- the month's collection, as the workbook kept it
  expected numeric(14,2),
  collected numeric(14,2),
  uncollected numeric(14,2),
  ecol_pct numeric(7,2),                  -- early collection %; the sheets kept only the percentage
  recovered numeric(14,2),
  -- a year row: the collection the year was closed on (2025: 100 - PAR)
  col_pct numeric(7,2),
  total_def numeric(14,2),
  par_pct numeric(7,2),
  -- who held the team, as the sheet named them; blank = whoever holds it on Teams & Staff now
  opm text, pmo text, credit text, manager text, gmo text, legal text, region text, zone text, bike text, early_col text,
  note text,
  stamped_at timestamptz not null default now(),
  primary key (team, ym)
);

-- =====================================================================================
-- THE YEAR'S SALES, SUMMED BY THE DATABASE: one row per team per month, instead of every sale of
-- the year crossing the wire to be added up on the server (tens of thousands of rows for a few
-- hundred numbers). Same shape and scoping as loan_totals_by_team (RUN-ME-047): the stages that
-- count as a sale come from the caller (SALES_STAGES), p_teams null is every team, compared
-- upper-cased and trimmed. TRK1 is a track number of 1 -- a first-time customer; the rest are
-- retained. principal = the sale (principal, or the loan amount where principal is blank);
-- loan_amt = principal + interest (the TOTAL LOAN column of the annual report).
-- =====================================================================================
create or replace function loan_month_totals_by_team(p_from date, p_to date, p_teams text[] default null, p_stages text[] default null)
returns table (team text, ym text, loans bigint, trk1 bigint, principal numeric, loan_amt numeric)
language sql
stable
as $$
  select l.team,
         to_char(l.approved_date, 'YYYY-MM'),
         count(*)::bigint,
         (count(*) filter (where btrim(coalesce(l.track_no, '')) ~ '^0*1(\.0+)?$'))::bigint,
         coalesce(sum(coalesce(l.principal_amt, l.loan_amt, 0)), 0)::numeric,
         coalesce(sum(coalesce(l.loan_amt, coalesce(l.principal_amt, 0) + coalesce(l.interest_amt, 0))), 0)::numeric
  from loans l
  where l.approved_date >= p_from and l.approved_date <= p_to
    and (p_stages is null or l.stage::text = any (p_stages))
    and (p_teams is null or upper(btrim(coalesce(l.team, ''))) = any (select upper(btrim(t)) from unnest(p_teams) t))
  group by l.team, to_char(l.approved_date, 'YYYY-MM')
$$;

grant execute on function loan_month_totals_by_team(date, date, text[], text[]) to service_role;

-- ------------------------------------------------------------------------------------
-- 2025: ONE YEAR ROW PER TEAM -- the collection % and PAR the 2025 report closed on, and the year's leaders.
-- ------------------------------------------------------------------------------------
insert into team_months (team, ym, source, col_pct, total_def, par_pct, opm, pmo, credit, manager, gmo, legal, region, bike, early_col, note) values
  ('BABATI', '2025', 'sheet', 97.66, 2697898, 2.34, 'PATRICK', 'BARAKA HAGAI', 'FLORENCE', 'JACK FAIDA', 'BARAKA', 'EMMANUEL NASSARI', 'MANYARA', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('BOMA NGOMBE', '2025', 'sheet', 94.40, 12043187, 5.60, 'PATRICK', 'BARAKA HAGAI', 'FLORENCE', 'ADAMA MAPHIE', 'BARAKA', 'EMMANUEL NASSARI', 'KILIMANJARO', 'ALLY SHEIZA', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('BUZWAGI A', '2025', 'sheet', 93.90, 24587166, 6.10, 'GERALD', 'ADAMU ADAMU', 'LUCAS', 'IDDY SIMBA', 'SHAFII', 'ALFRED MSAFIRI', 'KAHAMA', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('BUZWAGI B', '2025', 'sheet', 96.51, 14706687, 3.49, 'GERALD', 'ADAMU ADAMU', 'LUCAS', 'IDDY SIMBA', 'SHAFII', 'ALFRED MSAFIRI', 'KAHAMA', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('CHALINZE', '2025', 'sheet', 93.46, 29501704, 6.54, 'PATRICK', 'BARAKA HAGAI', 'LUCAS', 'RAMA DENGULE', 'SULEIMAN', 'REGINA NJAU', 'PWANI', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('CHAMWINO', '2025', 'sheet', 95.35, 17406489, 4.65, 'GERALD', 'ADAMU ADAMU', 'PRICIA', 'MATOLA', 'KHALILU', 'JOACHIM ISSA', 'DODOMA', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('CHANIKA', '2025', 'sheet', 91.59, 78788463, 8.41, 'PATRICK', 'BARAKA HAGAI', 'MWANGA', 'PHILEMON', null, 'SAID MPANYU', 'DAR ES SALAAM', 'HAMIS', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('DODOMA CBD', '2025', 'sheet', 94.82, 19107360, 5.18, 'GERALD', 'ADAMU ADAMU', 'PRICIA', 'MATOLA', 'KHALILU', 'JOACHIM ISSA', 'DODOMA', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('GEITA', '2025', 'sheet', 99.74, 225672, 0.26, 'GERALD', 'RAPHAEL MGIMWA', 'LUCAS', 'ZABRON', 'SHAFII', 'ALFRED MSAFIRI', 'GEITA', null, null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('GOBA', '2025', 'sheet', 91.45, 80664062, 8.55, 'PATRICK', 'RAPHAEL MGIMWA', 'RIWA', 'JACK CLEMENCE', 'CHRISS', 'ISSA KARATA', 'DAR ES SALAAM', 'ALEX', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('GONGOLAMBOTO', '2025', 'sheet', 90.34, 63543235, 9.66, 'PATRICK', 'ASHIRAFU MOHAMED', 'MATRONA', 'ISSA TAPULE', null, 'SAID MPANYU', 'DAR ES SALAAM', 'HAMIS', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('IPURI', '2025', 'sheet', 99.54, 384170, 0.46, 'GERALD', 'RAPHAEL MGIMWA', 'PRICIA', 'JUSTINE', 'JUSTINE', 'SAID MPANYU', 'TABORA', 'SIMON', null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('IRINGA A', '2025', 'sheet', 95.19, 12529523, 4.81, 'GERALD', 'ADAMU ADAMU', 'HASSAN', 'SIMKANGA', null, 'ISSA KARATA', 'IRINGA', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('IRINGA B', '2025', 'sheet', 94.42, 14768788, 5.58, 'GERALD', 'ADAMU ADAMU', 'HASSAN', 'SIMKANGA', null, 'ISSA KARATA', 'IRINGA', 'KASMILI', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KABWE', '2025', 'sheet', 96.18, 36225018, 3.82, 'GERALD', 'ASHIRAFU MOHAMED', 'ALLY', 'NATHAN', 'MOZEE', 'JOACHIM ISSA', 'MBEYA', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KATORO A', '2025', 'sheet', 99.58, 381003, 0.42, 'GERALD', 'ADAMU ADAMU', 'LUCAS', 'PHILIPO', 'SHAFII', 'ALFRED MSAFIRI', 'GEITA', null, null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KATORO B', '2025', 'sheet', 99.89, 67677, 0.11, 'GERALD', 'ADAMU ADAMU', 'LUCAS', 'PHILIPO', 'SHAFII', 'ALFRED MSAFIRI', 'GEITA', null, null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KIGAMBONI A', '2025', 'sheet', 95.33, 56163735, 4.67, 'PATRICK', 'ADAMU ADAMU', 'MWANGA', 'BARAKA', 'CHRISS', 'ISSA KARATA', 'DAR ES SALAAM', 'FRANK', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KIGAMBONI B', '2025', 'sheet', 94.38, 16668471, 5.62, 'PATRICK', 'ADAMU ADAMU', 'MWANGA', 'BARAKA', 'CHRISS', 'ISSA KARATA', 'DAR ES SALAAM', 'FRANK', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KIHONDA A', '2025', 'sheet', 95.65, 26781788, 4.35, 'GERALD', 'ASHIRAFU MOHAMED', 'ALLY', 'ANOLD', 'KHALILU', 'REGINA NJAU', 'MOROGORO', 'MWISHEHE', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KIHONDA B', '2025', 'sheet', 95.52, 29398722, 4.48, 'GERALD', 'ASHIRAFU MOHAMED', 'ALLY', 'ANOLD', 'KHALILU', 'REGINA NJAU', 'MOROGORO', 'MWISHEHE', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KIJENGE-NJIRO', '2025', 'sheet', 97.39, 31043287, 2.61, 'PATRICK', 'BARAKA HAGAI', 'FLORENCE', 'ALLEN', 'BARAKA', 'EMMANUEL NASSARI', 'ARUSHA', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KIJICHI', '2025', 'sheet', 92.19, 87769613, 7.81, 'PATRICK', 'RAPHAEL MGIMWA', 'MATRONA', 'MOHAMED', 'MATHEO', 'SAID MPANYU', 'DAR ES SALAAM', 'ATHUMANI', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KIMARA', '2025', 'sheet', 91.92, 62392412, 8.08, 'PATRICK', 'RAPHAEL MGIMWA', 'MWANGA', 'WILLIAM MLEKWA', 'SULEIMAN', 'ALFRED MSAFIRI', 'DAR ES SALAAM', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('KONGOWE', '2025', 'sheet', 92.36, 58066477, 7.64, 'PATRICK', 'ASHIRAFU MOHAMED', 'MWANGA', 'DITRICK', 'SULEIMAN', 'REGINA NJAU', 'PWANI', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MABIBO', '2025', 'sheet', 92.35, 64133930, 7.65, 'PATRICK', 'RAPHAEL MGIMWA', 'RIWA', 'JACK ALDO', 'CHRISS', 'ISSA KARATA', 'DAR ES SALAAM', 'NYEMO', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MAFINGA', '2025', 'sheet', 99.08, 1474122, 0.92, 'GERALD', 'BARAKA HAGAI', 'HASSAN', 'HENRY', null, 'ISSA KARATA', 'IRINGA', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MAJENGO', '2025', 'sheet', 95.22, 44849646, 4.78, 'PATRICK', 'BARAKA HAGAI', 'FLORENCE', 'JOEL', 'BARAKA', 'EMMANUEL NASSARI', 'ARUSHA', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MAKAMBAKO A', '2025', 'sheet', 95.25, 3624872, 4.75, 'GERALD', 'ASHIRAFU MOHAMED', 'HASSAN', 'WILLIAM THOMAS', null, 'JOACHIM ISSA', 'NJOMBE', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MAKAMBAKO B', '2025', 'sheet', 97.92, 1748945, 2.08, 'GERALD', 'ASHIRAFU MOHAMED', 'HASSAN', 'WILLIAM THOMAS', null, 'JOACHIM ISSA', 'NJOMBE', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MBAGALA', '2025', 'sheet', 93.65, 55733514, 6.35, 'PATRICK', 'RAPHAEL MGIMWA', 'MATRONA', 'MOHAMED', 'MATHEO', 'SAID MPANYU', 'DAR ES SALAAM', 'ATHUMANI', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MBALIZI', '2025', 'sheet', 96.66, 12929802, 3.34, 'GERALD', 'ASHIRAFU MOHAMED', 'ALLY', 'NATHAN', 'MOZEE', 'JOACHIM ISSA', 'MBEYA', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MBEZI', '2025', 'sheet', 92.62, 65080968, 7.38, 'PATRICK', 'RAPHAEL MGIMWA', 'MWANGA', 'WILLIAM MLEKWA', 'SULEIMAN', 'ALFRED MSAFIRI', 'DAR ES SALAAM', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MOROMBOO', '2025', 'sheet', 94.65, 36548384, 5.35, 'PATRICK', 'BARAKA HAGAI', 'FLORENCE', 'KENNY', 'BARAKA', 'EMMANUEL NASSARI', 'ARUSHA', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MSAMVU', '2025', 'sheet', 95.43, 36404063, 4.57, 'GERALD', 'ASHIRAFU MOHAMED', 'ALLY', 'EMMANUEL', 'KHALILU', 'REGINA NJAU', 'MOROGORO', 'MWISHEHE', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MTWARA TOWN', '2025', 'sheet', 99.88, 100014, 0.12, 'PATRICK', 'ADAMU ADAMU', 'MATRONA', 'DIWANI', null, 'SAID MPANYU', 'MTWARA', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MUSOMA', '2025', 'sheet', 100, 0, 0, 'GERALD', 'BARAKA HAGAI', 'LUCAS', 'IBRAHIM', null, 'EMMANUEL NASSARI', 'MARA', null, null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('MWINYI', '2025', 'sheet', 99.85, 90670, 0.15, 'GERALD', 'RAPHAEL MGIMWA', 'PRICIA', 'JUSTINE', 'JUSTINE', 'SAID MPANYU', 'TABORA', null, null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('NJOMBE', '2025', 'sheet', 99.90, 77010, 0.10, 'GERALD', 'ASHIRAFU MOHAMED', 'HASSAN', 'GEORGE MAGESA', null, 'REGINA NJAU', 'NJOMBE', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('NJOMBE B', '2025', 'sheet', 99.92, 55606, 0.08, 'GERALD', 'ASHIRAFU MOHAMED', 'HASSAN', 'GEORGE MAGESA', null, 'REGINA NJAU', 'NJOMBE', 'BRUNO', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('SEGEREA', '2025', 'sheet', 96.74, 36215783, 3.26, 'PATRICK', 'BARAKA HAGAI', 'RIWA', 'SADICK', 'SULEIMAN', 'ALFRED MSAFIRI', 'DAR ES SALAAM', 'DENIS', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('SINGIDA', '2025', 'sheet', 99.70, 317336, 0.30, 'PATRICK', 'BARAKA HAGAI', 'PRICIA', 'TAJIR MOLLEL', 'BARAKA', 'EMMANUEL NASSARI', 'SINGIDA', null, null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('SINZA', '2025', 'sheet', 94.62, 68978661, 5.38, 'PATRICK', 'RAPHAEL MGIMWA', 'RIWA', 'JACK ALDO', 'CHRISS', 'ISSA KARATA', 'DAR ES SALAAM', 'NYEMO', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('SUA', '2025', 'sheet', 94.84, 53611654, 5.16, 'GERALD', 'ASHIRAFU MOHAMED', 'ALLY', 'EMMANUEL', 'KHALILU', 'REGINA NJAU', 'MOROGORO', 'MWISHEHE', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('TABATA', '2025', 'sheet', 95.11, 41475991, 4.89, 'PATRICK', 'BARAKA HAGAI', 'RIWA', 'SADICK', 'SULEIMAN', 'ALFRED MSAFIRI', 'DAR ES SALAAM', 'DENIS', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('TABORA TOWN', '2025', 'sheet', 99.96, 21672, 0.04, 'GERALD', 'RAPHAEL MGIMWA', 'PRICIA', 'JUSTINE', 'JUSTINE', 'REGINA NJAU', 'TABORA', null, null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('TARIME', '2025', 'sheet', 100, 0, 0, 'GERALD', 'BARAKA HAGAI', 'LUCAS', 'JULIUS WAMBURA', null, 'EMMANUEL NASSARI', 'MARA', null, null, '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('TEGETA', '2025', 'sheet', 91.65, 83036896, 8.35, 'PATRICK', 'RAPHAEL MGIMWA', 'RIWA', 'JACK CLEMENCE', 'CHRISS', 'ISSA KARATA', 'DAR ES SALAAM', 'ALEX', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('TEMEKE', '2025', 'sheet', 93.04, 71814812, 6.96, 'PATRICK', 'ASHIRAFU MOHAMED', 'MATRONA', 'AMBILIKE', 'MATHEO', 'SAID MPANYU', 'DAR ES SALAAM', 'HAMIS', 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('TENGERU- USARIVER', '2025', 'sheet', 94.51, 44620575, 5.49, 'PATRICK', 'BARAKA HAGAI', 'FLORENCE', 'ADAMA MAPHIE', 'BARAKA', 'EMMANUEL NASSARI', 'ARUSHA', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('TUNDUMA', '2025', 'sheet', 98.17, 6713002, 1.83, 'GERALD', 'ADAMU ADAMU', 'LUCAS', 'SIJALI', 'MOZEE', 'JOACHIM ISSA', 'SONGWE', null, 'XAVERY', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('VIKINDU', '2025', 'sheet', 91.09, 17963863, 8.91, 'PATRICK', 'RAPHAEL MGIMWA', 'MATRONA', 'NESTORY', null, 'SAID MPANYU', 'PWANI', 'NESTORY', 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept'),
  ('VWAWA', '2025', 'sheet', 98.92, 845674, 1.08, 'GERALD', 'ADAMU ADAMU', 'LUCAS', 'SIJALI', 'MOZEE', 'JOACHIM ISSA', 'SONGWE', null, 'SAID', '2025 annual report: collection = 100 - PAR; no monthly collection or recovery was kept')
on conflict (team, ym) do update set
  source = excluded.source, col_pct = excluded.col_pct, total_def = excluded.total_def, par_pct = excluded.par_pct,
  opm = excluded.opm, pmo = excluded.pmo, credit = excluded.credit, manager = excluded.manager, gmo = excluded.gmo,
  legal = excluded.legal, region = excluded.region, bike = excluded.bike, early_col = excluded.early_col,
  note = excluded.note, stamped_at = now();

-- ------------------------------------------------------------------------------------
-- JANUARY 2026: 59 teams
-- ------------------------------------------------------------------------------------
insert into team_months (team, ym, source, expected, collected, uncollected, ecol_pct, recovered) values
  ('BABATI', '2026-01', 'sheet', 42171255, 34140075, 8031180, 76.97, 6209034),
  ('BOMA NGOMBE', '2026-01', 'sheet', 47061549, 32658782, 14402767, 58.24, 10400497),
  ('BUZWAGI A', '2026-01', 'sheet', 66435857, 53472972, 12962885, 71.71, 7200258),
  ('BUZWAGI B', '2026-01', 'sheet', 75978611, 61608349, 14370262, 71.56, 10275870),
  ('CHALINZE', '2026-01', 'sheet', 66656914, 50516553, 16140361, 64.22, 9041712),
  ('CHAMWINO', '2026-01', 'sheet', 87175965, 69459755, 17716210, 73.76, 13473259),
  ('CHANIKA', '2026-01', 'sheet', 73451201, 55041323, 18409878, 70.72, 16894552),
  ('DODOMA CBD', '2026-01', 'sheet', 85872676, 63368370, 22504306, 69.28, 14834839),
  ('GEITA', '2026-01', 'sheet', 40306942, 40236604, 70338, 97.88, 1444021),
  ('GOBA', '2026-01', 'sheet', 85045281, 68983134, 16062147, 72.69, 11417184),
  ('GONGOLAMBOTO', '2026-01', 'sheet', 54836337, 42470693, 12365644, 75, 8367856),
  ('IPURI', '2026-01', 'sheet', 41661338, 38190575, 3470763, 86.15, 1914676),
  ('IRINGA A', '2026-01', 'sheet', 76658615, 59699364, 16959251, 75.63, 10173140),
  ('IRINGA B', '2026-01', 'sheet', 66770309, 49300802, 17469507, 67.79, 11630475),
  ('KABWE', '2026-01', 'sheet', 99631248, 68230896, 31400352, 58.07, 13841693),
  ('KARATU', '2026-01', 'sheet', 4204784, 4204784, 0, 100, 0),
  ('KATORO A', '2026-01', 'sheet', 41638616, 37727487, 3911129, 89.05, 1577870),
  ('KATORO B', '2026-01', 'sheet', 30832328, 29620122, 1212206, 89.61, 1013559),
  ('KIGAMBONI A', '2026-01', 'sheet', 84212274, 63942182, 20270092, 65.24, 18774984),
  ('KIGAMBONI B', '2026-01', 'sheet', 63608293, 43047662, 20560631, 60.80, 11513746),
  ('KIHONDA A', '2026-01', 'sheet', 54536009, 46251128, 8284881, 76.78, 6574862),
  ('KIHONDA B', '2026-01', 'sheet', 59516935, 49086229, 10430706, 71.21, 7084337),
  ('KIJENGE-NJIRO', '2026-01', 'sheet', 91397579, 77894417, 13503162, 75.71, 11316428),
  ('KIJICHI', '2026-01', 'sheet', 85288932, 60369853, 24919079, 64.42, 11361258),
  ('KIMARA', '2026-01', 'sheet', 78568298, 64325182, 14243116, 70.50, 11548606),
  ('KONGOWE', '2026-01', 'sheet', 70793648, 66282219, 4511429, 90.07, 4527887),
  ('MABIBO', '2026-01', 'sheet', 61998971, 50676702, 11322269, 74.30, 10017468),
  ('MAFINGA', '2026-01', 'sheet', 68696886, 57328009, 11368877, 73.25, 6460284),
  ('MAJENGO', '2026-01', 'sheet', 93290221, 70097604, 23192617, 61.95, 12397606),
  ('MAKAMBAKO A', '2026-01', 'sheet', 31642703, 27696318, 3946385, 80.22, 1637466),
  ('MAKAMBAKO B', '2026-01', 'sheet', 34271978, 28355618, 5916360, 71.79, 2813118),
  ('MBAGALA', '2026-01', 'sheet', 69898242, 53933931, 15964311, 71.18, 8436780),
  ('MBALIZI', '2026-01', 'sheet', 59227940, 49544613, 9683327, 77.69, 9243489),
  ('MBARALI', '2026-01', 'sheet', null, null, null, null, 0),
  ('MBEZI', '2026-01', 'sheet', 99597237, 91532701, 8064536, 89.24, 14596857),
  ('MBINGA', '2026-01', 'sheet', 192685, 192685, 0, 83.34, 0),
  ('MOROMBOO', '2026-01', 'sheet', 76958873, 60685050, 16273823, 64.67, 9579341),
  ('MSAMVU', '2026-01', 'sheet', 61075264, 54793616, 6281648, null, 5798536),
  ('MTWARA TOWN', '2026-01', 'sheet', 39655331, 38527781, 1127550, 79.89, 1887913),
  ('MUSOMA', '2026-01', 'sheet', 45866187, 45286181, 580006, 94.86, 368356),
  ('MWINYI', '2026-01', 'sheet', 31943051, 29692548, 2250503, 89.34, 2153493),
  ('NJOMBE', '2026-01', 'sheet', 34719550, 33957284, 762266, 77.47, 1022012),
  ('NJOMBE B', '2026-01', 'sheet', 31568927, 30147258, 1421669, 88.77, 962513),
  ('SEGEREA', '2026-01', 'sheet', 109904830, 99559758, 10345072, 85.19, 11970641),
  ('SINGIDA', '2026-01', 'sheet', 50620319, 48913261, 1707058, 85.94, 1845513),
  ('SINZA', '2026-01', 'sheet', 115333585, 94284256, 21049329, 81.39, 16688579),
  ('SONGEA', '2026-01', 'sheet', 1088077, 1088077, 0, 92.88, 0),
  ('SUA', '2026-01', 'sheet', 74272961, 66552268, 7720693, 76.48, 8510074),
  ('SUMBAWANGA', '2026-01', 'sheet', null, null, null, null, 0),
  ('TABATA', '2026-01', 'sheet', 74839618, 61603165, 13236453, 83.91, 12660320),
  ('TABORA TOWN', '2026-01', 'sheet', 30044703, 28475329, 1569374, 81.47, 1696728),
  ('TARIME', '2026-01', 'sheet', 30452956, 30282956, 170000, 97.61, 170000),
  ('TEGETA', '2026-01', 'sheet', 90099956, 72492013, 17607943, 72.86, 14728967),
  ('TEMEKE', '2026-01', 'sheet', 89176255, 71802888, 17373367, 79.79, 9768510),
  ('TENGERU- USARIVER', '2026-01', 'sheet', 80659208, 62708628, 17950580, null, 17733816),
  ('TUNDUMA', '2026-01', 'sheet', 73309517, 66113794, 7195723, 82.00, 4321262),
  ('TUNDURU', '2026-01', 'sheet', null, null, null, null, 0),
  ('VIKINDU', '2026-01', 'sheet', 5184970, 880240, 4304730, null, 4827064),
  ('VWAWA', '2026-01', 'sheet', 36651930, 31384182, 5267748, 75.04, 2932378)
on conflict (team, ym) do update set
  source = excluded.source, expected = excluded.expected, collected = excluded.collected, uncollected = excluded.uncollected,
  ecol_pct = excluded.ecol_pct, recovered = excluded.recovered, stamped_at = now();

-- ------------------------------------------------------------------------------------
-- FEBRUARY 2026: 60 teams (early collection % not recorded this month)
-- ------------------------------------------------------------------------------------
insert into team_months (team, ym, source, expected, collected, uncollected, ecol_pct, recovered) values
  ('BABATI', '2026-02', 'sheet', 24400700, 21265835, 3134865, null, 3185565),
  ('BOMA NGOMBE', '2026-02', 'sheet', 28883012, 23333667, 5549345, null, 5450861),
  ('BUZWAGI A', '2026-02', 'sheet', 40845317, 32909724, 7935593, null, 5328963),
  ('BUZWAGI B', '2026-02', 'sheet', 48359345, 37690403, 10668942, null, 7388358),
  ('CHALINZE', '2026-02', 'sheet', 37632333, 31811504, 5820829, null, 3774873),
  ('CHAMWINO', '2026-02', 'sheet', 62361717, 53667284, 8694433, null, 6383631),
  ('CHANIKA', '2026-02', 'sheet', 44421003, 36437442, 7983561, null, 6893750),
  ('DODOMA CBD', '2026-02', 'sheet', 59885346, 46775381, 13109965, null, 8006246),
  ('GEITA', '2026-02', 'sheet', 35507295, 35291159, 216136, null, 611466),
  ('GOBA', '2026-02', 'sheet', 57312602, 51099139, 6213463, null, 6344508),
  ('GONGOLAMBOTO', '2026-02', 'sheet', 35529985, 30135922, 5394063, null, 6570090),
  ('IPURI', '2026-02', 'sheet', 44069684, 35876891, 8192793, null, 4320550),
  ('IRINGA A', '2026-02', 'sheet', 49016667, 42996350, 6020317, null, 6443978),
  ('IRINGA B', '2026-02', 'sheet', 47447038, 41034295, 6412743, null, 4744533),
  ('KABWE', '2026-02', 'sheet', 57635673, 41141007, 16494666, null, 6832732),
  ('KARATU', '2026-02', 'sheet', 21017806, 20838548, 179258, null, 579431),
  ('KATORO A', '2026-02', 'sheet', 33501321, 30576162, 2925159, null, 1062241),
  ('KATORO B', '2026-02', 'sheet', 28894312, 26938316, 1955996, null, 1829115),
  ('KIGAMBONI A', '2026-02', 'sheet', 54439696, 47705153, 6734543, null, 6210906),
  ('KIGAMBONI B', '2026-02', 'sheet', 44483346, 37650798, 6832548, null, 7349422),
  ('KIHONDA A', '2026-02', 'sheet', 35836094, 32056469, 3779625, null, 2773938),
  ('KIHONDA B', '2026-02', 'sheet', 39241714, 34775660, 4466054, null, 3646308),
  ('KIJENGE-NJIRO', '2026-02', 'sheet', 54060039, 49838369, 4221670, null, 4027847),
  ('KIJICHI', '2026-02', 'sheet', 53584013, 46277792, 7306221, null, 7017086),
  ('KIMARA', '2026-02', 'sheet', 48965666, 39672625, 9293041, null, 7245863),
  ('KONGOWE', '2026-02', 'sheet', 50393700, 48722956, 1670744, null, 3352901),
  ('KYELA', '2026-02', 'sheet', 4556281, 4556281, 0, null, 0),
  ('MABIBO', '2026-02', 'sheet', 41627344, 35492844, 6134500, null, 5534781),
  ('MAFINGA', '2026-02', 'sheet', 49923391, 46097628, 3825763, null, 4845745),
  ('MAJENGO', '2026-02', 'sheet', 55992346, 49664048, 6328298, null, 5646570),
  ('MAKAMBAKO A', '2026-02', 'sheet', 52666100, 41974760, 10691340, null, 5061056),
  ('MASASI', '2026-02', 'sheet', 2261130, 2261130, 0, null, 0),
  ('MBAGALA', '2026-02', 'sheet', 39644031, 35267300, 4376731, null, 4812707),
  ('MBALIZI', '2026-02', 'sheet', 36397036, 32963885, 3433151, null, 4957201),
  ('MBARALI', '2026-02', 'sheet', 7655808, 7655808, 0, null, 34000),
  ('MBEZI', '2026-02', 'sheet', 66974323, 61557978, 5416345, null, 7082696),
  ('MBINGA', '2026-02', 'sheet', 7701155, 7633155, 68000, null, 71340),
  ('MOROMBOO', '2026-02', 'sheet', 46206015, 37875170, 8330845, null, 4552400),
  ('MSAMVU', '2026-02', 'sheet', 40567703, 37635231, 2932472, null, 3179056),
  ('MTWARA TOWN', '2026-02', 'sheet', 33450395, 31644599, 1805796, null, 1814346),
  ('MUSOMA', '2026-02', 'sheet', 54910012, 54234841, 675171, null, 1626185),
  ('MWINYI', '2026-02', 'sheet', 38028999, 35353139, 2675860, null, 1725356),
  ('NJOMBE', '2026-02', 'sheet', 54139394, 50622425, 3516969, null, 3321968),
  ('SEGEREA', '2026-02', 'sheet', 71263940, 66421076, 4842864, null, 5410416),
  ('SENGEREMA', '2026-02', 'sheet', 2442506, 2442506, 0, null, 0),
  ('SINGIDA', '2026-02', 'sheet', 53261049, 49422146, 3838903, null, 1827624),
  ('SINZA', '2026-02', 'sheet', 69830343, 59639743, 10190600, null, 7143388),
  ('SONGEA', '2026-02', 'sheet', 18785297, 18718277, 67020, null, 327059),
  ('SUA', '2026-02', 'sheet', 51878413, 49316700, 2561713, null, 3348581),
  ('SUMBAWANGA', '2026-02', 'sheet', 5315544, 5315544, 0, null, 0),
  ('TABATA', '2026-02', 'sheet', 54133708, 48009277, 6124431, null, 5997717),
  ('TABORA TOWN', '2026-02', 'sheet', 34872673, 30248270, 4624403, null, 3607589),
  ('TARIME', '2026-02', 'sheet', 54433972, 52312274, 2121698, null, 1686858),
  ('TEGETA', '2026-02', 'sheet', 57448694, 47146740, 10301954, null, 9163726),
  ('TEMEKE', '2026-02', 'sheet', 57862377, 49758105, 8104272, null, 5863597),
  ('TENGERU- USARIVER', '2026-02', 'sheet', 48257357, 42554496, 5702861, null, 6395305),
  ('TUNDUMA', '2026-02', 'sheet', 56479712, 51711576, 4768136, null, 3810031),
  ('TUNDURU', '2026-02', 'sheet', 2266828, 2266828, 0, null, 0),
  ('VIKINDU', '2026-02', 'sheet', null, null, null, null, 1185050),
  ('VWAWA', '2026-02', 'sheet', 24485703, 21415973, 3069730, null, 2805276)
on conflict (team, ym) do update set
  source = excluded.source, expected = excluded.expected, collected = excluded.collected, uncollected = excluded.uncollected,
  ecol_pct = excluded.ecol_pct, recovered = excluded.recovered, stamped_at = now();

-- ------------------------------------------------------------------------------------
-- MARCH 2026: 63 teams (early collection % not recorded this month)
-- ------------------------------------------------------------------------------------
insert into team_months (team, ym, source, expected, collected, uncollected, ecol_pct, recovered) values
  ('BABATI', '2026-03', 'sheet', 38380375, 34466767, 3913608, null, 3695900),
  ('BOMA NGOMBE', '2026-03', 'sheet', 44171723, 39762675, 4409048, null, 4203842),
  ('BUNDA', '2026-03', 'sheet', 5213653, 5213653, 0, null, 0),
  ('BUZWAGI A', '2026-03', 'sheet', 52898382, 43031185, 9867197, null, 4510657),
  ('BUZWAGI B', '2026-03', 'sheet', 58315700, 49573249, 8742451, null, 6392052),
  ('CHALINZE', '2026-03', 'sheet', 46614039, 42715950, 3898089, null, 2154863),
  ('CHAMWINO', '2026-03', 'sheet', 95319020, 77610661, 17708359, null, 10928498),
  ('CHANIKA', '2026-03', 'sheet', 56836703, 51955169, 4881534, null, 4749256),
  ('DODOMA CBD', '2026-03', 'sheet', 85039620, 72999440, 12040180, null, 8143197),
  ('GEITA', '2026-03', 'sheet', 49430357, 48347906, 1082451, null, 1629485),
  ('GOBA', '2026-03', 'sheet', 64634001, 60273323, 4360678, null, 5097068),
  ('GONGOLAMBOTO', '2026-03', 'sheet', 47248689, 40495850, 6752839, null, 2945869),
  ('IPURI', '2026-03', 'sheet', 55720480, 48638149, 7082331, null, 5001833),
  ('IRINGA A', '2026-03', 'sheet', 74369361, 67118621, 7250740, null, 3476401),
  ('IRINGA B', '2026-03', 'sheet', 58638666, 53283457, 5355209, null, 3591555),
  ('KABWE', '2026-03', 'sheet', 70380042, 59348144, 11031898, null, 6008541),
  ('KARATU', '2026-03', 'sheet', 39853680, 35316089, 4537591, null, 2361735),
  ('KATORO A', '2026-03', 'sheet', 39972728, 38231896, 1740832, null, 2874175),
  ('KATORO B', '2026-03', 'sheet', 38760012, 35932469, 2827543, null, 2289054),
  ('KIGAMBONI A', '2026-03', 'sheet', 75213681, 67710744, 7502937, null, 7892477),
  ('KIGAMBONI B', '2026-03', 'sheet', 57335310, 52132721, 5202589, null, 4378969),
  ('KIGOMA', '2026-03', 'sheet', 53000378, 47739180, 5261198, null, 2716831),
  ('KIHONDA A', '2026-03', 'sheet', 51232402, 46832570, 4399832, null, 3094090),
  ('KIHONDA B', '2026-03', 'sheet', 79837725, 75434492, 4403233, null, 5328486),
  ('KIJENGE-NJIRO', '2026-03', 'sheet', 70918347, 58939679, 11978668, null, 4360187),
  ('KIJICHI', '2026-03', 'sheet', 68294665, 54959541, 13335124, null, 8833096),
  ('KIMARA', '2026-03', 'sheet', 72255675, 70407393, 1848282, null, 2721929),
  ('KONGOWE', '2026-03', 'sheet', 24004236, 23617307, 386929, null, 202714),
  ('KYELA', '2026-03', 'sheet', 57618681, 52981656, 4637025, null, 3307308),
  ('MABIBO', '2026-03', 'sheet', 81685004, 74235286, 7449718, null, 4075538),
  ('MAFINGA', '2026-03', 'sheet', 72391669, 69595136, 2796533, null, 4100078),
  ('MAJENGO', '2026-03', 'sheet', 81532029, 66613015, 14919014, null, 8229665),
  ('MAKAMBAKO A', '2026-03', 'sheet', 20921778, 20921778, 0, null, 0),
  ('MASASI', '2026-03', 'sheet', 58089035, 54908259, 3180776, null, 4702200),
  ('MBAGALA', '2026-03', 'sheet', 51430697, 47388743, 4041954, null, 3863251),
  ('MBALIZI', '2026-03', 'sheet', 24950420, 24895009, 55411, null, 55411),
  ('MBARALI', '2026-03', 'sheet', 96333269, 85682910, 10650359, null, 6523003),
  ('MBEZI', '2026-03', 'sheet', 23562162, 22636466, 925696, null, 528684),
  ('MBINGA', '2026-03', 'sheet', 58480020, 52850053, 5629967, null, 4418470),
  ('MOROMBOO', '2026-03', 'sheet', 56060377, 53089087, 2971290, null, 2514551),
  ('MSAMVU', '2026-03', 'sheet', 51600770, 50034918, 1565852, null, 1529192),
  ('MTWARA TOWN', '2026-03', 'sheet', 78698687, 74235170, 4463517, null, 74169),
  ('MUSOMA', '2026-03', 'sheet', 55686458, 53704974, 1981484, null, 1323784),
  ('MWINYI', '2026-03', 'sheet', 77446334, 68509476, 8936858, null, 5103769),
  ('NJOMBE', '2026-03', 'sheet', 91771572, 86462906, 5308666, null, 7001145),
  ('SEGEREA', '2026-03', 'sheet', 22644235, 22644235, 0, null, 0),
  ('SENGEREMA', '2026-03', 'sheet', 15373977, 15373977, 0, null, 0),
  ('SERENGETI', '2026-03', 'sheet', 3247236, 3247236, 0, null, 0),
  ('SHINYANGA', '2026-03', 'sheet', 68940619, 65580465, 3360154, null, 2119496),
  ('SINGIDA', '2026-03', 'sheet', 91346615, 87220573, 4126042, null, 12888167),
  ('SINZA', '2026-03', 'sheet', 46557470, 45848948, 708522, null, 484845),
  ('SONGEA', '2026-03', 'sheet', 72845045, 70688462, 2156583, null, 1705473),
  ('SUA', '2026-03', 'sheet', 25653133, 24743427, 909706, null, 319850),
  ('SUMBAWANGA', '2026-03', 'sheet', 78205718, 75612961, 2592757, null, 2519370),
  ('TABATA', '2026-03', 'sheet', 52020070, 47569251, 4450819, null, 3985794),
  ('TABORA TOWN', '2026-03', 'sheet', 92400596, 79453237, 12947359, null, 6629747),
  ('TARIME', '2026-03', 'sheet', 77752320, 64123999, 13628321, null, 8949492),
  ('TEGETA', '2026-03', 'sheet', 69921054, 65153496, 4767558, null, 4527351),
  ('TEMEKE', '2026-03', 'sheet', 65914666, 60747935, 5166731, null, 9720499),
  ('TENGERU- USARIVER', '2026-03', 'sheet', 74890702, 68625055, 6265647, null, 3920195),
  ('TUNDUMA', '2026-03', 'sheet', 15980206, 15887696, 92510, null, 150838),
  ('TUNDURU', '2026-03', 'sheet', 34232379, 29613445, 4618934, null, 1461200),
  ('VWAWA', '2026-03', 'sheet', null, null, null, null, 1254979)
on conflict (team, ym) do update set
  source = excluded.source, expected = excluded.expected, collected = excluded.collected, uncollected = excluded.uncollected,
  ecol_pct = excluded.ecol_pct, recovered = excluded.recovered, stamped_at = now();

-- ------------------------------------------------------------------------------------
-- APRIL 2026: 64 teams (early collection % not recorded this month)
-- ------------------------------------------------------------------------------------
insert into team_months (team, ym, source, expected, collected, uncollected, ecol_pct, recovered) values
  ('BABATI', '2026-04', 'sheet', 47056005, 41358183, 5697822, null, 2774683),
  ('BOMA NGOMBE', '2026-04', 'sheet', 55295338, 49207497, 6019254, null, 2798010),
  ('BUNDA', '2026-04', 'sheet', 21680918, 21390337, 98903, null, 90575),
  ('BUZWAGI A', '2026-04', 'sheet', 54179068, 44826227, 9307838, null, 5813507),
  ('BUZWAGI B', '2026-04', 'sheet', 67178371, 57027499, 9322869, null, 5081282),
  ('CHALINZE', '2026-04', 'sheet', 48438651, 46057277, 2213366, null, 1780510),
  ('CHAMWINO', '2026-04', 'sheet', 93924922, 77413428, 16050661, null, 9093693),
  ('CHANIKA', '2026-04', 'sheet', 60774982, 54288158, 6486824, null, 4895167),
  ('DODOMA CBD', '2026-04', 'sheet', 74391989, 66516534, 7437785, null, 5513366),
  ('GEITA', '2026-04', 'sheet', 67252069, 65370401, 1502805, null, 493383),
  ('GOBA', '2026-04', 'sheet', 72363276, 68642964, 3720312, null, 3973393),
  ('GONGOLAMBOTO', '2026-04', 'sheet', 49322667, 38154953, 11167714, null, 3501868),
  ('IPURI', '2026-04', 'sheet', 65665347, 60472885, 5192462, null, 2567472),
  ('IRINGA A', '2026-04', 'sheet', 76891048, 67017069, 9545307, null, 3215819),
  ('IRINGA B', '2026-04', 'sheet', 66112944, 60890346, 5222598, null, 5200535),
  ('KABWE', '2026-04', 'sheet', 78874373, 71347188, 7167185, null, 5113764),
  ('KARATU', '2026-04', 'sheet', 47231708, 34244480, 12869222, null, 3883906),
  ('KATORO A', '2026-04', 'sheet', 54485104, 52692497, 1792607, null, 876670),
  ('KATORO B', '2026-04', 'sheet', 54694867, 52371844, 2323023, null, 1397554),
  ('KIGAMBONI A', '2026-04', 'sheet', 79735625, 68357317, 10924976, null, 8387612),
  ('KIGAMBONI B', '2026-04', 'sheet', 62735676, 56540679, 5999920, null, 4754295),
  ('KIGOMA', '2026-04', 'sheet', 22854165, 22786165, 0, null, 39340),
  ('KIHONDA A', '2026-04', 'sheet', 54694612, 50891469, 3699304, null, 3071501),
  ('KIHONDA B', '2026-04', 'sheet', 54343269, 50202980, 4040689, null, 2457463),
  ('KIJENGE-NJIRO', '2026-04', 'sheet', 92933360, 88027625, 4241896, null, 4294968),
  ('KIJICHI', '2026-04', 'sheet', 76981613, 67179691, 9801922, null, 4110311),
  ('KIMARA', '2026-04', 'sheet', 71966676, 61425718, 10468958, null, 6312037),
  ('KONGOWE', '2026-04', 'sheet', 79627969, 77920540, 1632092, null, 2076049),
  ('KYELA', '2026-04', 'sheet', 39054585, 36426959, 2423626, null, 1808589),
  ('MABIBO', '2026-04', 'sheet', 68249284, 63659615, 3456329, null, 4275724),
  ('MAFINGA', '2026-04', 'sheet', 90490893, 78646206, 11674687, null, 4448101),
  ('MAJENGO', '2026-04', 'sheet', 83418915, 76827123, 4834793, null, 6810958),
  ('MAKAMBAKO A', '2026-04', 'sheet', 95857253, 74479483, 20394391, null, 6896229),
  ('MASASI', '2026-04', 'sheet', 40975745, 40451899, 217840, null, 279006),
  ('MBAGALA', '2026-04', 'sheet', 65002386, 60953158, 4049228, null, 4131135),
  ('MBALIZI', '2026-04', 'sheet', 56774306, 52446194, 4298112, null, 3537134),
  ('MBARALI', '2026-04', 'sheet', 40986969, 40593066, 359903, null, 98502),
  ('MBEZI', '2026-04', 'sheet', 102810298, 86880303, 14456663, null, 9638317),
  ('MBINGA', '2026-04', 'sheet', 36623719, 35855785, 743602, null, 584233),
  ('MOROMBOO', '2026-04', 'sheet', 60689998, 50698815, 9851873, null, 4719456),
  ('MSAMVU', '2026-04', 'sheet', 64628351, 58813579, 5551374, null, 2502173),
  ('MTWARA TOWN', '2026-04', 'sheet', 61347390, 58625328, 2655150, null, 2414851),
  ('MUSOMA', '2026-04', 'sheet', 85685580, 76611019, 9044561, null, 3497596),
  ('MWINYI', '2026-04', 'sheet', 72318018, 69285540, 2385813, null, 1967632),
  ('NJOMBE', '2026-04', 'sheet', 90009195, 78586729, 11398466, null, 4804510),
  ('NZEGA', '2026-04', 'sheet', 5927537, 5927537, 0, null, 0),
  ('SEGEREA', '2026-04', 'sheet', 108726293, 102713962, 6012331, null, 5022018),
  ('SENGEREMA', '2026-04', 'sheet', 40272971, 39913764, 359207, null, 186003),
  ('SERENGETI', '2026-04', 'sheet', 35552746, 35037574, 515172, null, 156173),
  ('SHINYANGA', '2026-04', 'sheet', 32334387, 32334387, 0, null, 0),
  ('SINGIDA', '2026-04', 'sheet', 76154257, 68812103, 7228154, null, 3094803),
  ('SINZA', '2026-04', 'sheet', 103212636, 95509110, 7703526, null, 6809011),
  ('SONGEA', '2026-04', 'sheet', 71847617, 64300870, 4609943, null, 5629453),
  ('SUA', '2026-04', 'sheet', 78081020, 72895189, 5061259, null, 3901638),
  ('SUMBAWANGA', '2026-04', 'sheet', 41729428, 39384690, 2277732, null, 1765698),
  ('TABATA', '2026-04', 'sheet', 87782277, 85067907, 2714370, null, 3645653),
  ('TABORA TOWN', '2026-04', 'sheet', 66447366, 58634385, 7381474, null, 5362798),
  ('TARIME', '2026-04', 'sheet', 95222670, 73527208, 21471394, null, 8279652),
  ('TEGETA', '2026-04', 'sheet', 71802266, 65643399, 6130867, null, 3177304),
  ('TEMEKE', '2026-04', 'sheet', 77423628, 71075835, 5799723, null, 5439639),
  ('TENGERU- USARIVER', '2026-04', 'sheet', 74284305, 64414770, 6872007, null, 8958084),
  ('TUNDUMA', '2026-04', 'sheet', 85345606, 75816293, 9529313, null, 4540574),
  ('TUNDURU', '2026-04', 'sheet', 27681709, 26321215, 1199160, null, 991396),
  ('VWAWA', '2026-04', 'sheet', 41168353, 33523099, 7492511, null, 2527798)
on conflict (team, ym) do update set
  source = excluded.source, expected = excluded.expected, collected = excluded.collected, uncollected = excluded.uncollected,
  ecol_pct = excluded.ecol_pct, recovered = excluded.recovered, stamped_at = now();

-- ------------------------------------------------------------------------------------
-- MAY 2026: 64 teams
-- ------------------------------------------------------------------------------------
insert into team_months (team, ym, source, expected, collected, uncollected, ecol_pct, recovered) values
  ('BABATI', '2026-05', 'sheet', 50654340, 45242886, 5169454, 80.59, 2998521),
  ('BOMA NGOMBE', '2026-05', 'sheet', 56689305, 48753277, 7868028, 78.44, 3127835),
  ('BUNDA', '2026-05', 'sheet', 35971911, 32098703, 3646544, 80.64, 1338978),
  ('BUZWAGI A', '2026-05', 'sheet', 57692363, 49226210, 8287811, 78.78, 3160025),
  ('BUZWAGI B', '2026-05', 'sheet', 70952359, 62212489, 8739870, 80.77, 3523207),
  ('CHALINZE', '2026-05', 'sheet', 49543745, 46559597, 2649480, 87.05, 2965160),
  ('CHAMWINO', '2026-05', 'sheet', 86496019, 78142188, 8250463, 79.12, 7474964),
  ('CHANIKA', '2026-05', 'sheet', 64231633, 55761403, 8379560, 75.58, 5952839),
  ('DODOMA CBD', '2026-05', 'sheet', 67263330, 63268646, 3604020, 82.52, 4777761),
  ('GEITA', '2026-05', 'sheet', 76511358, 73556479, 2269507, 93.85, 1871582),
  ('GOBA', '2026-05', 'sheet', 63426975, 59052304, 4307335, 83.68, 3880277),
  ('GONGOLAMBOTO', '2026-05', 'sheet', 52841672, 40424611, 12417061, 77.66, 4003249),
  ('IPURI', '2026-05', 'sheet', 69580960, 62512998, 7067962, 78.13, 3923754),
  ('IRINGA A', '2026-05', 'sheet', 73774371, 62348724, 11017883, 79.06, 4028856),
  ('IRINGA B', '2026-05', 'sheet', 58831400, 54146149, 4655251, 86.88, 2950468),
  ('KABWE', '2026-05', 'sheet', 86184341, 77554328, 8574341, 82.11, 4907232),
  ('KARATU', '2026-05', 'sheet', 46341996, 33160875, 12764118, 55.96, 4346735),
  ('KATORO A', '2026-05', 'sheet', 66708028, 64291454, 2416574, 93.88, 1027575),
  ('KATORO B', '2026-05', 'sheet', 68963353, 62492479, 6358868, 86.35, 1755690),
  ('KIGAMBONI A', '2026-05', 'sheet', 68311618, 57455506, 10856112, 74.70, 4558542),
  ('KIGAMBONI B', '2026-05', 'sheet', 51158618, 45129119, 5965489, 75.85, 3651359),
  ('KIGOMA', '2026-05', 'sheet', 57091885, 56785882, 0, 98.59, 306000),
  ('KIHONDA A', '2026-05', 'sheet', 59052369, 56131646, 2882389, 80.96, 2456970),
  ('KIHONDA B', '2026-05', 'sheet', 53119251, 48879421, 4103830, 81.72, 1987219),
  ('KIJENGE-NJIRO', '2026-05', 'sheet', 91029340, 85722337, 3978998, 82.28, 5068313),
  ('KIJICHI', '2026-05', 'sheet', 75389389, 69361387, 5705533, 76.65, 4806093),
  ('KIMARA', '2026-05', 'sheet', 64503609, 58039502, 6464107, 77.36, 3765783),
  ('KONGOWE', '2026-05', 'sheet', 80970987, 73767483, 7173504, 79.75, 4829200),
  ('KYELA', '2026-05', 'sheet', 51033971, 45815049, 4710079, 84.97, 3451427),
  ('MABIBO', '2026-05', 'sheet', 66894986, 61249680, 5645306, 79.65, 4370191),
  ('MAFINGA', '2026-05', 'sheet', 84982996, 69465723, 14796607, 73.38, 4999648),
  ('MAJENGO', '2026-05', 'sheet', 85192660, 80213476, 4979184, 86.36, 4458589),
  ('MAKAMBAKO A', '2026-05', 'sheet', 97659319, 82099887, 15081766, 76.41, 6336927),
  ('MASASI', '2026-05', 'sheet', 55986608, 54888743, 904865, 92.85, 679183),
  ('MBAGALA', '2026-05', 'sheet', 63239967, 58723100, 4516867, 82.65, 4925843),
  ('MBALIZI', '2026-05', 'sheet', 66702340, 61206339, 5066001, 84.72, 3288461),
  ('MBARALI', '2026-05', 'sheet', 48676738, 48076004, 464734, 98.28, 351735),
  ('MBEZI', '2026-05', 'sheet', 90275601, 80117166, 10158435, 83.19, 6332444),
  ('MBINGA', '2026-05', 'sheet', 44415376, 41028795, 3332346, 75.26, 1628595),
  ('MOROMBOO', '2026-05', 'sheet', 61477639, 52792051, 8060062, 72.47, 4078630),
  ('MSAMVU', '2026-05', 'sheet', 65580298, 59745082, 5616704, 83.60, 2575747),
  ('MTWARA TOWN', '2026-05', 'sheet', 64441304, 62365155, 1917639, 83.35, 1965914),
  ('MUSOMA', '2026-05', 'sheet', 80766936, 71963493, 8780113, 83.48, 3665535),
  ('MWINYI', '2026-05', 'sheet', 78823344, 74688115, 3931560, 83.15, 2950841),
  ('NJOMBE', '2026-05', 'sheet', 79304996, 68849425, 10455571, 77.81, 4517149),
  ('NZEGA', '2026-05', 'sheet', 40550982, 40106149, 376833, 98.80, 257164),
  ('SEGEREA', '2026-05', 'sheet', 104187272, 102422765, 1679507, 93.24, 3952946),
  ('SENGEREMA', '2026-05', 'sheet', 50348252, 47491031, 2755711, 91.99, 1842375),
  ('SERENGETI', '2026-05', 'sheet', 53498983, 47312546, 6186437, 78.61, 3573530),
  ('SHINYANGA', '2026-05', 'sheet', 56695097, 55047980, 1647117, 93.09, 610323),
  ('SINGIDA', '2026-05', 'sheet', 91533622, 80433987, 11009136, 74.12, 5599230),
  ('SINZA', '2026-05', 'sheet', 99115658, 85866684, 13238975, 84.52, 7695842),
  ('SONGEA', '2026-05', 'sheet', 74550681, 70466395, 3779309, 84.34, 2171889),
  ('SUA', '2026-05', 'sheet', 79735721, 72859177, 6593044, 77.89, 3356844),
  ('SUMBAWANGA', '2026-05', 'sheet', 57924739, 53360107, 4532632, 79.48, 2598465),
  ('TABATA', '2026-05', 'sheet', 90751643, 81999814, 8717829, 82.75, 5461525),
  ('TABORA TOWN', '2026-05', 'sheet', 72697624, 64206824, 8471800, 81.52, 4625485),
  ('TARIME', '2026-05', 'sheet', 82484009, 67956584, 14426074, 79.00, 5958747),
  ('TEGETA', '2026-05', 'sheet', 71218637, 67225853, 3868075, 91.95, 7341281),
  ('TEMEKE', '2026-05', 'sheet', 76596326, 67781726, 8814600, 82.07, 7998308),
  ('TENGERU- USARIVER', '2026-05', 'sheet', 70555658, 60561481, 8703668, 76.60, 7731625),
  ('TUNDUMA', '2026-05', 'sheet', 90678065, 83626471, 6688262, 85.49, 2849631),
  ('TUNDURU', '2026-05', 'sheet', 36000402, 34276989, 1613075, 83.34, 1429067),
  ('VWAWA', '2026-05', 'sheet', 49498360, 42917943, 6053779, 80.58, 2697679)
on conflict (team, ym) do update set
  source = excluded.source, expected = excluded.expected, collected = excluded.collected, uncollected = excluded.uncollected,
  ecol_pct = excluded.ecol_pct, recovered = excluded.recovered, stamped_at = now();

-- ------------------------------------------------------------------------------------
-- JUNE 2026: 64 teams
-- ------------------------------------------------------------------------------------
insert into team_months (team, ym, source, expected, collected, uncollected, ecol_pct, recovered) values
  ('BABATI', '2026-06', 'sheet', 58921954, 53229499, 5647619, 79.10, 2994229),
  ('BOMA NGOMBE', '2026-06', 'sheet', 61959348, 52762258, 9197090, 80.46, 3324236),
  ('BUNDA', '2026-06', 'sheet', 46953869, 39043218, 7668811, 79.05, 3832702),
  ('BUZWAGI A', '2026-06', 'sheet', 72045997, 66819636, 5226361, 86.89, 3166028),
  ('BUZWAGI B', '2026-06', 'sheet', 79565662, 72851380, 6714282, 84.42, 3548349),
  ('CHALINZE', '2026-06', 'sheet', 56836661, 53844116, 2812378, 86.81, 1921838),
  ('CHAMWINO', '2026-06', 'sheet', 101269048, 97597461, 3616685, 86.63, 5153028),
  ('CHANIKA', '2026-06', 'sheet', 63268403, 54911067, 8187337, 77.89, 6872579),
  ('DODOMA CBD', '2026-06', 'sheet', 77010085, 71149300, 5860785, 84.18, 4754633),
  ('GEITA', '2026-06', 'sheet', 95370003, 89739389, 5028599, 91.31, 4271702),
  ('GOBA', '2026-06', 'sheet', 76732338, 69105382, 7626956, 83.85, 4010632),
  ('GONGOLAMBOTO', '2026-06', 'sheet', 50909339, 40430876, 10478463, 75.38, 4255221),
  ('IPURI', '2026-06', 'sheet', 79174664, 66745470, 12404024, 81.35, 8509444),
  ('IRINGA A', '2026-06', 'sheet', 77837281, 72719005, 4846278, 88.19, 3178591),
  ('IRINGA B', '2026-06', 'sheet', 73921710, 69905392, 4016318, 90.88, 2936888),
  ('KABWE', '2026-06', 'sheet', 98957005, 88724535, 9959120, 81.84, 5597962),
  ('KARATU', '2026-06', 'sheet', 56779980, 46265875, 10313271, 70.95, 5979074),
  ('KATORO A', '2026-06', 'sheet', 85679967, 80649717, 4758250, 91.87, 2028355),
  ('KATORO B', '2026-06', 'sheet', 83730618, 72051310, 11384801, 80.53, 2735370),
  ('KIGAMBONI A', '2026-06', 'sheet', 66985669, 60830728, 5977931, 81.89, 3474543),
  ('KIGAMBONI B', '2026-06', 'sheet', 52121975, 45833211, 6016764, 77.56, 4080986),
  ('KIGOMA', '2026-06', 'sheet', 98027569, 89279350, 8553118, 77.71, 6067192),
  ('KIHONDA A', '2026-06', 'sheet', 66549310, 62312650, 4231562, 80.41, 3175041),
  ('KIHONDA B', '2026-06', 'sheet', 65671156, 57021789, 8487524, 79.05, 3339678),
  ('KIJENGE-NJIRO', '2026-06', 'sheet', 102039656, 96829805, 5194851, 86.28, 3225195),
  ('KIJICHI', '2026-06', 'sheet', 78364301, 68491998, 9625307, 81.10, 5881205),
  ('KIMARA', '2026-06', 'sheet', 66095981, 58281049, 7733932, 79.94, 4799946),
  ('KONGOWE', '2026-06', 'sheet', 77304684, 66517910, 10786774, 79.33, 4820302),
  ('KYELA', '2026-06', 'sheet', 56292638, 48690457, 7602181, 82.29, 3969243),
  ('MABIBO', '2026-06', 'sheet', 72527671, 66702319, 5372015, 80.88, 3916208),
  ('MAFINGA', '2026-06', 'sheet', 94990353, 82425895, 12028620, 82.78, 4155424),
  ('MAJENGO', '2026-06', 'sheet', 92117375, 85564094, 6553281, 81.48, 3910103),
  ('MAKAMBAKO A', '2026-06', 'sheet', 112194348, 96248003, 15708346, 76.10, 5540528),
  ('MASASI', '2026-06', 'sheet', 68504361, 67400519, 922672, 90.90, 1125514),
  ('MBAGALA', '2026-06', 'sheet', 68034000, 64415253, 3618747, 89.40, 3622734),
  ('MBALIZI', '2026-06', 'sheet', 84467344, 80037174, 4317156, 89.99, 3831183),
  ('MBARALI', '2026-06', 'sheet', 57868025, 57732025, 0, 99.81, 55000),
  ('MBEZI', '2026-06', 'sheet', 95290637, 85985688, 8398440, 89.32, 4379685),
  ('MBINGA', '2026-06', 'sheet', 56978349, 51815714, 5162635, 78.54, 2610013),
  ('MOROMBOO', '2026-06', 'sheet', 62786686, 56127678, 6320070, 81.93, 3010309),
  ('MSAMVU', '2026-06', 'sheet', 73287030, 66097414, 7079445, 81.81, 3801050),
  ('MTWARA TOWN', '2026-06', 'sheet', 82251753, 79446372, 2566859, 83.28, 2268159),
  ('MUSOMA', '2026-06', 'sheet', 85328674, 79456060, 5872614, 86.81, 3125217),
  ('MWINYI', '2026-06', 'sheet', 91340994, 84437336, 6825654, 81.33, 3436638),
  ('NJOMBE', '2026-06', 'sheet', 89249945, 78442640, 10807305, 80.68, 6681215),
  ('NZEGA', '2026-06', 'sheet', 74624413, 73354373, 1270040, 95.58, 643308),
  ('SEGEREA', '2026-06', 'sheet', 121708572, 117683104, 3912136, 89.54, 4371556),
  ('SENGEREMA', '2026-06', 'sheet', 47350645, 43047813, 4132834, 88.52, 1603396),
  ('SERENGETI', '2026-06', 'sheet', 53538604, 41437228, 12101376, 61.33, 6706511),
  ('SHINYANGA', '2026-06', 'sheet', 89397295, 81402484, 7635471, 85.84, 3764478),
  ('SINGIDA', '2026-06', 'sheet', 102572281, 96791107, 5582668, 79.52, 3422138),
  ('SINZA', '2026-06', 'sheet', 114455275, 100385795, 14069480, 83.76, 7188347),
  ('SONGEA', '2026-06', 'sheet', 90780031, 86483387, 4166539, 87.92, 2273143),
  ('SUA', '2026-06', 'sheet', 86609345, 78851821, 7757524, 82.27, 4042113),
  ('SUMBAWANGA', '2026-06', 'sheet', 74080348, 67980512, 6099836, 78.00, 2814809),
  ('TABATA', '2026-06', 'sheet', 99398943, 82190737, 17026706, 75.99, 10546206),
  ('TABORA TOWN', '2026-06', 'sheet', 80738681, 69119999, 11453006, 80.54, 4017690),
  ('TARIME', '2026-06', 'sheet', 91760327, 78875543, 12601766, 81.66, 6215393),
  ('TEGETA', '2026-06', 'sheet', 73491024, 69772173, 3718851, 90.34, 4037476),
  ('TEMEKE', '2026-06', 'sheet', 84728038, 79685637, 4804398, 87.72, 3971809),
  ('TENGERU- USARIVER', '2026-06', 'sheet', 74596087, 69974484, 4105592, 90.33, 5069384),
  ('TUNDUMA', '2026-06', 'sheet', 120858696, 108525660, 11888370, 82.30, 6657467),
  ('TUNDURU', '2026-06', 'sheet', 42211038, 41330928, 585440, 92.88, 934281),
  ('VWAWA', '2026-06', 'sheet', 62916979, 55511147, 6463973, 81.68, 4732992)
on conflict (team, ym) do update set
  source = excluded.source, expected = excluded.expected, collected = excluded.collected, uncollected = excluded.uncollected,
  ecol_pct = excluded.ecol_pct, recovered = excluded.recovered, stamped_at = now();

-- ------------------------------------------------------------------------------------
-- JULY 2026: 69 teams
-- ------------------------------------------------------------------------------------
insert into team_months (team, ym, source, expected, collected, uncollected, ecol_pct, recovered) values
  ('BABATI', '2026-07', 'sheet', 58672693, 54841559, 3321134, 84.79, 4050706),
  ('BOMA NGOMBE', '2026-07', 'sheet', 64939941, 56613538, 8326403, 82.95, 4232637),
  ('BUKOBA A', '2026-07', 'sheet', 844359, 844359, 0, 100, 0),
  ('BUKOBA B', '2026-07', 'sheet', 464707, 464707, 0, 100, 0),
  ('BUNDA', '2026-07', 'sheet', 49979941, 41316403, 8486538, 80.31, 5064698),
  ('BUZWAGI A', '2026-07', 'sheet', 79775322, 74701144, 5074178, 88.64, 4883350),
  ('BUZWAGI B', '2026-07', 'sheet', 85787677, 81238845, 4548832, 89.01, 2677933),
  ('CHALINZE', '2026-07', 'sheet', 61579577, 59218189, 2293388, 89.00, 2175241),
  ('CHAMWINO', '2026-07', 'sheet', 113010288, 109790713, 3165007, 89.83, 4496439),
  ('CHANIKA', '2026-07', 'sheet', 70680316, 65469343, 5210973, 85.05, 7282235),
  ('DODOMA CBD', '2026-07', 'sheet', 92706674, 86889606, 5817068, 87.02, 3537811),
  ('GEITA', '2026-07', 'sheet', 112500320, 103423796, 8675844, 89.21, 4236841),
  ('GOBA', '2026-07', 'sheet', 92797324, 84204789, 7075193, 87.75, 5383691),
  ('GONGOLAMBOTO', '2026-07', 'sheet', 54439641, 45598369, 8841272, 82.29, 3135970),
  ('IPURI', '2026-07', 'sheet', 77361300, 66353357, 11007943, 85.37, 5854068),
  ('IRINGA A', '2026-07', 'sheet', 78647589, 75239705, 3407884, 91.91, 2439716),
  ('IRINGA B', '2026-07', 'sheet', 76703949, 74302059, 2367890, 94.99, 2340939),
  ('KABWE', '2026-07', 'sheet', 115849335, 98500710, 17194286, 78.54, 7192087),
  ('KARATU', '2026-07', 'sheet', 65755975, 58761082, 6994893, 79.86, 5803967),
  ('KASULU', '2026-07', 'sheet', 10857635, 10857635, 0, 99.26, 0),
  ('KATORO A', '2026-07', 'sheet', 90258623, 86247395, 3977228, 90.67, 1091990),
  ('KATORO B', '2026-07', 'sheet', 84631591, 77163051, 6947698, 86.63, 6999373),
  ('KIGAMBONI A', '2026-07', 'sheet', 67393676, 62103069, 5290607, 85.42, 4151541),
  ('KIGAMBONI B', '2026-07', 'sheet', 57363706, 52621844, 4732524, 87.17, 4131790),
  ('KIGOMA', '2026-07', 'sheet', 105048608, 93014976, 12033632, 74.24, 8546400),
  ('KIHONDA A', '2026-07', 'sheet', 72873309, 67085543, 5743430, 82.72, 3180780),
  ('KIHONDA B', '2026-07', 'sheet', 68957640, 61264739, 7652901, 82.18, 3126513),
  ('KIJENGE-NJIRO', '2026-07', 'sheet', 97109612, 91657970, 5391642, 83.58, 5934132),
  ('KIJICHI', '2026-07', 'sheet', 77859947, 71616324, 6243623, 86.97, 4885127),
  ('KIMARA', '2026-07', 'sheet', 66033643, 63471577, 2562066, 89.53, 3873155),
  ('KONGOWE', '2026-07', 'sheet', 78466304, 70196046, 8270258, 86.21, 3932264),
  ('KYELA', '2026-07', 'sheet', 64724673, 56684326, 8040347, 84.82, 3602559),
  ('MABIBO', '2026-07', 'sheet', 74550639, 69024768, 4165872, 86.88, 5711686),
  ('MAFINGA', '2026-07', 'sheet', 91612974, 79183298, 10451998, 85.60, 4019773),
  ('MAJENGO', '2026-07', 'sheet', 98820915, 92671084, 6123831, 88.82, 4006868),
  ('MAKAMBAKO A', '2026-07', 'sheet', 109168211, 91045110, 17639043, 76.14, 8021209),
  ('MASASI', '2026-07', 'sheet', 79798032, 78679443, 1095915, 94.05, 728177),
  ('MBAGALA', '2026-07', 'sheet', 72816681, 67454123, 5271892, 88.74, 3871723),
  ('MBALIZI', '2026-07', 'sheet', 86399568, 74479226, 10787670, 80.18, 5011129),
  ('MBARALI', '2026-07', 'sheet', 67971660, 67603660, 300000, 99.47, 400000),
  ('MBEZI', '2026-07', 'sheet', 106210272, 99856788, 5618973, 92.32, 4708661),
  ('MBINGA', '2026-07', 'sheet', 69660351, 66912344, 2748007, 87.37, 2361979),
  ('MOROMBOO', '2026-07', 'sheet', 68634717, 61876562, 6520155, 87.00, 3652256),
  ('MPANDA A', '2026-07', 'sheet', 10529000, 10529000, 0, 100, 0),
  ('MPANDA B', '2026-07', 'sheet', 6392240, 6392240, 0, 100, 0),
  ('MSAMVU', '2026-07', 'sheet', 75242009, 66386051, 8413958, 84.15, 5150057),
  ('MTWARA TOWN', '2026-07', 'sheet', 88779657, 85913559, 2745745, 85.51, 3225165),
  ('MUSOMA', '2026-07', 'sheet', 88405633, 80826144, 7579489, 87.82, 3877332),
  ('MWINYI', '2026-07', 'sheet', 89091289, 77175091, 11758528, 78.40, 6704351),
  ('NJOMBE', '2026-07', 'sheet', 88014646, 68394403, 19620243, 74.25, 13140653),
  ('NZEGA', '2026-07', 'sheet', 107898953, 99350823, 8417960, 84.18, 5864156),
  ('SEGEREA', '2026-07', 'sheet', 121130563, 118001437, 3100793, 93.94, 3661621),
  ('SENGEREMA', '2026-07', 'sheet', 46744317, 42128239, 4446078, 89.03, 1350417),
  ('SERENGETI', '2026-07', 'sheet', 51731010, 40634052, 11096958, 68.79, 7670516),
  ('SHINYANGA', '2026-07', 'sheet', 93256153, 83839441, 9371709, 84.96, 4605647),
  ('SINGIDA', '2026-07', 'sheet', 113049988, 101991219, 11058769, 79.69, 7843018),
  ('SINZA', '2026-07', 'sheet', 112222588, 100110693, 12111895, 87.12, 7143522),
  ('SONGEA', '2026-07', 'sheet', 98826571, 97806739, 883832, 96.70, 1407603),
  ('SUA', '2026-07', 'sheet', 90864898, 84352005, 6478893, 90.21, 4084023),
  ('SUMBAWANGA', '2026-07', 'sheet', 90825305, 81941219, 8884086, 79.98, 5079424),
  ('TABATA', '2026-07', 'sheet', 96865982, 80975721, 15890261, 80.36, 9220939),
  ('TABORA TOWN', '2026-07', 'sheet', 78828976, 67660600, 10873711, 79.42, 4074617),
  ('TARIME', '2026-07', 'sheet', 92678304, 80381366, 12003256, 84.76, 5461090),
  ('TEGETA', '2026-07', 'sheet', 83906329, 77101454, 6804875, 89.44, 6019873),
  ('TEMEKE', '2026-07', 'sheet', 94621998, 87330740, 7291258, 87.33, 5886594),
  ('TENGERU- USARIVER', '2026-07', 'sheet', 76873977, 73624064, 2879904, 92.66, 4479367),
  ('TUNDUMA', '2026-07', 'sheet', 141014998, 125246632, 15768366, 79.09, 6468726),
  ('TUNDURU', '2026-07', 'sheet', 50433261, 49624057, 544258, 95.19, 363406),
  ('VWAWA', '2026-07', 'sheet', 73649698, 64541241, 8901451, 80.18, 3842174)
on conflict (team, ym) do update set
  source = excluded.source, expected = excluded.expected, collected = excluded.collected, uncollected = excluded.uncollected,
  ecol_pct = excluded.ecol_pct, recovered = excluded.recovered, stamped_at = now();

-- What landed: one line per period, and the count of teams on it.
select ym, source, count(*) as teams, sum(expected) as expected, sum(collected) as collected, sum(recovered) as recovered
from team_months group by ym, source order by ym;

-- =====================================================================================
-- LAST, AND ON ITS OWN: the index the month function reads by. Creating it walks the whole loans
-- table once. If the editor times out here, everything above is already in -- re-run just this line.
-- =====================================================================================
create index if not exists loans_approved_date_team_idx on loans (approved_date, team);
