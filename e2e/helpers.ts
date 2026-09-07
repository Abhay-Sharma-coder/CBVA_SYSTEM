/**
 * Shared e2e plumbing.
 *
 * Two things every Phase 3 spec needs and Phase 2 had no use for: signing in as
 * a particular person, and putting the shared demo clock back where it was.
 *
 * The clock offset lives in `settings.demo_offset_seconds` — one row, shared by
 * the whole database (ASSUMPTIONS A10). Playwright runs with one worker for
 * exactly this reason, but a spec that advances the clock and does not reset it
 * leaves every later spec, and the dev server, running two hours into the
 * future.
 */
import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Everything here works on an `APIRequestContext`, not a `Page`.
 *
 * Tests pass `page.request`; a `beforeAll` passes the worker-scoped `request`
 * fixture. Driving these through a throwaway page meant closing it while a
 * request was still settling, which surfaces as "Request context disposed" and
 * fails the hook — and a failed hook in a serial spec skips every test after it.
 */
type Http = APIRequestContext;

export interface Persona {
  email: string;
  displayName: string;
  grade: string;
  seatMode: "fixed" | "bookable";
  isAdmin: boolean;
}

/**
 * Signs in by posting to the same route the role switcher uses, so the cookie
 * is set the way production sets it rather than being fabricated.
 */
export async function signInAs(http: Http | Page, email: string): Promise<void> {
  const api = "request" in http ? http.request : http;
  const res = await api.post("/api/session", { data: { email } });
  if (!res.ok()) throw new Error(`Could not sign in as ${email}: ${await res.text()}`);
}

export async function personas(request: APIRequestContext): Promise<Persona[]> {
  const res = await request.get("/api/session");
  const body = (await res.json()) as { roles: Persona[] };
  return body.roles;
}

/** The first person of a grade the role switcher offers. */
export async function personaOfGrade(
  request: APIRequestContext,
  grade: string,
): Promise<Persona> {
  const all = await personas(request);
  const found = all.find((p) => p.grade === grade);
  if (!found) throw new Error(`No seeded persona with grade ${grade}`);
  return found;
}

/** The shared clock's "now", as the server sees it. */
export async function clockNow(page: Page): Promise<Date> {
  const res = await page.request.get("/api/clock");
  const body = (await res.json()) as { now: string };
  return new Date(body.now);
}

/**
 * Moves the shared clock to a specific instant.
 *
 * Advancing by a fixed number of hours is not enough for anything that has to
 * happen INSIDE a slot: the first bookable day is often days away, and a
 * check-in window is measured from that slot's start. So the delta is computed
 * from where the clock actually is.
 */
/**
 * Move the demo clock TO a moment, forwards or backwards.
 *
 * It used to refuse to go backwards -- `if (seconds <= 0) return;` -- which
 * made it silently do NOTHING once the wall clock had passed the target, and
 * that is far worse than failing. The walkthrough asks for "half an hour into
 * the 09:00 slot" and then "two and a half hours into it"; run any time after
 * 11:30 both calls became no-ops, every later assertion was then made against
 * the real time, and step 9 failed claiming the auto-release job had settled
 * nothing — when what had actually happened is that its own baseline run, at
 * the real time and already past the grace window, had settled everything
 * first. The test reported the opposite of the truth.
 *
 * `POST /api/clock` accepts +/- 7 days per call and the offset is CHECKed to
 * +/- 30 days (A22), so a backwards move is bounded exactly as a forwards one
 * is. A demo clock that can only ever go forwards is not a clock, it is a
 * ratchet.
 */
export async function advanceClockTo(page: Page, target: Date): Promise<void> {
  const now = await clockNow(page);
  const seconds = Math.round((target.getTime() - now.getTime()) / 1000);
  if (seconds === 0) return;
  await advanceClock(page, seconds);
}

export async function advanceClock(page: Page, seconds: number): Promise<void> {
  const res = await page.request.post("/api/clock", {
    data: { action: "advance", seconds },
  });
  if (!res.ok()) throw new Error(`Could not advance the clock: ${await res.text()}`);
}

export async function resetClock(http: Http | Page): Promise<void> {
  const api = "request" in http ? http.request : http;
  await api.post("/api/clock", { data: { action: "reset" } });
}

/** Runs auto-release, the notification queue and the calendar retry, now. */
export async function runJobs(page: Page): Promise<{
  autoRelease: { released: number; markedNoShow: number; completed: number };
  notifications: { sent: number; failed: number };
}> {
  const res = await page.request.post("/api/cron/jobs");
  if (!res.ok()) throw new Error(`Could not run the jobs: ${await res.text()}`);
  return res.json();
}

/** Waits for the header to have hydrated. The universal "the page is live" cue. */
export async function settled(page: Page): Promise<void> {
  await page.getByLabel("Sign in as a different person (demo)").waitFor();
  await page.waitForLoadState("networkidle");
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
}

/**
 * Cancels every upcoming booking this person holds.
 *
 * The walkthrough books a desk and then relies on being able to book another —
 * and the engine correctly refuses a second desk in the same slot (edge case
 * 9). Without this the spec passes once and then fails for the rest of the day
 * with a perfectly correct error message.
 *
 * It goes through the real DELETE route rather than the database, so the clean
 * slate is produced by the product rather than around it. The clock is reset
 * first because past the cut-off a user cannot cancel, which is the whole point
 * of the cut-off.
 */
export async function clearUpcomingBookings(http: Http, email: string): Promise<number> {
  await signInAs(http, email);
  await resetClock(http);

  const res = await http.get("/api/bookings");
  const body = (await res.json()) as { upcoming: Array<{ id: string }> };

  let cleared = 0;
  for (const booking of body.upcoming) {
    const deleted = await http.delete(`/api/bookings/${booking.id}`, { data: {} });
    if (deleted.ok()) cleared += 1;
  }
  return cleared;
}
