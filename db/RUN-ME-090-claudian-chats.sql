-- =====================================================================================
-- RUN-ME-090  CLAUDIAN-PMO'S CHATS: one row for each question asked of the helper in the corner of
--             HOPE PMO and HOPE Calls, for the owner's Hope Ai tab and for the daily limits.
--
--   "Have a new tab called Hope Ai in the system with rows of user chats that I could open and see
--    what the user is chatting.. like reports of Claudian-PMO chats per user roles, teams and dates"
--                                                              -- the owner, 25 Nov 2026
--
-- Whole file: new query, paste, Ctrl+A, Run. SAFE TO RE-RUN. Nothing existing is touched.
-- Every line starts at the left edge and the last line says END (handbook Part 110, addendum 2).
--
-- WHAT IS IN A ROW: the day, where it was asked (portal or call), a one-way fingerprint of WHO (never
-- an access code, never a device id), their name, role, teams and zone as the system knows them, the
-- question (every number of seven digits or more already replaced by [namba]) and the answer,
-- what kind of answer it was (ai = the model answered; faq = a ready answer tapped; canned = a greeting
-- answered with a word; limit = a limit was reached; busy = the model could not answer; match = a typed
-- question answered from the nearest ready answer; nomatch = a typed question no ready answer fitted), the tokens
-- the model used, and whether the person's teams were behind the company standards last week.
--
-- WHO MAY READ IT: nobody through the public API. Row security is on and no policy is made, so only
-- the server (the service role) reads or writes it.
--
-- UNTIL THIS IS RUN Claudian-PMO still answers: nothing is logged, the Hope Ai tab says this file is
-- missing, and each person's questions a day are counted in the server's memory instead.
--
-- UNDO, whenever wanted, alone:  drop table public.claudian_chats;
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists public.claudian_chats (
id uuid primary key default gen_random_uuid(),
created_at timestamptz not null default now(),
day date not null,
source text not null,
user_key text not null,
user_name text,
role text,
teams text,
zone text,
lang text,
thread text,
mode text not null,
faq_id text,
question text,
answer text,
tokens_in integer,
tokens_out integer,
cache_read integer,
ms integer,
behind boolean,
note text
);
comment on table public.claudian_chats is 'Claudian-PMO: one row per question. user_key is a one-way fingerprint, question is masked, mode is ai|faq|canned|limit|busy|match|nomatch.';

create index if not exists idx_claudian_chats_day on public.claudian_chats (day desc, created_at desc);
create index if not exists idx_claudian_chats_user on public.claudian_chats (user_key, day, mode);

alter table public.claudian_chats enable row level security;

select count(*) as chats_now, to_regclass('public.claudian_chats') is not null as table_exists
from public.claudian_chats;
-- END OF RUN-ME-090
