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
export async function signInAs(page: Page, email: string): Promise<void> {
  const res = await page.request.post("/api/session", { data: { email } });
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
export async function advanceClockTo(page: Page, target: Date): Promise<void> {
  const now = await clockNow(page);
  const seconds = Math.ceil((target.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return;
  await advanceClock(page, seconds);
}

export async function advanceClock(page: Page, seconds: number): Promise<void> {
  const res = await page.request.post("/api/clock", {
    data: { action: "advance", seconds },
  });
  if (!res.ok()) throw new Error(`Could not advance the clock: ${await res.text()}`);
}

export async function resetClock(page: Page): Promise<void> {
  await page.request.post("/api/clock", { data: { action: "reset" } });
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
 * slate is produced by the product rather than around it. `force` is not
 * available to a user, so the clock is reset first: past the cut-off, cancelling
 * is refused, which is the whole point of the cut-off.
 */
export async function clearUpcomingBookings(page: Page, email: string): Promise<number> {
  await signInAs(page, email);
  await resetClock(page);

  const res = await page.request.get("/api/bookings");
  const body = (await res.json()) as { upcoming: Array<{ id: string }> };

  let cleared = 0;
  for (const booking of body.upcoming) {
    const deleted = await page.request.delete(`/api/bookings/${booking.id}`, { data: {} });
    if (deleted.ok()) cleared += 1;
  }
  return cleared;
}
