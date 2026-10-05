-- RUN-ME-037  A dash in a leaders-sheet role column is nobody, not an officer.
--
--   "unassigned teams count text at collection slide counted only for pmo collection not for
--    early collection and recovery after uploading. so the dash was not respected"
--
-- The leaders sheet writes a dash where nobody holds a role, and until this fix the upload
-- stored each dash as a name. The importer now stores such cells as NULL (parse.js nameOrNull),
-- and every board reads through the same rule, so the screens are already right without this
-- script. This only cleans what was stored before the fix, so the table matches what the
-- screens say. Safe to run more than once. Nothing is deleted; cells become NULL.
--
-- Review first (what will change):
select team,
       opm, recovery, gmo, manager, credit, expected, bike, legal, collection,
       recovery_id, gmo_id, manager_id, credit_id, early_col_id, bike_id, legal_id, collection_id
from teams
where opm ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$'
   or recovery ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$'
   or gmo ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$'
   or manager ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$'
   or credit ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$'
   or expected ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$'
   or bike ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$'
   or legal ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$'
   or collection ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';

-- Then clean. One statement per column so a column a database has not got yet (migrations
-- are run by hand) fails on its own line and the rest still run.
update teams set opm        = null where btrim(opm)        ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set recovery   = null where btrim(recovery)   ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set gmo        = null where btrim(gmo)        ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set manager    = null where btrim(manager)    ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set credit     = null where btrim(credit)     ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set expected   = null where btrim(expected)   ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set bike       = null where btrim(bike)       ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set legal      = null where btrim(legal)      ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set collection = null where btrim(collection) ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set recovery_id   = null where btrim(recovery_id)   ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set gmo_id        = null where btrim(gmo_id)        ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set manager_id    = null where btrim(manager_id)    ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set credit_id     = null where btrim(credit_id)     ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set early_col_id  = null where btrim(early_col_id)  ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set bike_id       = null where btrim(bike_id)       ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set legal_id      = null where btrim(legal_id)      ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';
update teams set collection_id = null where btrim(collection_id) ~* '^(?:[-‐‑‒–—―_.·]+|n/?a|none|nil|null|hakuna|0)$';

-- Afterwards: which teams name nobody, per unit, is what the presentation caption shows.
select count(*) filter (where expected is null) as early_unassigned,
       count(*) filter (where recovery is null) as rec_unassigned
from teams;
