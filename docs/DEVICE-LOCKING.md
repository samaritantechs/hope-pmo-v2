# Company phones — enrolling, locking and unlocking

> "GM wants us to enroll and lock all our hope company phones ... field officers, managers,
> gmos, pmos etc are provided with company devices and some of uor unworth employees quit with
> our phones so GM has ordered to implement those two nav panes for locking and unlocking."

Two nav panes in the portal — **Kufunga simu / Locking** and **Kufungua simu / Unlocking** — over
one register of handsets, plus a small Android app on each phone that does the actual locking.

---

## 1. Before anything works

**Run the migration.** Paste `db/RUN-ME-2026-09-11-devices.sql` whole into the Supabase SQL
editor and run it once. It creates `devices` and `device_events`. Until it runs, both panes open
and say so, naming the file — nothing breaks and nothing is lost.

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

---

## 5. The app on the phone

The lock itself is an Android **Device Owner** app. The portal decides; the app obeys.

**This repository does not yet contain a built HOPE lock APK.** The working implementation lives
in the sister repository `samaritantechs/hoop-pmo` under `android/lock`, and there are two honest
routes:

**Route A — provision against HOPE using the existing signed APK.** The lock app takes its
server address at first enrolment (`-e server <url>`), written once, on a handset that is
already Device Owner, and never changeable afterwards. So Hoop's built APK can be pointed at
HOPE's API with no new build at all. Set `DEVICE_LOCK_PACKAGE` in Settings to
`com.samaritantechs.hooploanlock` so the bench command names the package that is really
installed. The lock screen still says HOPE, because every word on it comes from this server
(§6) — only the app's own name in the launcher would read HOOPLOAN.

**Route B — build HOPE's own.** Copy `android/lock` from `hoop-pmo`, change the package to
`com.samaritantechs.hopelock`, point `serverUrl` at HOPE, replace the logo drawable, and build.
It needs the Android SDK (build-tools and platform 35) and a signing key; `android/build-noagp.sh`
in that repository builds without Gradle's Android plugin. Leave `DEVICE_LOCK_PACKAGE` unset and
the bench command names this package by default.

Route A gets the fleet locked this week. Route B is the tidier end state.

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
| `DEVICE_LOCK_PACKAGE` | `com.samaritantechs.hopelock` | the APK the bench command names — see §5 |
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
- **It does not track location.** Hoop's version reports coordinates; that was deliberately left
  out here. These are staff phones, and where an employee is standing is a different question
  from whether the company's handset is locked. Say so if you want it and it can be added.
- **A released phone is gone.** See §3.
