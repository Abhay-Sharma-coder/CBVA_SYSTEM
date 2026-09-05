# Phase 5 handoff

The part CBVA actually bought. Everything below has been run; where a number
appears it was measured, not estimated.

**Live: https://cbva-workspace.vercel.app**

---

## 1 · What changed

`/admin` was a `PhaseStub`. Four phases had built the instrument that collects
occupancy data and none of them had produced a number a partner could act on —
there were **no aggregate queries anywhere in the codebase**. The only `group
by` in `src/` was an orphan check inside `updateSettings`.

```bash
npm test         # 203 vitest, up from 158
npm run e2e      # playwright, incl. a 22-surface axe sweep (was 9)
npm run build    # clean; /floor first load 239 kB against Phase 4's 238
npm run seed     # afterwards, because the suite books and cancels real rows
```

| | |
|---|---|
| Analytics | 3 screens, 1 measure vocabulary, 3 measures side by side, CSV export |
| Admin operations | seats · people · settings · audit · jobs |
| Adoption features | who's in · release your allocated desk · recurring bookings |
| Closed | A22 (auto-release is bounded), A24 (desks no longer overlap) |
| New assumptions | A25–A28 |
| ADRs | 034–041 |

---

## 2 · The headline, and why it is phrased carefully

> Over 40 working days the busiest single slot saw **76 desks** in use against a
> bookable pool of **93**. Even at its fullest the floor had 17 desks spare.

Peak, 95th percentile and median are shown together on purpose. A single maximum
is one anecdote and it is the number a room anchors on; p95 is what you would
size a floor against. The gap between median (63) and peak (76) is what CBVA is
paying for peak-day capacity.

**The screen carries its own caveat inline.** A1 (the Manager / Assistant
Manager split) and A16 (whether anybody sits in Zone B) together fix that
denominator, and both are still open. If Zone B is occupied the pool is nearer
115 and every percentage is overstated by roughly a quarter. Presenting 82%
without that sentence would be the most damaging thing this product could do.

### The findings that fell out of the data

| | |
|---|---|
| **Wednesday busiest, Monday quietest** | Mon 56.4 · Tue 66.4 · Wed 69.1 · Thu 65.4 · Fri 57.1 mean desks. The shape a one-day-a-week WFH policy makes. |
| **The passage runs are the least used desks** | PA and PD sit at 38–59% utilisation; the workstation bays run 67–100%. The ten least-used desks are all PA/PD. |
| **No-shows cost 2,460 desk-hours over eight weeks** | The gap between the two seat-hours accountings, which is exactly the `completed_no_show` total. |

---

## 3 · The measure vocabulary, and the question it refuses to answer

`src/lib/analytics/measures.ts` is the single definition of what occupancy
means — the role `SEAT_STATUS_TOKENS` plays for seat colour. All eight booking
statuses are partitioned explicitly by what each is evidence OF.

**All three candidate measures ship side by side**, with the definitions on
screen beside them, because CBVA has not decided how an auto-released desk
should be counted. Picking for them and presenting one confident number would
put an invented assumption into a board pack with nothing attached to it.

### Three traps, each of which produces a plausible wrong number rather than an error

**1 · `released_at` is overloaded.** The job writes it on the
`completed_no_show` transition as well as on `auto_released`, and the seed writes
a *different* value for the same status. So:

```sql
coalesce(released_at, cancelled_at, ends_at)   -- WRONG
```

under-counts no-show hours by ~50% on demo data and 0% in production. Every arm
`CASE`s on status instead. `tests/integration/analytics.test.ts` asserts the
exact contribution of one row in each of the eight statuses, **in both shapes**.
It is the most important test added this phase.

**2 · "Seats booked" is three numbers.** `seat_slot_unique` is partial, so after
an auto-release the desk is legitimately rebooked and both rows complete —
`count(*)` can exceed capacity and `count(distinct seat_id)` cannot be a demand
figure. The gap between them *is* the rebooking finding.

**3 · A distinct count cannot be grouped by weekday.** Over eight weeks nearly
every desk is used on some Monday, so every weekday returns ~93 and the chart
that exists to show Mondays are dead renders flat — hiding the exact finding it
was built for. Aggregate per day, then average.

**The same trap bit the heat map one query later**, in a different costume: bay
× weekday as a distinct count draws a picture of which bays are BIGGEST, not
which are busiest. It is now each bay against its own desk count, and the PA/PD
finding above only appears once it is right.

---

## 4 · The three adoption features

The risk on this engagement was never that booking is hard. It is that seat
contention is low enough that people stop bothering, and occupancy data nobody
generates is worth nothing.

**Releasing an allocated desk** is the load-bearing one. 47 desks are allocated
and therefore contribute nothing to any measurement — an empty allocated desk is
counted as neither used nor free. This is the only route by which they are ever
measured, which is why a feature that looks like a courtesy is actually part of
the product.

- A row per (seat, date, slot), never a status flip: status is a property of the
  DESK, this is a property of a desk on a DAY (ADR-036).
- **One boolean on `seatVisualStatus`, and no eighth status.** The seven-status
  vocabulary is proven desaturated on `/styleguide` and bridged by the 3D
  materials. A released desk stops being reserved and flows through the existing
  paths — which also means `countsAsCapacity` picks it up for free.
- The race is revoke-versus-book, and it stays in the database: the insert takes
  the release `FOR UPDATE` in the same statement. Proved with two concurrent
  sessions.
- Reclaiming a desk somebody has booked is refused **with their name**, and
  admin-forcible; a forced reclaim lands as `cancelled_by_admin`, which is why
  ADR-024 kept that status separate from a no-show.

**Recurring bookings** have no exceptions table.
`booking_series_occurrence_unique` is deliberately NOT partial on status, so a
cancelled occurrence still occupies the key and **the cancelled booking IS the
tombstone** (ADR-037). Nothing to keep in sync. The cost is one line:
`editBooking` must null `series_id` on the rebooked row, or cancel-and-rebook
collides with its own tombstone.

**Who's in** closed a real leak on the way. `/api/floor` returned every
occupant's name to anybody, including a signed-out visitor. Names are now
signed-in-only and gated on `users.share_attendance` — and opting out hides the
NAME, never the desk, so **no occupancy figure moves when anybody changes that
setting.** That property is what makes the opt-out safe to offer.

---

## 5 · A22 closed: the auto-release job is bounded

A test once drove this job from a clock set to 2099 and it settled **577
bookings**, emptying the demo floor. Nothing complained; it was noticed because
the plan looked wrong afterwards.

**When the cap trips, the transition applies NOTHING** — not a partial batch.
This is the part worth defending. A plain `LIMIT 250` would have settled those
577 rows over three cron ticks instead of one: the same catastrophe, three
minutes slower, and now indistinguishable from normal operation in the audit
log. **A bound that only slows a runaway down is not a bound.**

Plus a horizon that counts what it skips, a dry run threaded through every job,
and — the part no downstream bound can do — the cause fixed at source:
`demo_offset_seconds` is now CHECKed to ±30 days in the database and clamped at
`POST /api/clock`, which previously accepted any integer.

---

## 6 · Defects found and fixed

Nine, and the two that matter most were found by **probing the running system
rather than by reading the code**.

1. **`/api/cron/jobs` answered 200 to an unauthenticated POST on the deployed
   URL.** It accepted an admin session as an alternative to the secret in demo
   mode — harmless on a laptop, a hole in public, because the demo
   `AuthProvider` deliberately resolves an unknown visitor to a seeded admin.
   **"Is the caller an admin?" was true for anybody on the internet.** The A22
   bounds meant they could not have emptied the floor with it; that is not a
   reason to leave it open. The secret is now the only way in when one is
   configured, and the demo panel uses the session-gated admin route instead.
   ADR-041.

2. **A booking on a released desk had no `updatedAt`.** `db.execute` returns the
   driver's raw snake_case rows, so `returning *` produced `updated_at` while
   everything downstream reads camelCase. `updatedAt` IS the optimistic lock —
   the first attempt to edit such a booking would have failed the comparison
   with a stale-row error nobody could act on. Caught by an assertion about
   `releaseId`, which is the same bug wearing a less alarming hat.

3. **The bay heat map drew bay size, not utilisation** (§3).

4. **By zone and by team saturated the same way**, for the same reason.

5. **The outcome table printed 0 cancellations.** `claims` counts only statuses
   that held a desk, so it is zero for the two cancelled ones by construction —
   the table was quietly contradicting the paragraph above it, which is exactly
   the failure ADR-024 exists to prevent.

6. **A client component dragged `pg` into the browser bundle.** One label
   constant imported from `queries.ts` and the build failed on
   `Can't resolve 'fs'`. ADR-031's trap one layer down: types survive erasure,
   runtime values do not. ADR-039.

7. **The clock ban caught `new Date()` in the analytics range picker.** Not a
   formality — with the demo clock advanced, a browser-derived range ends before
   the data the rest of the screen shows, and the charts silently lose their
   most recent points mid-demo.

8. **"Today is a working day" ignored weekends**, so a Saturday reported "the
   floor is entirely free" — technically true, completely misleading.

9. **`CardTitle` rendered an `h3` directly under the page `h1`.** Fixing it
   needed `font-sans` explicitly, because `globals.css` puts the serif on every
   `h1, h2` as the page-title face: promoting the level would otherwise have
   quietly put Source Serif on every card in the product.

### And one that was ours, in the tests

**The `settings` singleton was being widened and never restored.**
`seat-release.test.ts` widens the booking window to 4000 working days for its
2099 fixtures. `settings` is shared by every test *and by the running
application*, so the date strip started offering hundreds of days and the
recurring-booking materialiser — behaving perfectly — tried to create four
hundred bookings per series. Every test in that file timed out and none of them
looked like the cause.

Worth stating as a rule: **anything that writes to `settings` in a test must
snapshot and restore it.** The helpers to do so already existed.

---

## 7 · Verification — all run

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | **203 passed**, up from 158 |
| `npm run build` | clean; `/floor` 239 kB first load (Phase 4: 238) |
| `npm run seed` twice | idempotent |
| axe, 22 surfaces | 0 critical, 0 serious |
| Lighthouse accessibility | **100** on every route measured |
| Responsive 390/768/1280/1440 | no horizontal scroll on any route |
| A24 | 15 colliding desk pairs → **0** |

### Lighthouse, on the deployment

| Route | Perf | A11y | Best practices | SEO | FCP | LCP | TBT |
|---|---|---|---|---|---|---|---|
| `/` | 76 | 100 | 100 | 100 | 1.2 s | 2.5 s | 660 ms |
| `/floor` | 60 | 100 | 100 | 100 | 1.0 s | 4.3 s | 1090 ms |
| `/bookings` | 79 | 100 | 100 | 100 | 1.1 s | 2.6 s | 540 ms |
| `/rooms` | 79 | 100 | 100 | 100 | 1.1 s | 2.7 s | 680 ms |
| `/who` | 76 | 100 | 100 | 100 | 1.1 s | 2.7 s | 850 ms |
| `/admin/analytics` | 67 | 100 | — | — | 1.1 s | 3.5 s | 880 ms |

Performance is the weakest column and `/floor` is the weakest row — see §8.

### Cold load, fresh browser profile per route

| Route | TTFB | FCP | Content visible | Transfer |
|---|---|---|---|---|
| `/` (cold lambda) | 7.1 s | 10.5 s | — | 416 KB |
| `/floor` | 175 ms | 848 ms | 5.2 s | 797 KB |
| `/bookings` | 160 ms | 2.7 s | 4.4 s | 409 KB |
| `/who` | 167 ms | 672 ms | 4.9 s | 416 KB |
| `/admin/analytics` | 183 ms | 2.3 s | 5.5 s | 438 KB |

**The 7-second TTFB on the first row is a cold serverless start plus a first
connection to Neon in Singapore.** Warm, every route is under 200 ms to first
byte. It matters for exactly one page view per demo, and the demo script says to
open a tab early because of it.

**"Content visible" is 4–5 seconds everywhere**, and that is the honest number:
the shell paints fast, then a client-side query fetches the data. See §8.

---

## 8 · The weakest part of the build

**Every screen paints its shell in under a second and then waits four more for
its data.**

The cause is one decision made repeatedly: every data-bearing screen is a client
component that fetches through TanStack Query after hydration. So the sequence
is HTML → JS → hydrate → fetch → render, and the fetch is a round trip to
Singapore against a database that has to compute eleven aggregates. The user
sees a skeleton for four seconds on a screen whose numbers could have been in
the first byte.

`/floor` is worst (LCP 4.3 s, TBT 1090 ms) because it also ships a 2048px webp
and 141 interactive nodes.

**What I would do first with another day**, in order:

1. **Move the analytics fetch to the server component.** The filters are already
   in the URL, so the page can read them, call the same query module, and hand
   the client a fully-formed payload as initial data. It is one file per screen
   and it turns a 5.5-second wait into a first paint that already has the
   numbers on it.
2. **Cache the trends query.** The eight-week window changes once a day. Sixty
   seconds of `revalidate` would take the repeat cost to zero without any risk
   of showing a stale *today*.
3. **Split the analytics response.** The headline needs one query; it currently
   waits for eleven, including the per-seat utilisation table nobody has
   scrolled to yet.

None of this is architectural — the query module is already server-only and
already takes its filters as an argument. It is where the render happens, and
that is a per-screen change.

---

## 9 · Notes for whoever picks this up

- **`measures.ts` is the only place occupancy is defined.** If a number needs to
  change it changes there. The seat-hours test asserts eight exact values in two
  shapes; if you simplify the `CASE`, one of them moves.
- **Anything that writes to `settings` in a test must restore it.** §6.
- **`types.ts` must not import anything with a runtime dependency**, or `pg`
  reaches the browser again. ADR-039.
- **The chart token ORDER is part of the validated result.** The CVD checks are
  on adjacent pairs; amber beside red fails. Reordering `--cbva-chart-1..4` is
  not a style change.
- **Do not add an `error.tsx`.** ADR-032 and ADR-040. Widgets fail alone.
- **A26 is the sharpest open trap.** If CBVA moves to hourly slots — which
  ADR-020 makes a settings change — the auto-release grace window becomes longer
  than a slot, auto-release silently becomes unreachable, and every no-show
  starts costing a full slot instead of a partial one. Nothing breaks; the
  feature stops existing and a number moves. `hourly-slots.test.ts` is the
  natural place to catch it.
- **A24 is only half closed.** The eleven desks no longer overlap; their
  positions are still inferred, and they are still flagged that way. Fifteen
  minutes in `/admin/floor-plan` with somebody who knows the floor closes it
  properly.
- **The demo clock is one shared row.** Now that there is a public URL, two
  people demoing at once will move it for each other. A10, and the demo script
  warns about it.
- **I could not test on a physical phone.** Everything was verified at 390 px in
  a real mobile emulation with a mobile user-agent, over the public URL, and
  there is no horizontal scroll on any route — but a real handset check is
  somebody else's to do.
