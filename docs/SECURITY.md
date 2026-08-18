# Security Runbook — HOPE PMO & HOOP PMO

*Written 18 August 2026. Keep this file; repeat the rotation any time a key may have been seen.*

---

## 0. What this is about (and what it is NOT about)

This is **not** about officers, sign-ins, Google accounts, or adding any step to anyone's
phone. Officers never touch these keys and will notice nothing.

Supabase gives every project two secret keys:

| key | what it can do | where it lives |
|---|---|---|
| `service_role` | **everything** — read, rewrite, delete every table, ignoring all rules | ONLY in Vercel's environment variables, server-side |
| `anon` | whatever the row-level rules allow | may appear in client code |

The `service_role` key is the master key to the vault. If it has ever been pasted into a
chat, a document, a screenshot, or a repository, treat it as public: anyone holding it can
empty or corrupt the whole book from anywhere on earth, without ever opening your app.
**Rotation makes every leaked copy dead.** That is the entire move — no lock is added,
one stolen key is cancelled.

---

## 1. Rotate the keys — do this for HOPE, then again for HOOP

**Time: ~10 minutes per project. Officer impact: none. Do it at any hour.**

1. **Supabase Dashboard** → choose the project (first `hope-pmo-v2`, later `hoop-pmo`)
   → **Project Settings → API**.
2. Find **`service_role`** (it may be under "API keys" as the *secret* key on newer
   dashboards). Click **Roll / Regenerate / Reset**. Copy the NEW key — you will see it
   only here.
3. **Vercel** → the matching project → **Settings → Environment Variables** →
   `SUPABASE_SERVICE_ROLE_KEY` → **Edit** → paste the new key → Save.
4. Vercel → **Deployments** → newest deployment → ⋯ → **Redeploy** (a redeploy is what
   loads the new value; until then the server still uses the old one).
5. Open the portal and the call app once each: dashboard loads, a list loads — done.
   The old key is now dead everywhere it ever leaked.
6. If the **`anon`** key was also ever shared, roll it the same way and update
   `SUPABASE_ANON_KEY` (or the equivalent) wherever it is set, then redeploy.

**The order matters:** roll in Supabase FIRST, then update Vercel, then redeploy.
Between steps 2 and 4 the system keeps running on the old key; the moment you redeploy it
switches. There is no downtime window worth planning around.

### Rules from now on

- The `service_role` key is written in exactly ONE place: Vercel env vars. Never in chat,
  never in a commit, never in a screenshot, never in a WhatsApp message to anyone.
- Anyone who needs "database access" gets a **read-only access code in the portal** or a
  scoped view — never the key.
- Rotate immediately whenever: a laptop is lost, a person with Vercel/Supabase access
  leaves, or a key appears anywhere outside Vercel. Rotation is free; suspicion is enough.

---

## 2. Offline backup — the note you asked to keep

A backup you can hold in your hand is the answer to the disaster no rotation prevents:
account lockout, billing failure, a hostile deletion, or the October-29th kind of day when
the internet itself goes away.

**Monthly, per project (put a repeating reminder on the 1st):**

1. Supabase Dashboard → **Database → Backups**. Pro plan already keeps daily backups —
   confirm they show as ✓ green. That protects against *mistakes*.
2. For the **offline** copy (protects against *losing the account itself*):
   Supabase → Database → **Connect** → copy the connection string, and from any machine
   with PostgreSQL tools run:
   `pg_dump "<connection-string>" --no-owner -f hope-YYYY-MM-DD.sql`
   (If pg_dump is not available to you, the lighter fallback: SQL Editor → run
   `select * from <table>` → Download CSV, for the tables that are the business:
   `teams`, `access_codes`, `followup_status`, `defaulter_snapshots`,
   `repayment_snapshots`, `loans`, `followup_comments`, `received_payments`,
   `call_users`, `call_logs`, `snapshot_summaries`.)
3. Compress the dump with a password (7-Zip → Add to archive → set password,
   AES-256), named `hope-backup-2026-08.7z`.
4. Keep TWO copies: one on a USB drive that stays **offline** at home, one in a private
   cloud drive. The password lives in your head and one written place at home — the
   backup of the book must never become the next leak of the book.
5. Once a quarter, OPEN one backup and check a table has rows in it. A backup nobody has
   ever restored is a hope, not a backup.

---

## 3. The five-minute quarterly check

- [ ] Keys live only in Vercel env vars — search the repo and your chats for "service_role": zero hits
- [ ] Supabase daily backups showing green, both projects
- [ ] Offline archive newer than 40 days, both projects
- [ ] Everyone with Supabase/Vercel dashboard access is still someone you employ and trust
- [ ] Access codes of anyone who left have been deleted in the portal
