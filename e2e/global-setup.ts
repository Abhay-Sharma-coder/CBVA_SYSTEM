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
 *
 * A PLAIN GET IS NOT ENOUGH, and this cost an afternoon to see. `next dev`
 * compiles the HTML render and the client router payload as separate pieces of
 * work, and a soft navigation — which is what every link in the shell does —
 * fetches the second one, with an `RSC: 1` header. Warming only with GETs left
 * the first client-side navigation of the suite still paying a compile, so
 * `shell.spec.ts` failed on cold runs and passed on warm ones with the URL
 * simply never changing. Each page route is therefore warmed twice: once as a
 * document, once as a flight response.
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

  /* ---------------------------------------------- Phase 5 additions ----
   *
   * Not optional. `next dev` compiles a route on its first request, and the
   * admin screens are the heaviest in the product — /admin/seats took 47
   * seconds and /admin and /admin/users blew a 60-second test timeout outright
   * on the first cold run. Three specs failed with `page.goto` timeouts that
   * looked like accessibility failures and were webpack.
   */
  "/who",
  "/me",
  "/admin/analytics",
  "/admin/analytics/today",
  "/admin/analytics/forecast",
  "/admin/seats",
  "/admin/users",
  "/admin/settings",
  "/admin/audit",
  "/admin/jobs",
  "/api/admin/analytics?view=trends",
  "/api/admin/seats",
  "/api/admin/users",
  "/api/admin/settings",
  "/api/admin/audit",
  "/api/admin/jobs",
  "/api/series",
  "/api/me",
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
      // The router payload, as a soft navigation would ask for it. API routes
      // are not navigable, so they get the document request only.
      if (!route.startsWith("/api/")) {
        await context.get(route, { headers: { RSC: "1" }, timeout: 120_000 });
      }
    } catch {
      // A route that will not warm is a real failure, but it is the tests' job
      // to say so with a useful message rather than this hook's.
    }
  }
  await context.dispose();
  console.log(`[e2e] warmed ${ROUTES.length} routes in ${Math.round((Date.now() - started) / 1000)}s`);
}
