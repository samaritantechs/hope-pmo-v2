# Company phones — enrolling, locking and unlocking

> "GM wants us to enroll and lock all our hope company phones ... field officers, managers,
> gmos, pmos etc are provided with company devices and some of uor unworth employees quit with
> our phones so GM has ordered to implement those two nav panes for locking and unlocking."

Two nav panes in the portal — **Kufunga simu / Locking** and **Kufungua simu / Unlocking** — over
one register of handsets, plus a small Android app on each phone that does the actual locking.

---

## 1. Before anything works

**Run the migrations.** Paste each whole into the Supabase SQL editor and run it once. Both are
safe to re-run.

1. `db/RUN-ME-2026-09-11-devices.sql` — creates `devices` and `device_events`. Until it runs,
   both panes open and say so, naming the file.
2. `db/RUN-ME-2026-09-11b-device-location.sql` — adds the four position columns (§7). Until it
   runs, handsets still beat and still lock; they simply report no position.

These are `.sql` files for the SQL editor. `DEVICE-LOCKING.md` — this file — is for reading.

**Tick the panes.** They are two ordinary tabs, `devlock` and `devunlock`, granted in **Teams &
Staff → Roles & access** like every other screen. An admin holds both from the start; nobody
else holds either until somebody ticks it. **Tick them to two different people if you can** —
that is the whole reason the GM asked for two panes rather than one screen with two buttons.

**Put the app on the phones.** See §5. Without it the register is a list; the app is what makes
a lock a lock.

---

## 2. The two panes, and who gets which

| | Kufunga simu (Locking) | Kufungua simu (Unlocking) |
|---|---|---|
| Sees the whole fleet | yes | yes |
| Enrol new handsets | **yes** | no |
| Read a phone's provisioning token | **yes** | no |
| **Funga** — lock | **yes** | no |
| **Andika hasara** — write off | **yes** | no |
| **Fungua** — unlock | no | **yes** |
| **Achia** — release for good | no | **yes** |
| Record who is carrying a phone | yes | yes |

Both panes see every phone on purpose: somebody who cannot tell whether the handset in their
hand is locked cannot do the one job they have.

**The gate is on the order, not on the screen.** Hiding a button is a courtesy; the server
checks which state is being asked for and refuses on that. Somebody holding only Locking cannot
unlock a handset by any route, including a hand-written request.

---

## 3. The four states

| State | What it means | What the phone does |
|---|---|---|
| **enrolled** | on the register, in service | runs normally, reports in |
| **locked** | an order to lock | draws the lock screen |
| **released** | handed back for good | unlocks, drops the restrictions, **stops calling home** |
| **lost** | written off — somebody left with it | **stays locked**, for good |

Two of those are worth reading twice.

**`lost` stays locked.** A handset you have given up on is exactly the one that must not quietly
come back to life if somebody reinstates it later.

**`released` is final in practice.** It tells the phone to unlock, step down and stop talking to
us. A released phone that has genuinely gone quiet cannot be locked again from a desk — the
register knows this and refuses the order rather than writing a decision nobody will ever
collect. Use it when a phone is leaving the company. To simply give somebody their handset back
for the day, use **Fungua** (unlock), which leaves it enrolled and reachable.

---

## 4. Doing the work

### Enrolling a batch at the bench

1. **Locking** pane → **+ Sajili simu / Enrol**.
2. Paste the IMEIs, one per line. A grouped IMEI (`3513 8833 4583 295`) is fine — entries are
   split on lines, tabs, commas and semicolons, never on spaces inside a number.
3. It hands back **one command for every phone on the hub**, with the batch already in it.
   Each handset reads its own IMEI and collects the token minted for it, so plug-in order
   cannot decide which phone gets which identity.
4. The batch expires after 24 hours. Re-open the drawer for a fresh one.

Re-enrolling a phone the register already holds is safe and idempotent: it keeps its own token,
joins the new batch, and a previously **released** handset comes back into service. A **locked**
or **lost** phone stays exactly as it is — a cable is not an appeal.

### Locking a leaver's phone

**Locking** pane → find them by name, team or IMEI → tap the row → give a reason → **Funga**.
Or **Funga kwa wingi** to paste a column of IMEIs.

**The reason is not paperwork.** It shows on the locked phone's own screen and stays in its
history, and six months from now "why is this locked" has to have an answer.

### Reading the register

- **Imeagizwa kufungwa / lock ordered** — the order is given, the handset has not confirmed. It
  will, on its next beat. If it sits here for days, the phone is off or out of coverage.
- **Haijawahi kuongea / never called home** with a lock ordered — the red warning at the top of
  the pane. That handset was **never provisioned properly**: it is not locked and cannot be.
  Take it back to the bench. No other screen can show you this.
- **Kimya / quiet** — has not spoken in six hours. A phone in a drawer is quiet and perfectly
  fine.
- **Zimejaribu kujisajili zikakataliwa / tried to enrol and were refused** — the red strip
  under the counts. See §4a; it is the answer to the commonest bench failure there is.

### 4a. When the broadcast says the office refused the phone

```
Broadcast completed: result=5, data="THE OFFICE REFUSED THIS PHONE (HTTP 403) ..."
```

**result=5 with a 403 means everything worked except the identity.** The phone is Device Owner,
it reached the server and the server answered — the only thing that went wrong is that the IMEI
the handset read off itself is not one the batch was made for. The message on the phone names
three possible causes because the endpoint deliberately tells a handset nothing; **the Locking
pane names the one that actually happened.**

Refresh **Kufunga simu** and read the red strip. It prints **the IMEI the handset gave for
itself**, which is the one number the bench cannot get any other way, and then says which of two
things to do:

- **Haipo kwenye rejista / not on the register** — that number was never enrolled, so what was
  pasted was a different phone. Almost always the stock sheet or the box label, and on a dual-SIM
  handset the other slot. **Enrol the IMEI printed in the strip** and run the command again.
- **Ipo kwenye rejista / on the register** — the phone is enrolled, but the command carried a
  batch it was not in; an old command copied out of yesterday's terminal does exactly this. Open
  **+ Sajili simu** again, paste the IMEIs, take the fresh command.

To check a handset's real IMEI without the register: dial **`*#06#`** on the phone, or Settings →
About phone. A dual-SIM shows two and **either** may be enrolled — the phone offers both when it
claims, so enrolling one of them is enough.

A claim against a batch the office never minted, or one over a day old, is refused with nothing
written at all — so an empty strip after a refusal means the batch itself was wrong, not the
IMEI.

---

## 5. The app on the phone

The lock itself is an Android **Device Owner** app. The portal decides; the app obeys.

**This repository contains no lock APK of its own, and does not need one.** The working app
lives in the sister repository `samaritantechs/hoop-pmo` under `android/lock`, built and signed,
and HOPE uses that build.

**This is the route in force.** The lock app takes its server address at first enrolment
(`-e server <url>`), written once, on a handset that is already Device Owner, and never
changeable afterwards — so the same signed APK reports to HOPE with no new build, no new
signing key and nothing to download beyond the app itself. `DEVICE_LOCK_PACKAGE` already
defaults to `com.samaritantechs.hooploanlock`, so **there is nothing to set**.

The lock screen still reads HOPE, because every word on it comes from this server (§6). The only
trace of the other company is the app's own name in the launcher, on a handset whose launcher is
about to be pinned behind a lock screen anyway.

Get the APK from `https://hoop-pmo.vercel.app/HOOPLOAN-Lock.apk`.

**If HOPE ever builds its own**, copy `android/lock` from `hoop-pmo`, change the package, point
`serverUrl` here, replace the logo drawable and build — it needs the Android SDK (build-tools and
platform 35) and a signing key, and `android/build-noagp.sh` in that repository builds without
Gradle's Android plugin. Then set `DEVICE_LOCK_PACKAGE` to the new package and the bench command
follows with no deploy.

### The bench, per handset

```
adb install -r <the lock APK>
adb shell dpm set-device-owner <package>/.LockAdmin
```

Then the one broadcast the enrol drawer hands you, for every phone on the hub at once.

**Device Owner is refused while any account is signed in** — a Google account and the vendor's
own both count. Remove every account under Settings → Accounts, or factory reset and skip the
sign-in. A handset that never takes ownership **cannot be locked**, and once it is in the field
there is no way back without holding it.

---

## 6. Settings

All optional; every one has a working default, and the register never fails because a setting is
missing or unreadable.

| Key | Default | What it does |
|---|---|---|
| `DEVICE_LOCK_BRAND` | `HOPE MICROCREDIT` | the name on the locked screen |
| `DEVICE_LOCK_MESSAGE` | a Swahili sentence | the message. `{brand}` and `{namba}` are filled in by the server |
| `DEVICE_HELP_PHONE` | — | the number a stranded person is told to call. Unset means the message promises no number rather than promising a blank one |
| `DEVICE_LOCK_REASON` | — | the reason shown when a phone locked *itself* on the offline grace |
| `DEVICE_LOCK_PACKAGE` | `com.samaritantechs.hooploanlock` | the APK the bench command names. The default is the app HOPE actually installs, so leave it alone unless HOPE builds its own — see §5 |
| `DEVICE_BEAT_SECONDS` | `900` | how often a settled handset reports. Floor 60 |
| `DEVICE_PENDING_BEAT_SECONDS` | `25` | how often it reports while an order is outstanding. Floor 10 |
| `DEVICE_OFFLINE_GRACE_HOURS` | `336` (14 days) | how long an **issued** phone may go unheard-from before it locks itself. A phone still in the store never does |
| `DEVICE_BOOT_GRACE_MINUTES` | `5` | ordinary use a locked phone gets after a reboot, so somebody can turn wifi on and let it hear that it was freed. `0` turns it off |
| `DEVICE_BOOT_GRACE_EVERY_HOURS` | `24` | how often that window is allowed. Rebooting again buys nothing |

### Why the beat is fifteen minutes and not one

Hoop's identical register beats every sixty seconds. This one does not, deliberately.

Three hundred handsets against the same Postgres that serves `/api/upload` and the call app is
the first thing in this system that could break rule one by simply existing — not through a slow
query, but through sheer count. At sixty seconds that is five writes a second all day and about
260 MB per handset per month, on data **the company** pays for. At fifteen minutes it is a write
every three seconds and about 17 MB.

Pressing **Funga** still reaches a phone in seconds, because the short pace is used whenever an
order is outstanding and closes the moment the handset confirms. It is being *idle* that is
cheap. The floors in the table above cannot be typed away: a pending pace of `1` would be three
hundred phones hammering the database the morning upload runs on.

---

## 7. What this cannot do

Said plainly, so nobody plans around a promise that was never made.

- **It cannot wake a sleeping phone.** The office presses Funga and the handset finds out on its
  next beat — up to fifteen minutes, and longer if Android has it in deep sleep. Hoop solves this
  with Firebase push; that is a separate piece of work and is not ported here.
- **It cannot lock a phone that was never properly provisioned.** If Device Owner was refused at
  the bench, the register will happily accept the order and the phone will never hear it. The red
  warning at the top of the Locking pane is the only thing that will tell you.
- **It cannot reach a phone that is factory reset before you lock it.** Device Owner blocks a
  reset from the handset's own settings, but not a hardware recovery-mode wipe on every model.
- **A released phone is gone.** See §3.

---

## 8. Where a handset last was

> "add location tracking too, GM will want it."

The lock app already reports its last known position on every beat, so this needed no change on
the phone — only `db/RUN-ME-2026-09-11b-device-location.sql` and the screen to show it.

- The register's **Mahali / Where** column says **how old the fix is**, not the coordinate. What
  somebody scanning a list of three hundred phones needs is whether there is a recent position
  worth acting on.
- The coordinate, its accuracy in metres and a map link are in the phone's own drawer, one tap
  in.

**The fix's age is not the beat's age, and the screen says so.** The handset reports its LAST
KNOWN position rather than waking the GPS every beat, so a phone that checked in a minute ago can
be carrying a fix from this morning. Where the fix is more than an hour older than the beat, the
drawer says that in bold. Collapse the two facts and the register starts claiming a phone is
somewhere it left on Tuesday — which is worse than showing nothing, because somebody drives
there.

What is thrown away rather than stored: half a coordinate, `0,0` (which is what a handset sends
when it has no fix at all), anything off the globe, and a timestamp from the future — for the
last, the position is kept and the beat's own time stands in, because a clock that is wrong tells
you nothing about where the phone is.

**What it is not.** This is where the company's handset was when it last spoke. It is not a live
trace, it is not a movement history — only the latest fix is kept — and on a staff phone it should
be read as an answer to "where do we go to collect this handset", not as an account of somebody's
day. If the GM wants a history of positions rather than the last one, that is a different table
and worth asking for deliberately.
