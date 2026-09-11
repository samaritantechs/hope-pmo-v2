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
2. `db/RUN-ME-2026-09-11b-device-location.sql` — adds the four position columns (§8). Until it
   runs, handsets still beat and still lock; they simply report no position.
3. `db/RUN-ME-2026-09-11c-device-shift.sql` — adds the three columns Shift needs (§9). Until it
   runs, Shift does nothing at all — not fails, does nothing: `deviceShift` writes them,
   `beat()` reads them back with the same pre-migration fallback every other device column
   after the first has.

These are `.sql` files for the SQL editor. `DEVICE-LOCKING.md` — this file — is for reading.

**Where the words are edited: Settings → Skrini ya simu iliyofungwa / The locked phone's
screen.** Admin only, with a live preview of what the handset will actually show. Until
2026-09-11 these keys were read by the server on every beat and offered nowhere — Settings
lists only keys that already have a row, so a key never written had nothing to click and no
way to learn its name. A test now holds every key the lock screen reads to appearing on that
page.

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
written at all.

**An empty strip after a 403 is itself a diagnosis, and usually THIS one:** the claim never
reached HOPE at all. See §5a — a handset that already holds a token ignores `-e server`, so it
asks the wrong office and HOPE never hears from it. Check §5a before re-checking a single IMEI.

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

**Run the commands one at a time.** Paste two lines into `cmd` at once and only the first runs:
the second goes into the type-ahead buffer, its echo interleaves with the first one's output,
and it never executes — no `Broadcasting:`, no result code, nothing enrolled, and an answer on
screen that reads like success. Both drawers now hand the commands over one box at a time.

**`IllegalStateException: ... device owner ... is already set` is the SUCCESS case** when the
package it names is ours. Ownership is already in place; go straight to the broadcast. Android
has no quieter way of saying "already done", and the stack trace has cost a bench round more
than once.

---

### 5a. Moving a handset from Hoop's register to HOPE's

> "remember we using one app and sometime hoop can release phones that need to be enrolled
> into hope"

**This is a routine, and it will keep happening.** One APK serves both companies, so a handset
Hoop finishes with is a handset HOPE can take on — and the step that makes that work is not the
obvious one. It is worth doing in the order below every time rather than discovering it again.

```
Broadcast completed: result=2, data="ALREADY ENROLLED, under a different token..."
```

That is what a Hoop handset says to HOPE's enrol command, and it is the expected answer, not a
fault.

**HOPE runs Hoop's signed APK on purpose (§5), and that APK's built-in fallback server is
`hoop-pmo.vercel.app`.** Every handset that has ever been through Hoop's bench — and every one
that never had a server written at all — is pointed there until something changes it.

**Releasing it in Hoop's portal is NOT enough, and this is the part that catches people.**
Pressing **Achia** there makes the phone retire on its next beat: `Beat` calls
`LockAdmin.unharden` and sets `RETIRED`, so it unlocks, gives up Device Owner and stops calling
home. **It does not clear `Prefs.TOKEN`.** The handset is therefore still carrying Hoop's
credential and Hoop's server address, and HOPE's enrol command will still be refused — by a
phone that looks, from Hoop's register, entirely finished with.

**The app writes its server address ONLY when it holds no token.** `EnrolReceiver` computes
`fresh = existing token is empty` and writes `-e server` inside that branch and nowhere else,
deliberately: changing the server is a change of *which office owns the phone*, and is the one
thing that could turn a leaked token into an unlock.

The consequence is the whole reason this section exists. **On a handset that already carries a
token, `-e server https://…` is read and thrown away, silently, every time.** The claim then
goes to the server the phone already holds, that office does not know HOPE's batch, and the
bench sees:

```
Broadcast completed: result=5, data="THE OFFICE REFUSED THIS PHONE (HTTP 403)..."
```

which reads as "wrong IMEI" and sends somebody re-checking numbers that were never wrong. **The
refused-claim strip (§4a) stays empty, because nothing ever reached HOPE** — and that emptiness
is the tell.

**Do NOT use `-e current`.** The receiver's own result=2 message suggests it, and inside one
office it is right. Here it is not: it moves the token and leaves the server where it was, so
the phone ends up holding a HOPE credential while beating to Hoop. No register can reach it, no
desk can unlock it, and `DISALLOW_FACTORY_RESET` means it cannot be wiped either.

**From lock app 1.11.8 onward, achia does this for you.** A successful release now clears the
handset's token and server, so a phone Hoop has released is already free: run §4's two steps
and it enrols here with nothing special. Check the app version before assuming it — a handset
released while still on 1.11.7 or older kept both, and needs the rest of this section.

**The one step that matters is clearing the token**, because an empty token is what makes the
next enrolment *fresh*, and fresh is what lets `-e server` land. On an older handset **only the
cable release does that** — not an office release, not a re-enrol, not `-e current`.

So the handover, whole, with the phone on a cable:

1. **Get its Hoop token** — Hoop's portal → **Devices** → the handset's row → **Token**. Needed
   whether or not Hoop has already released it: the receiver checks it before changing anything.
2. **Release it over the cable** (below). This clears the token.
3. **`set-device-owner`**, immediately, with nothing signed in.
4. **HOPE's enrol broadcast** with `-e server` and `-e token` — now `fresh`, so the server
   finally moves. You want `result=1 ENROLLED`.
5. **Tidy Hoop's register**: mark the handset released there if it is not already, so it does not
   sit in Hoop's fleet as a phone that stopped reporting.

The release command:

```
adb shell am broadcast --include-stopped-packages \
    -a com.samaritantechs.hooploanlock.RELEASE \
    -n com.samaritantechs.hooploanlock/.ReleaseReceiver \
    -e token <its token on THAT register>
```

- **result=1 RELEASED** — token cleared and Device Owner given up. `unharden` calls
  `clearDeviceOwnerApp`, so the handset is an ordinary phone again for as long as it takes you
  to re-take it. **Run `set-device-owner` again immediately, and let nothing sign in first.**
  The release also drops `DISALLOW_ADD_USER`, and Device Owner is refused while any account
  exists — so a phone that picks one up in that window cannot be re-provisioned at all without
  a factory reset. Do this step with the cable still attached and the phone untouched.
- **result=3 PARTIAL** — token cleared, ownership kept (another admin holds the device). Better
  for us: skip straight to the enrol broadcast.
- **result=2 TOKEN MISMATCH** — wrong token; nothing was changed.
- **`The syntax of the command is incorrect`** — not the phone at all. That is `cmd` reading
  `<` and `>` as file redirection, which means the placeholder is still in the command and
  nothing was sent. Replace the brackets *and* the words between them with the token itself.
  The brackets are written in deliberately for exactly this reason: a placeholder that errors
  is a placeholder that cannot be run by accident.

Hoop's register hands the token over at **Devices → the handset's row → Token**. If the phone
is not on that register either, nothing holds its token and a factory reset with the sign-in
skipped is the only way back.

Then run §4's two steps. The phone now has no token, so `-e server` lands, and it enrols to HOPE.

A phone fresh out of its box has no token either, so none of this applies to new stock — which
is the ordinary case and stays a two-command bench.

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
| `DEVICE_LOCK_LOGO` | `/lock-logo.png` | the wordmark on the locked screen — see §6a. `none` means no mark at all |
| `DEVICE_BEAT_SECONDS` | `900` | how often a settled handset reports. Floor 60 |
| `DEVICE_PENDING_BEAT_SECONDS` | `25` | how often it reports while an order is outstanding. Floor 10 |
| `DEVICE_OFFLINE_GRACE_HOURS` | `336` (14 days) | how long an **issued** phone may go unheard-from before it locks itself. A phone still in the store never does |
| `DEVICE_BOOT_GRACE_MINUTES` | `5` | ordinary use a locked phone gets after a reboot, so somebody can turn wifi on and let it hear that it was freed. `0` turns it off |
| `DEVICE_BOOT_GRACE_EVERY_HOURS` | `24` | how often that window is allowed. Rebooting again buys nothing |

### 6a. The mark on the locked screen

> "For hope phones this is the logo, so the logos differ"

Every **word** on the lock screen has always come from this server, so it reads HOPE. The
**wordmark** did not — it was compiled into the APK, so a locked HOPE handset drew HOOP's mark
directly above the words "HOPE MICROCREDIT".

Two companies on one screen is worse than no logo. The officer holding that phone is deciding
whether this is their employer or somebody's scam, and the mark is what they read before any
sentence.

So the logo is now sent, like everything else on that screen.

- **`public/lock-logo.png`** is what a handset fetches. It is generated by
  `scripts/make-lock-logo.py` from `brand/hope-logo.png` — every inked pixel turned white, alpha
  untouched, trimmed to the ink — because the lock screen's ground is navy (`0xFF0B2A6B`) and
  blue ink on navy is a smudge. **Derived, never redrawn**, so the mark on a locked phone cannot
  drift from the brand file. Re-run the script only when `brand/hope-logo.png` changes; what it
  writes is checked in, so no deploy and no bench needs Python.
- **The beat carries the path and a version**, not the picture. `DEVICE_LOCK_LOGO` defaults to
  `/lock-logo.png` — **a path, not a URL**, and that is what lets one APK serve both companies:
  the handset resolves it against the server it was provisioned against, so HOPE's phones fetch
  HOPE's mark and Hoop's fetch Hoop's, off identical code. The setting may carry an absolute URL
  instead, and `none` means no mark at all.
- **The handset caches the file and redraws from disk**, because a phone that self-locks in a
  dead spot has to draw this screen with no network. `logoVersion` is what tells it the bytes
  moved; it is generated from those bytes, so it cannot name a file it does not match.
- **A released phone is told `null`**, like it is told no words. Our logo left cached on a
  leaver's handset is the opposite of handing the phone back.

Sending the picture inline instead would have cost about 480 MB a month across three hundred
handsets, on data the company pays for. The address and version cost about forty bytes a beat,
and the 16 KB image is paid once per change.

**`none` does not mean "fall back to the APK's own mark."** Falling back is exactly how HOOP's
logo lands on a HOPE phone, which is what this exists to prevent, so off means off.

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

---

## 9. Shift — moving a handset to the other company

> "another button for shift so that hoop can shift a device to hope and viceversa saving
> re-enlorrment energy"

One signed APK serves both companies. Until Shift, moving a handset from one to the other
meant **Achia**, and Achia gives up Device Owner. Taking it back is refused while any
account is signed in — a handset that has been in an officer's or an agent's hand for
months has one — so achia-then-enrol meant a **factory reset**, every time, just to change
which office a phone answers to.

Shift never lets go of ownership. The phone reads the order on its own next beat, over the
address already written into its storage, and moves itself.

### What it costs, and what it saves

|  | Achia, then enrol elsewhere | Shift |
|---|---|---|
| Device Owner | given up, then refused on re-take | **kept throughout** |
| What it needs | a factory reset, on a used phone | one drawer, one press |
| Data on the phone | wiped | untouched |

### Doing it

**On the receiving office's portal first.** Open **+ Sajili simu / Enrol** there, paste the
same IMEIs, and copy the **batch** it hands back — not the whole bench command, just the
32-character batch. That is the only thing the sending office needs from the other side;
there is no login shared between the two companies and none is created for this.

**Then on the sending office's Kufunga simu.** **↔️ Hamisha / Shift** — on the bar for a
tick-selected group, or on one phone's own row. Paste the other office's **address**
(`https://…`) and the **batch** just copied, and press Hamisha.

Nothing moves yet. The order sits on the row — **Inasubiri kuhama / shift pending** — until
the handset's own next beat, which is within fifteen minutes, or seconds if the phone is
already reporting quickly for some other reason. Once it lands the row here goes
`Imeachiwa / released`, with a reason naming the shift, and the register the phone answers
to from then on is the other one.

### It goes with its current state

> "when we shift it goes with current state"

A **locked** phone shifts locked, not blank. The order the handset carries includes the
row's own `state`, and if that is `locked` or `lost`, the RECEIVING office's row starts out
the same way — an officer who left with company property does not arrive at the other
company as an ordinary enrolled handset just because it crossed a company boundary.

This is trusted only in the safe direction: `locked` and `lost` only ever **add**
restriction, never remove it, so nothing a phone claims about itself can be used to escape
one. It is also only ever applied to a row the receiving office has not yet formed its own
opinion about — a phone that office already locked, released or wrote off for its own
reasons keeps that decision; an incoming claim never argues it away.

### What shift cannot do

- **It cannot reach a locked screen that is showing right now.** A pinned lock screen has no
  Settings and no way to receive a new order at all until it unlocks or is put back on a
  cable — same limit every order already has.
- **It cannot move a released phone.** Achia stops the beat entirely (`BeatJob.cancel`), so
  there is nothing left listening for a shift order. Shift such a phone *before* releasing
  it, or re-enrol it first.
- **It does not know the other office's address on its own.** Somebody has to type it, once,
  from a source they trust — this is deliberate: there is no standing channel between two
  separate companies' servers for one to discover the other automatically.

### From lock app 1.11.9

Handsets on an older build simply never receive a `shift` field — nothing breaks, the order
just sits on the row until the phone updates. `LockLogo` and the lock screen's words also
travel with the move: everything naming the old company is cleared and refilled from the
new office's own settings on the very next beat, so nobody rings a desk that cannot help
them.
