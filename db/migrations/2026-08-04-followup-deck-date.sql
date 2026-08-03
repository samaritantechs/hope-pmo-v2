-- WHEN WAS THIS CUSTOMER LAST SEEN ON A DECK?
--
-- followup_status is the officers' working list of defaulters. A customer stays on it until
-- THEIR weekday's current deck is uploaded again without them -- which is right, and which
-- also means that if that weekday's deck stops being uploaded, they stay for ever.
--
-- The symptom, reported from the field: a customer showing on Kesho with D.S 9-10 and on Def
-- with D.S 8-9, when they are not in the current defaulter file at all. The Def row is a
-- fortnight-old deck that nothing has come along to clear.
--
-- Stamping the deck's own date on the row makes "how long since a deck confirmed this" a
-- question the system can answer, so a row nobody has re-confirmed can be retired.
--
-- OPTIONAL, like every migration here. Without it the per-weekday rule still applies and
-- nothing breaks; rows simply are not stamped, and the app leaves unstamped rows alone.

alter table followup_status add column if not exists deck_date date;

-- Read on every defaulter upload to find rows nobody has re-confirmed.
create index if not exists idx_fu_status_deck_date on public.followup_status(deck_date);

comment on column followup_status.deck_date is
  'snapshot_date of the current-defaulter deck that last confirmed this customer. NULL means '
  'never stamped (a row from before this column existed, or a placeholder created so an '
  'Expected customer''s comment has somewhere to live). Rows stamped longer ago than '
  'FU_STALE_DAYS are retired on the next upload.';
