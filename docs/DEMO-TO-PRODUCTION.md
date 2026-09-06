# From demo to production

What actually has to change to run this for real, what CBVA has to supply, and
roughly what each item costs. Written so somebody who did not build it can price
and schedule the work.

**The short version.** The product is complete; four integrations are stubbed
because they need tenant access we do not have. The stubs are not placeholders
in the usual sense — each one is a real interface with a working demo
implementation behind it and a production class whose methods **throw with a
TODO naming the exact API call**. Replacing them does not touch booking logic,
because booking logic has never known which implementation is live.

Total engineering: **roughly 8–13 working days**, of which about half is blocked
on CBVA rather than on us.

---

## 1 · What blocks go-live, in order

| # | Item | Blocked on | Effort |
|---|---|---|---|
| 1 | **Entra ID sign-in** | CBVA IT: app registration | 2–3 days |
| 2 | **Graph `sendMail`** | CBVA IT: service account + `Mail.Send` consent | 0.5–1 day |
| 3 | **The HR list** | CBVA HR | 0.5 day to load, once supplied |
| 4 | **Room calendar sync** | A CBVA *decision* first (see §4), then IT | 1 day one-way, 4–6 days two-way |
| 5 | **Badge reader feed** | CBVA facilities: vendor + format | 1–2 days, unknown until the format is |
| 6 | **The seat allocation, rooms, holidays** | CBVA, but self-service | 0 — an afternoon in the admin screens |
| 7 | **Production hardening** | Nobody | 1–2 days |

Items 1 and 2 are the only hard blockers. The product runs without 4 and 5 —
it simply keeps recording bookings and check-ins by QR, which is the majority of
the value.

---

## 2 · Authentication — Microsoft Entra ID

**Today:** `DemoAuthProvider` returns the seeded user named by a `cbva_role`
cookie, which the role switcher writes. That is why anybody can become anybody
in the demo.

**What CBVA IT must do:**

1. Register an application in the CBVA tenant.
2. Return the **tenant ID**, **client ID**, and a **client secret**.
3. Add the redirect URI for wherever this is hosted.
4. Grant delegated `openid`, `profile`, `email`, `User.Read`.

**What we do** — `src/lib/adapters/production.ts` → `EntraAuthProvider`:

- `@azure/msal-node` confidential client, authorisation-code flow with PKCE.
- Validate the `id_token` and map the **`preferred_username` claim onto
  `users.email`**.
- **403 anybody with no matching row. No just-in-time user creation** — grade
  and seat mode decide who must book and who has a desk, and those must come
  from HR rather than from whatever is in a token.
- Session cookie: `httpOnly`, `sameSite=lax`, `secure`.

**Also delete:** the role switcher and the demo panel are already hidden when
`APP_MODE=production`; `POST /api/session` and `POST /api/clock` already return
403. Confirm rather than rebuild.

**Effort: 2–3 days.** The variance is entirely in how long the app registration
takes to arrive.

**Note on email as the join key.** We assumed `firstname.lastname@cbva.in`. If
the tenant uses anything else, `users.email` must be reloaded from the tenant
before anybody signs in — otherwise every user 403s. It is worth exporting the
Entra user list at the same time as the HR list and reconciling once.

---

## 3 · Email — Microsoft Graph `sendMail`

**Today:** `DemoMailProvider` writes nothing. The `notification_log` row is
already written inside the booking transaction; the demo provider is a no-op
transport, which is why `/admin/notifications` shows every message as it would
have been sent.

**What CBVA IT must do:** a service account mailbox (e.g.
`workspace@cbva.in`), plus the `Mail.Send` **application** permission with admin
consent.

**What we do** — `GraphMailProvider.send`: `POST
/users/{service-account}/sendMail`.

**What must not change, and it is the important part.** The outbox pattern
stays: the message row is written inside the booking transaction with
`status='queued'`, delivery happens afterwards, and a send failure is recorded
on the message and never propagated. So a committed booking always has its
message, and Graph being down can never roll back somebody's desk. The retry
path already exists and already runs on the cron.

**Effort: half a day to one day.** It is one HTTP call into a structure that
already exists.

---

## 4 · Meeting rooms — a decision before any code

**This one needs a CBVA decision first, and it is the item most likely to
embarrass the product in front of staff.** Full statement in
`docs/OPEN-QUESTIONS.md` §3.

The product enforces one booking per room per time range in the database with a
constraint that cannot be raced. That holds for bookings made **here**. If the
six rooms exist as Outlook room resource mailboxes — and in a Microsoft 365
tenant they almost certainly do — staff will keep booking them from the Outlook
picker, our grid will show the hour free, and two groups will arrive.

**Option A — exclusive booking rights.** Room mailboxes configured so only the
service account may book them; staff are directed here.

- CBVA: reconfigure six mailboxes.
- Us: one-way `GraphCalendarSync.upsert` / `.remove`, which is already written
  as a stub with the exact endpoints. **~1 day.**
- Result: our guarantee is the actual truth.
- Cost: staff lose the Outlook room picker.

**Option B — two-way sync.** Subscribe to Graph change notifications per room
mailbox, mirror external bookings into `room_bookings` before rendering the grid.

- CBVA: `Calendars.ReadWrite` application permission, plus a public HTTPS
  endpoint for the notification subscription.
- Us: subscription lifecycle (they expire and must be renewed), a delta
  reconciliation, conflict handling, and a backfill for anything missed while a
  subscription was dead. **~4–6 days.**
- Result: Outlook keeps working; the guarantee weakens from "impossible" to
  "usually caught quickly", because a race between an Outlook booking and ours
  is resolved by whichever Graph tells us about first. That is reconciliation,
  not a constraint, and it should be described that way to staff.

**Either way** we need `meeting_rooms.outlook_resource_email`, which is null on
all six rows today. Desk booking is unaffected — desks have no second system.

---

## 5 · Badge check-in

**Today:** `DemoCheckInSource` is driven by a button in the demo panel. The
`badge_events` table already exists and `bookings.check_in_method` already
records `qr` / `badge` / `app` / `admin` separately.

**Blocked on:** the access-control vendor and their export format, neither of
which we know.

**Expected shape:** an authenticated webhook POSTing swipes to `/api/badge`,
written into `badge_events`, with `reader_id` mapped to a floor, reconciled
against bookings on `(occupant_user_id, swiped_at within slot bounds)`.

**Effort: 1–2 days once the format is known**, and genuinely unknowable before
that. Some vendors offer a webhook; some offer a nightly CSV drop, which would
mean same-day check-in never works and the analytics gets badge data a day late.

**Why bother, given QR works.** A QR at the desk proves which desk; a badge at
the door proves somebody reached the floor. Together they are much stronger than
either. The schema keeps them apart on purpose so they are never blended into
one misleading "attended" figure.

---

## 6 · The clock

**One line, and it is already written.** `getClock()` in `src/lib/clock.ts`
selects on `APP_MODE`: `DemoClock` (system time plus a shared database offset)
in demo, `SystemClock` in production. Setting `APP_MODE=production` swaps it.

`POST /api/clock` already 403s in production, so the offset cannot be moved.

**Nothing in business logic changes**, because nothing in business logic reads
the system clock — an eslint rule fails the build on `new Date()` outside
`src/lib/clock.ts`. That rule is the reason this is one line rather than an
audit.

**Do check:** `settings.demo_offset_seconds` should be 0 in the production
database before go-live. It is ignored by `SystemClock`, but leaving it set is
confusing for whoever next reads the settings row.

---

## 7 · What CBVA must supply, apart from tenant access

| Data | Why | Where it goes |
|---|---|---|
| **The HR list** — name, email, grade, team, allocated desk | Sets the denominator for every occupancy figure. The biggest single open question | Admin → People, or a one-off import |
| **Sign-off on the 47 allocated desks** | The floor plan currently draws desks we invented as reserved | Admin → Seats |
| **The real room inventory** — names, capacities, resource mailboxes | Names are entirely ours; mailboxes block the calendar sync | Seed or admin |
| **The official holiday circular** | A wrong date means somebody cannot book a day they are expected in | Admin → Settings |
| **Confirmation of the slot boundaries** | 09:00–17:00 implies nothing bookable in the evening | Admin → Settings |
| **A decision on the auto-release measure** | Which of the three occupancy figures is *the* number | Nothing to change — all three ship |
| **Seat numbering sign-off** | Our seat codes came from bay position, not from any label on a desk | Admin → Seats / floor plan editor |

Everything below the first two is self-service and needs no deployment.

---

## 8 · Production hardening — our list, not CBVA's

Things that are fine for a demo and should not go live untouched.

**Must do**

1. **`CRON_SECRET` is mandatory.** `serverEnv()` already requires it when
   `APP_MODE=production`. Verify it is set before the first deploy — the
   endpoint mutates bookings.
2. **Rotate the demo database credentials.** The demo Neon connection strings
   have been in a chat log and in CI environment variables. Production gets new
   ones.
3. **Re-check the auto-release bounds against the real floor.**
   `auto_release_batch_cap` defaults to 250, chosen as roughly four times a
   93-desk pool. If CBVA turns out to have 126 bookable desks, or moves to
   hourly slots (eight slots a day rather than two), raise it — otherwise a
   legitimate catch-up run trips the cap and settles nothing.
4. **Decide what happens to `/styleguide` and `/admin/floor-plan`.** Both are
   internal tools. The floor-plan editor writes to a file on disk, which does
   not work on a serverless host — it silently no-ops in production and should
   either be removed or backed by object storage.

**Should do**

5. **Real error reporting.** There is none. A widget error boundary logs to the
   browser console and the API logs a 500 to the server console; neither reaches
   anybody. Sentry or equivalent, half a day.
6. **A backup policy for the Neon database.** The booking history *is* the
   product; there is no point protecting the code and not the data.
7. **Rate-limit the write endpoints.** Nothing today stops a script booking 500
   desks. Low risk on an internal tool behind Entra, non-zero.
8. **CI.** There is no pipeline — `npm test`, `npm run typecheck`, `npm run
   lint` and `npm run build` are run by hand. Half a day of GitHub Actions.

**Worth knowing**

9. **The dev job interval does not run on Vercel**, by design — production uses
   the `vercel.json` cron every five minutes. If this is ever hosted somewhere
   without a scheduler, `npm run jobs:run` must be put on one. Without it,
   nothing auto-releases and the occupancy data quietly becomes booking data.
10. **`instrumentation-node.ts`'s 60-second interval is dev-only** and is
    guarded on `NODE_ENV !== "production"`.

---

## 9 · The deployment as it stands

| | |
|---|---|
| **Host** | Vercel, project `cbva-workspace` |
| **URL** | https://cbva-workspace.vercel.app |
| **Database** | Neon Postgres 18, `ep-bold-dream-b36xsna6`, ap-southeast-1 |
| **Mode** | `APP_MODE=demo` |
| **Cron** | `vercel.json`, `POST /api/cron/jobs` every 5 minutes, secret-protected |

**Environment variables** (all set in the Vercel project, Production scope):

```
APP_MODE=demo
DATABASE_URL             # Neon POOLED  — the Next.js runtime
DATABASE_URL_UNPOOLED    # Neon DIRECT  — migrations, seed, tests
CRON_SECRET              # required; the cron route mutates bookings
NEXT_PUBLIC_APP_URL      # the origin printed desk QR codes point at
```

> **`NEXT_PUBLIC_APP_URL` must be set before anybody prints the QR sheet.** It
> defaults to `http://127.0.0.1:8081`, so stickers printed without it encode
> localhost and are useless on a desk.

**Two databases on purpose.** The deployment uses its own Neon project; local
development, `npm test` and `npm run e2e` use a separate one. The suites mutate
demo data deliberately — the walkthrough books, cancels and auto-releases real
rows — so sharing one database would mean a test run changing what a partner is
looking at.

**Migrations are not wired into the build.** There is no `vercel-build` or
`postinstall` hook, so `npm run db:migrate` is a deliberate step against the
production connection string before deploying a schema change. That is the safe
default; automate it only alongside a backup policy.

### Deploying a change

```bash
npm run typecheck && npm run lint && npm test && npm run build   # all four
npm run prod:check                        # FIRST: does production match this code?
npm run prod:migrate -- --yes-production  # only if prod:check says the schema is behind
npm run deploy
npm run prod:check                        # again
```

`docs/RUNBOOK.md` is the operating guide and takes precedence over this section.

### Nothing sequenced migrations against deploys, and that is the general problem

**This is the single most important operational finding in the project**, and it
generalises well past the column it took production down over.

For five phases, `npm run db:migrate` and the deploy were unrelated commands run
by a person who had to remember the order. That was invisible the whole time
because **no phase before the sixth added a column.** The first one that did —
`meeting_rooms.bay_code`, `drizzle/0004` — was applied to the LOCAL database,
because every database script in this repo defaults to `.env.local`. The deploy
then promoted code that selects that column, every meeting-room query failed
with `42703`, and `/rooms` and `/` were down until it was rolled back.

The recovery cost more than the outage: the seed deletes `bookings` and
`room_bookings` wholesale before regenerating them (ADR-008), so failing between
the delete and the insert left production with **zero bookings and one meeting
room** — eight weeks of demo history, rebuilt because a column was missing.

**Why this gets worse, not better, from here.** Production is currently a demo
with an invented roster. The moment CBVA's HR list arrives (A1), every one of
these lands as a schema or data change against a database that holds real
people: grades, allocated seats, room names, Outlook mailbox addresses, the
holiday circular. Each is a migration; each is an opportunity to run exactly
this sequence in exactly the wrong order.

**What Phase 7 did about it.** `prod:check` now compares
`drizzle.__drizzle_migrations` against `drizzle/meta/_journal.json` and **fails,
non-zero**, naming any migration the code carries and production has not
applied. It runs before the deploy as well as after. That converts the trap from
"a step somebody has to remember" into "a gate that says no".

**What it does not do, and should.** It is still a gate a person has to run.
The durable fix is a release step that migrates and deploys as one operation,
which needs the CI that item 8 above says does not exist. Until then the order in
the runbook is load-bearing and `prod:check` is what enforces it.

---

## 10 · What does NOT change

Worth saying explicitly, because it is most of the product:

- **No booking logic changes.** It has never known which adapter is live.
  `APP_MODE` is branched on in exactly one file.
- **No schema changes.** `badge_events`, `check_in_method` and
  `outlook_resource_email` are all already modelled for integrations that do not
  exist yet.
- **No clock changes.** One selector, already written.
- **No analytics changes.** They read the same tables whether a booking arrived
  through a demo click or an Entra-authenticated session.

The work is at the edges. That was the point of building it this way.
