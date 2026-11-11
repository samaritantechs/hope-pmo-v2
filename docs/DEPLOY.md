# Deploying to Vercel, AWS and our own server from GitHub

One workflow, `.github/workflows/deploy.yml`, does all three:

```
push / merge to main ──▶ npm test ──▶ plan ──┬──▶ Vercel  (Deploy Hook)
                                             ├──▶ AWS     (Docker image → ECR → App Runner)
                                             └──▶ Server  (SSH → git pull → restart)
pull request to main ──▶ npm test only
Actions tab → "Test and deploy" → Run workflow ──▶ all, or just one
```

- **Nothing deploys if a test fails.**
- **A target that isn't set up is skipped**, and the run's summary page says what is missing.
  Merging the workflow before any of the setup below changes nothing: Vercel keeps deploying
  `main` through its Git integration exactly as it does now.
- **The database keys are never in GitHub.** Vercel and App Runner each keep their own.

The pieces:

| File | What it does |
|---|---|
| `.github/workflows/deploy.yml` | Tests, then deploys to both |
| `server.js` | Runs the site off Vercel: serves `public/`, routes `/api/<name>` to `api/<name>.js`, and reads the rewrites and headers **from `vercel.json`**, so both hosts follow one list. Adds no database reads to any route. |
| `Dockerfile`, `.dockerignore` | The image App Runner runs |
| `test/server.test.mjs` | Checks `server.js` answers as Vercel does |

---

## 1. GitHub (do this first)

**Settings → Environments → New environment → `production`**
- Add **required reviewers** only if every deploy should wait for an Approve click. Left empty
  there is no approval step, which is how it is set today: the owner merges at any hour ("I never
  said that rule", `docs/HANDOFF.md` Part 40).

**Settings → Branches → Add rule for `main`**
- Require a pull request, and require the status check **`test`** to pass.

---

## 2. Vercel

1. **Vercel → project → Settings → Git → Deploy Hooks.** Create one for branch `main`.
   Copy the URL.
2. **GitHub → Settings → Secrets and variables → Actions:**
   - Secret `VERCEL_DEPLOY_HOOK` = that URL
   - Variable `VERCEL_URL` = `https://hope-pmo-v2-git-main-samaritantechs.vercel.app`
3. **Stop Vercel deploying `main` by itself**, so it deploys only after the tests pass.
   Add to `vercel.json`:
   ```json
   "git": { "deploymentEnabled": { "main": false } }
   ```
   Branch and PR previews keep working. **Do this only after a workflow run has deployed
   through the hook successfully**, and confirm on the next run that the hook still deploys.
   Until this step, `main` is deployed twice per merge (once by Vercel, once by the hook),
   which is harmless.

Why a Deploy Hook and not the Vercel CLI: a hook deployment is a Git deployment of `main`, so
the `...-git-main-...` address **every phone opens** keeps following it. A CLI deployment would
not move that address.

---

## 3. AWS

Use **one region**, and make it **the same region as the Supabase project** (Supabase →
Project Settings → General). Every screen's cost is counted in round trips to the database; a
trip between regions multiplies all of them.

### 3a. Image registry (ECR)
ECR → Create repository → name `hope-pmo`.

### 3b. Let GitHub in without stored keys (OIDC)
1. IAM → Identity providers → Add → OpenID Connect:
   URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. IAM → Roles → Create role → Web identity → that provider. Trust policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
       "Action": "sts:AssumeRoleWithWebIdentity",
       "Condition": {
         "StringEquals": {
           "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
           "token.actions.githubusercontent.com:sub": "repo:samaritantechs/hope-pmo-v2:environment:production"
         }
       }
     }]
   }
   ```
   Only a job in the `production` environment of this repository can use the role.
3. Permissions for the role:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
       { "Effect": "Allow",
         "Action": ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
                    "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage"],
         "Resource": "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/hope-pmo" },
       { "Effect": "Allow",
         "Action": ["apprunner:StartDeployment", "apprunner:ListOperations"],
         "Resource": "arn:aws:apprunner:<REGION>:<ACCOUNT_ID>:service/hope-pmo/*" }
     ]
   }
   ```

### 3c. The first image
App Runner needs an image to exist before the service can be created. Run the workflow once
by hand (Actions → Test and deploy → Run workflow → `aws`) after setting the variables in 3e
**except** `APPRUNNER_SERVICE_ARN` -- it will be skipped. Instead push one image yourself:
```bash
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
docker build -t <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/hope-pmo:production .
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/hope-pmo:production
```

### 3d. App Runner service
App Runner → Create service:
- Source: **Container registry → Amazon ECR**, image `hope-pmo:production`
- Deployment trigger: **Manual** (the workflow starts each deployment)
- Port **8080**
- Health check: **HTTP**, path **`/healthz`**
- Environment variables -- copy every one from Vercel → Settings → Environment Variables:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  (**the same pair**, or every push subscription stops working), `RESEND_API_KEY`,
  `DEVICE_SHIFT_SECRET`, `IMPREST_LINK_SECRET`, and the `HOPELOAN_*` ones if set.
  Put the keys in Secrets Manager and reference them, rather than pasting them in plain.
- Auto scaling: **minimum 2 instances**, so one instance being replaced never leaves the call
  app with nothing.
- Custom domain: your production address, e.g. `pmo.<company>.co.tz`.

Requests may run up to 120 seconds on App Runner, longer than the 45-second upload budget.
**Do not put API Gateway in front**: it cuts requests at ~30 seconds and would fail uploads.

### 3e. GitHub variables
Settings → Secrets and variables → Actions → **Variables**:

| Variable | Example |
|---|---|
| `AWS_REGION` | `eu-west-1` (the Supabase region) |
| `AWS_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/github-deploy-hope-pmo` |
| `ECR_REPOSITORY` | `hope-pmo` |
| `APPRUNNER_SERVICE_ARN` | `arn:aws:apprunner:<REGION>:<ACCOUNT_ID>:service/hope-pmo/...` |
| `AWS_URL` | `https://pmo.<company>.co.tz` |

---

## 3S. Your own server (SSH → git pull → restart)

On every push to `main` that passes the tests, GitHub logs in to the server over SSH, moves
the clone to **exactly the commit that was tested**, runs `npm ci` only if `package.json` or
`package-lock.json` changed, and restarts the service. Run all of this **on the server**
(Ubuntu shown; Node 22 must be installed).

**Our server today:** `Hope-PMO-Supabase` (EC2 `i-0cd8c9c057b57abca`, t3a.xlarge, Hope account,
eu-west-1), Elastic IP `108.132.254.187`, served at **https://recovery-app.sync-book.net** by
Caddy (`/etc/caddy/Caddyfile`, Let's Encrypt, 120 s proxy timeouts). Steps 1–4 below are
already done on it, except that the clone uses the public HTTPS URL instead of a deploy key.
The unit has `ConditionPathExists=/srv/hope-pmo/server.js`, so it stays idle until the first
deploy that carries this file. It also runs self-hosted Supabase in `/opt/supabase`, which
starts **empty** — `/etc/hope-pmo.env` must point at a database that has the schema before
this site is used.

**1. A user that owns the app, and the clone.** The server pulls with its own read-only key:
```bash
sudo adduser --disabled-password --gecos "" deploy
sudo mkdir -p /srv/hope-pmo && sudo chown deploy:deploy /srv/hope-pmo
sudo -u deploy ssh-keygen -t ed25519 -N "" -f /home/deploy/.ssh/id_ed25519 -C "hope-pmo server pull"
sudo cat /home/deploy/.ssh/id_ed25519.pub
```
GitHub → repo → **Settings → Deploy keys → Add deploy key**, paste it, **leave "Allow write
access" off**. Then:
```bash
sudo -u deploy git clone git@github.com:samaritantechs/hope-pmo-v2.git /srv/hope-pmo
cd /srv/hope-pmo && sudo -u deploy npm ci --omit=dev
```

**2. The keys, outside the repository.** `/etc/hope-pmo.env`, owned by root, mode `600` —
the same variables as Vercel (see 3d): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the
**same** `VAPID_*` pair, `RESEND_API_KEY`, `DEVICE_SHIFT_SECRET`, `IMPREST_LINK_SECRET`,
`HOPELOAN_*`, and `PORT=8080`.

**3. The service.** `/etc/systemd/system/hope-pmo.service`:
```ini
[Unit]
Description=HOPE PMO
After=network-online.target

[Service]
User=deploy
WorkingDirectory=/srv/hope-pmo
EnvironmentFile=/etc/hope-pmo.env
ExecStart=/usr/bin/node server.js
Restart=always
# server.js finishes requests in flight on SIGTERM; give it longer than an upload slice.
TimeoutStopSec=70

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now hope-pmo
curl -s localhost:8080/healthz      # → ok
```
Put nginx or Caddy in front for HTTPS. Keep its proxy timeout **above 60 seconds**
(`proxy_read_timeout 120s;`) or long uploads are cut off.

**4. Let the deploy user restart the service, and nothing else:**
```bash
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart hope-pmo' | sudo tee /etc/sudoers.d/hope-pmo
sudo chmod 440 /etc/sudoers.d/hope-pmo
```

**5. The key GitHub logs in with** (a different key from step 1). On your own machine:
```bash
ssh-keygen -t ed25519 -N "" -f gh-deploy -C "github actions → hope-pmo server"
ssh-keyscan <server-host>          # copy the output for SERVER_KNOWN_HOSTS
```
Append `gh-deploy.pub` to `/home/deploy/.ssh/authorized_keys` on the server. Then in GitHub
→ **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Secret | `SERVER_SSH_KEY` | the whole contents of `gh-deploy` (the private key) |
| Variable | `SERVER_HOST` | the server's IP or name |
| Variable | `SERVER_USER` | `deploy` |
| Variable | `SERVER_APP_DIR` | `/srv/hope-pmo` |
| Variable | `SERVER_KNOWN_HOSTS` | the `ssh-keyscan` output |
| Variable | `SERVER_URL` | `https://<your domain>` — checked after each deploy |
| Variable | `SERVER_PORT` | only if SSH is not on 22 |
| Variable | `SERVER_RESTART_CMD` | only if not `sudo systemctl restart hope-pmo` |

Then delete `gh-deploy` from your machine; GitHub holds the only copy.

**6. Try it:** Actions → Test and deploy → Run workflow → `server`.

**One server means a short gap on every deploy.** The restart takes a second or two, and in
that time the server answers nothing — the call app included. Nothing in flight is lost
(`server.js` finishes it first), but requests in the gap fail and the phones retry. Merges
land at any hour, so the cure is at the proxy and not on the clock: section 6, item 3 is the
one line that makes Caddy wait for the service to come back instead of answering 502.

**Never edit files in `/srv/hope-pmo` by hand.** If a hand edit touches a file that a new commit
also changes, or if you commit on the server, the next deploy stops with "Not possible to
fast-forward" and leaves the running site as it was. To recover:
`git -C /srv/hope-pmo reset --hard origin/main`, then run the workflow again.

---

## 4. What one run does

1. **test** -- `npm ci`, `npm test`. On a pull request, that is all.
2. **plan** -- reads `BUILD` from `public/app.html` and decides which targets are set up. The
   summary page lists what will deploy and what was skipped and why.
3. **vercel** -- calls the Deploy Hook, then reads `/app.html` from `VERCEL_URL` until it
   serves this `BUILD` (up to 10 minutes) and checks `/api/app-version` answers.
4. **aws** -- builds the image, tags it with the commit and `:production`, pushes to ECR,
   starts an App Runner deployment and waits for it (up to 20 minutes). App Runner moves
   traffic only once new instances pass `/healthz`; old instances finish their requests in
   flight first (`server.js` waits on shutdown). Then it checks `/healthz`, `/api/app-version`
   and that `/app.html` carries this `BUILD`.

5. **server** -- SSH in, fast-forward the clone to this commit, `npm ci` if packages changed,
   restart, then check `/healthz`, `/api/app-version` and the `BUILD` at `SERVER_URL`.

The targets deploy side by side. One failing does not stop or undo the others; the run shows
which one failed.

**The `BUILD` check confirms new code is live only when `BUILD` changed.** A server-only
change keeps the same `BUILD`, so the check then only confirms the site is answering.

**Rolling back AWS:** every image is also tagged with its commit. In ECR, re-tag the commit you
want as `production` and start a deployment in App Runner.

---

## 5. Before AWS becomes what people use

Today Vercel and AWS both point at the production database, which is correct while both are
production. The phones still open the Vercel address. Moving them, and making Vercel a
development site with its own database, is a separate step -- in this order:

1. AWS is live and tested on its own domain.
2. Settings → `APP_BASE_URL` = the AWS domain. Tell HOOP (their `DEVICE_SHIFT_PARTNER`).
3. New APK: `startUrl` in `android/app/build.gradle` and `base_url` in `android-apk.yml` set to
   the AWS domain, `versionCode` raised in `app-version.json`. Phones update themselves.
4. Wait until every handset has updated.
5. Only then point Vercel at a separate development Supabase project.

---

## 6. Checked before the phones move (11 November 2026)

The code was read against what Vercel does for it, to find anything that would behave differently on
a server of our own. `recovery-app.sync-book.net` itself could not be reached from the session that
did this, so the items under "to confirm on the server" are questions, not findings.

### Fixed in `server.js`

| What Vercel did unasked | What a phone saw off Vercel | Now |
|---|---|---|
| Answered "not changed" (304) to a page the phone already holds | The whole page again on every reopen: `/call` is 187 KB, and a handset reloads it after almost every call | Every file carries an `ETag` and `Last-Modified`; a reopen is a 304 with no body |
| Compressed every page | `/call` 187 KB where it was 63 KB; `/dashboard` 488 KB where it was 162 KB | Pages and scripts are gzipped once per version and kept |
| Compressed every API answer | A defaulter list at several times its compressed size, on mobile data | JSON answers over 1 KB are gzipped on the thread pool, never on the serving thread |
| Ended one invocation on a stray rejected promise | The one process serving everybody would exit | Logged, and the server keeps serving |

A proxy that also compresses (Caddy `encode`) leaves an already-compressed answer alone.

### Nothing to change

- **Routes and headers** come from `vercel.json` on both hosts. There are no Vercel cron jobs.
- **No handler** reads a raw body, redirects, streams, or looks at a Vercel-only header or variable.
- **Clocks**: server code works East Africa time out from UTC arithmetic, never from the machine's
  own time zone.
- **The handset's identity** on the Android app is the app's own (`HopeCalls.getDeviceId()`), not the
  browser's storage, so a registered phone stays registered when the address changes.
- **Variables the code reads**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HOPELOAN_ENABLED`,
  `HOPELOAN_SUPABASE_URL`, `HOPELOAN_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `DEVICE_SHIFT_SECRET`,
  `IMPREST_LINK_SECRET`, and the optional budgets `UPLOAD_BUDGET_MS`, `DASH_PREV_BUDGET_MS`,
  `DASH_MONTH_BUDGET_MS`, `DASH_FLOORS_BUDGET_MS`, `CALL_SUMMARY_MAX_INFLIGHT`. Nothing else.

### To confirm on the server before anyone works on it

1. **Which database `/etc/hope-pmo.env` points at.** If `SUPABASE_URL` is the production project,
   both sites are one book and nothing can diverge. If it is the Supabase on this server, it is a
   COPY: whatever is uploaded, called or commented on the Vercel site after the copy was taken is
   not in it, and the reverse. Two sites on two books must never both be worked on.
   **This can now be read from outside:** each site's `/api/app-version` carries `book`, a
   fingerprint of the database it reads (`docs/HANDOFF.md` Part 43). The same `book` at both
   addresses is one database; a different one is two.
2. **One process serves everybody.** On Vercel a heavy portal report runs apart from the phones.
   In one Node process it holds the single serving thread while it computes, and every handset's
   request waits behind it. Run two copies of the service -- one for `/call`, `/api/call` and
   `/api/upload`, one for everything else -- and have the proxy send each path to its own port
   (`PORT` is already a variable). No code change.
3. **A deploy restarts the service.** Requests in flight finish; new ones in the second or two it
   takes to come back are refused, and the proxy answers 502. In Caddy,
   `reverse_proxy 127.0.0.1:8080 { lb_try_duration 15s  lb_try_interval 250ms }` makes it wait
   and retry instead. Vercel swaps versions with no gap, and merges land at any hour.
4. **If the database is on this machine too**: backups are ours to take (Supabase took them
   daily), every `db/RUN-ME-*.sql` must have been run on it, and it shares four burstable cores
   with the site.

### What moving the address changes for people

- **Browser users** (not the Android app) hold their device identity and access code in the
  browser, per address: they sign in again once, and a call-app user in a browser registers again
  with the same phone number.
- **Imprest alerts in a browser** are tied to the address: approvers allow notifications again on
  the new one. Alerts inside the Android app are not affected.
- Section 5's order still stands: `APP_BASE_URL`, HOOP's `DEVICE_SHIFT_PARTNER`, a new APK with the
  new `startUrl`, wait for every handset, and only then repoint Vercel.
