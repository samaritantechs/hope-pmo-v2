-- Demand notices are legal correspondence: the letter prints "Kumb.Na. HMCL/AB/24/07/2026"
-- at the top, and that reference is how the notice is cited afterwards -- in a follow-up, in
-- a handover to the auctioneers, in court. The table stored every amount but not the one
-- string identifying the document, so a printed notice could not be found again by its own
-- reference. It is derived (initials / day / month / year, with -2, -3 ... for a repeat on the
-- same day for the same person), so it is stored rather than recomputed: regenerating it later
-- against a changed name would silently produce a different reference for the same letter.
alter table demand_notices add column if not exists notice_id text;

-- The same person can be served more than once; the reference is what must stay unique.
create unique index if not exists idx_demand_notice_id on demand_notices(notice_id)
  where notice_id is not null;

-- Reading a customer's notice history is the common lookup ("have we served them already?").
create index if not exists idx_demand_notices_ref on demand_notices(ref, notice_date desc);
