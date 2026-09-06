# Runbook — the deployed demo

> ## ⚠ CURRENT STATE — READ FIRST (2026-09-06)
>
> **`npm run seed` is broken, and production currently has 0 bookings.**
>
> The seed fails part-way through with:
>
> ```
> error: column "bay_code" of relation "meeting_rooms" does not exist   (42703)
>   at scripts/seed.ts:502
> ```
>
> `scripts/seed.ts` inserts a `bay_code` column into `meeting_rooms` that is not
> in `src/lib/db/schema.ts` and not in any migration. Either the column needs
> adding in a new `drizzle/0004_*.sql` and to the schema, or the seed should
> stop writing it — whichever matches the intent behind the change.
>
> **Why production is empty rather than merely stale.** The seed deletes
> `bookings` and `room_bookings` wholesale before regenerating them (ADR-008), so
> a failure *after* the delete and *before* the insert leaves the table empty.
> That is what happened. The floor, the people, the releases and the recurring
> series all survived; only bookings and most room bookings are gone.
>
> The local database is in the same state for the same reason — it reports 5
> meeting rooms instead of 6 and 291 room bookings instead of 313.
>
> **To recover once the column is reconciled:**
>
> ```bash
> npm run seed                              # fix local first, and confirm it completes
> npm run prod:seed -- --yes-production
> npm run prod:check                        # expect ~5,800 bookings
> ```
>
> Nothing else in this runbook is affected — the wrapper, the guards and the
> credentials all work; `prod:check` correctly reports the damage.

Operating the live demo: where it is, where its credentials are, how to seed it,
and what breaks it. **If you are a new session picking this repo up, read this
before touching any database.**

---

## The two databases, and why confusing them matters

| | Neon project | Env file | Used by |
|---|---|---|---|
| **Production** (the demo) | `ep-bold-dream-b36xsna6` (c-4) | `.env.production.local` | Vercel only |
| **Local** (dev + tests) | `ep-empty-hall-az0hv77p` (c-3) | `.env.local` | `npm run dev`, `npm test`, `npm run e2e` |

Both are Neon Postgres 18 in `ap-southeast-1`, and they hold the same shape of
data — which is exactly why running the wrong command against the wrong one is
easy and silent.

**They are separate on purpose.** `npm test` and `npm run e2e` mutate demo data
deliberately: the walkthrough books, cancels and auto-releases real rows, and
`runAutoRelease` is global by design. Sharing one database would mean a local
test run changing what a partner is looking at on the live URL, mid-demo.

### Where the credentials are

**`.env.production.local`**, in the repo root. It is **not committed** —
`.gitignore` covers `.env*`, and it must stay that way. The file itself explains
what each variable is for.

If it is missing, recover it with `npx vercel env pull` (the Vercel project is
`cbva-workspace`, account `qlink149`), or read the values from the Vercel
dashboard under Project → Settings → Environment Variables.

**`CRON_SECRET` is deliberately not in that file.** It lives only in the Vercel
project. Nothing local needs it — `/api/cron/jobs` is called by Vercel Cron.

---

## Operating production

Every database script defaults to `.env.local`. Production is a **different
verb**, never a different variable:

```bash
npm run prod:check                        # read-only. Run this first, always.
npm run prod:migrate -- --yes-production  # apply drizzle/*.sql
npm run prod:seed    -- --yes-production  # rebuild the 8 weeks of demo history
npm run prod:jobs    -- --yes-production  # run auto-release / series / mail once
npm run deploy                            # vercel deploy --prod
```

`scripts/prod.mjs` prints the host it is about to touch **before doing
anything**, refuses without `--yes-production`, and refuses outright if the
resolved host looks like the local database. There is deliberately no `reset`
verb — dropping the production schema should not be one word away.

> **Why a wrapper rather than `export DATABASE_URL=…` in the docs.** Aiming a
> script at production by hand means exporting two connection strings correctly,
> in the right shell, every time. Getting it wrong rebuilds the wrong database's
> history and you find out when somebody opens the demo.

### `prod:check` before and after anything

```
target : ep-bold-dream-b36xsna6.c-4.ap-southeast-1.aws.neon.tech
db     : neondb
mode   : APP_MODE=demo

 users 141 · seats 141 · bookable 93 · bookings 5805
 live_releases 12 · series 1 · clock_offset 0 · queued_mail 0

looks presentable.
```

It warns on the four things that actually go wrong: a non-zero clock offset,
a seat or user count that is not 141 (test debris), and a backlog of queued mail
(the cron has stopped).

---

## The two routine jobs

### Re-seed after a demo, or after e2e ran against the live URL

The e2e suite books, cancels and auto-releases real rows. If it was pointed at
the deployment (`PLAYWRIGHT_BASE_URL=https://cbva-workspace.vercel.app npm run
e2e`), the live floor is left mid-walkthrough.

```bash
npm run prod:seed -- --yes-production
npm run prod:check
```

The seed is **idempotent and deterministic** — every id is a UUID v5 of its
natural key and all randomness comes from a fixed seed, so two runs produce
identical data. It deletes and rebuilds `bookings` and `room_bookings` wholesale
and upserts everything else.

**It refuses to run when `APP_MODE=production`.** `.env.production.local` sets
`APP_MODE=demo`, which is also what the deployment runs, so this works — and it
is the guard that stops anybody seeding a genuinely live installation.

### Reset the demo clock

`settings.demo_offset_seconds` is **one global row**. Advancing the clock during
a demo moves it for everybody, including anybody else with the URL open, and it
stays advanced until somebody resets it.

Easiest: the **Reset** button next to the clock readout in the app header. From
a shell, `prod:check` will tell you if it is non-zero.

---

## Deploying a change

```bash
npm run typecheck && npm run lint && npm test && npm run build   # all four
npm run prod:migrate -- --yes-production                          # only if a new drizzle/*.sql exists
npm run deploy
npm run prod:check
```

**Migrations are not wired into the build** — there is no `vercel-build` or
`postinstall` hook, so a schema change is a deliberate step. That is the safe
default; automate it only alongside a backup policy.

Migrations are hand-written and hand-registered in `drizzle/meta/_journal.json`.
`drizzle-kit generate` must not be allowed to clobber `0001`, `0002` or `0003` —
they contain partial indexes and CHECK constraints drizzle cannot express.

---

## Things that will bite you

**`NEXT_PUBLIC_APP_URL` must be set on Vercel.** It defaults to
`http://127.0.0.1:8081`, so stickers printed from `/admin/qr` without it encode
localhost and are useless on a desk. Currently
`https://cbva-workspace.vercel.app`.

**`CRON_SECRET` must be set on Vercel.** When it is unset and `APP_MODE` is not
exactly `production`, `/api/cron/jobs` is world-callable — and the demo
`AuthProvider` resolves an unknown visitor to a seeded admin, so "is the caller
an admin?" is true for anybody on the internet. ADR-041. Verify with:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://cbva-workspace.vercel.app/api/cron/jobs
# must be 401
```

**Interrupted test runs leave debris in the LOCAL database.** The integration
fixtures clean up in `afterAll`, which a killed run never reaches. Orphan seats
break the "141 desks" assertion, orphan users make the seed report 145 people,
and an orphan recurring series keeps queueing failure mail that breaks an
unrelated test. Fix:

```bash
npm run db:purge-test-data
```

**Anything that writes to `settings` in a test must snapshot and restore it.**
It is a singleton shared by every test and by the running app. One test widened
the booking window to 4000 working days and never put it back; the date strip
then offered hundreds of days and the recurring-booking materialiser dutifully
tried to book every one of them. Every test in that file timed out and none of
them looked like the cause.

**The first request after a quiet period is slow.** Cold serverless start plus a
first connection to Neon in Singapore is ~7 seconds to first byte. Warm, every
route is under 200 ms. Open a tab a minute before a demo.

---

## Recovering from a mess

**The live floor looks wrong or empty.** Almost always an advanced clock, or a
suite that ran against it.

```bash
npm run prod:check                        # look at clock_offset first
npm run prod:seed -- --yes-production
```

**The schema is behind the code.** `prod:check` will error on a missing column.

```bash
npm run prod:migrate -- --yes-production
```

**You need a completely fresh production database.** There is no `prod:reset` on
purpose. Do it deliberately: create a new Neon project, put its two connection
strings in `.env.production.local` and in the Vercel project, then
`prod:migrate` and `prod:seed`. The direct (unpooled) host is the pooled host
with `-pooler` removed; prove it with `prod:check` before migrating, because
PgBouncer's transaction pooling breaks DDL sequencing (ADR-001).

---

## Quick reference

| | |
|---|---|
| Live URL | https://cbva-workspace.vercel.app |
| Vercel project | `cbva-workspace` (account `qlink149`) |
| Production DB host | `ep-bold-dream-b36xsna6.c-4.ap-southeast-1.aws.neon.tech` |
| Local DB host | `ep-empty-hall-az0hv77p.c-3.ap-southeast-1.aws.neon.tech` |
| Credentials | `.env.production.local` (gitignored) and the Vercel project |
| Cron | `vercel.json`, `POST /api/cron/jobs`, every 5 minutes, secret-protected |
| Mode | `APP_MODE=demo` |
| Demo personas | Aarav Agarwal (partner + admin), Ananya Gokhale (article) |

Going live for real — Entra, Graph mail, the room calendar, the badge feed and
the hardening list — is **[docs/DEMO-TO-PRODUCTION.md](DEMO-TO-PRODUCTION.md)**.
