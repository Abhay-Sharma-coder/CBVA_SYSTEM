import { request } from "@playwright/test";

/**
 * Warms every route before the suite runs.
 *
 * `next dev` compiles a route the first time it is requested, and Phase 3 took
 * the app from four routes to ten. The first navigation to each was costing
 * five to fifteen seconds, which is most of Playwright's default assertion
 * budget spent on webpack rather than on the thing being asserted — and it
 * showed up as tests that passed in a warm sequence and failed on a cold one,
 * which is the worst kind of failure to read.
 *
 * Warming here rather than raising every timeout keeps the timeouts meaningful:
 * a five-second wait for a URL to change should still mean something is wrong.
 */
const ROUTES = [
  "/",
  "/floor",
  "/bookings",
  "/rooms",
  "/styleguide",
  "/admin",
  "/admin/floor-plan",
  "/admin/notifications",
  "/admin/qr",
  "/api/session",
  "/api/clock",
  "/api/floor/dates",
  "/api/bookings",
  "/api/rooms",
];

export default async function globalSetup(): Promise<void> {
  const baseURL = `http://127.0.0.1:${process.env.PORT ?? 8081}`;
  const context = await request.newContext({ baseURL });

  const started = Date.now();
  for (const route of ROUTES) {
    try {
      // Sequential on purpose: `next dev` compiles one route at a time anyway,
      // and firing fourteen at once just makes the log unreadable.
      await context.get(route, { timeout: 120_000 });
    } catch {
      // A route that will not warm is a real failure, but it is the tests' job
      // to say so with a useful message rather than this hook's.
    }
  }
  await context.dispose();
  console.log(`[e2e] warmed ${ROUTES.length} routes in ${Math.round((Date.now() - started) / 1000)}s`);
}
