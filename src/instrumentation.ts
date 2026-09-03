/**
 * The dev job runner.
 *
 * In production a Vercel cron calls /api/cron/jobs; see vercel.json. In
 * development there is no cron, and without something running on a timer the
 * auto-release rule would only ever fire when somebody remembered to press a
 * button — which is exactly the way a demo goes wrong in front of a partner.
 *
 * Next calls `register()` once per server process, so this is the one place a
 * long-lived timer can live in an App Router app.
 */
export async function register(): Promise<void> {
  // Only the Node.js runtime; the edge runtime has no long-lived process to
  // hang a timer on, and the job holds transactions (ADR-002).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;
  if (process.env.CBVA_DISABLE_JOB_INTERVAL === "1") return;

  const { getClock } = await import("@/lib/clock");
  const { db } = await import("@/lib/db");
  const { runScheduledJobs } = await import("@/lib/jobs/run-jobs");

  const INTERVAL_MS = 60_000;
  let running = false;

  const tick = async () => {
    // Overlapping runs are safe by construction, but skipping one keeps the
    // dev log readable when a run is slow.
    if (running) return;
    running = true;
    try {
      const clock = await getClock();
      const result = await runScheduledJobs({ db: db(), clock });
      const { released, markedNoShow, completed } = result.autoRelease;
      if (released || markedNoShow || completed || result.notifications.sent) {
        console.info(
          `[jobs] released ${released} · no-show ${markedNoShow} · completed ${completed} · sent ${result.notifications.sent}`,
        );
      }
    } catch (err) {
      console.error("[jobs] run failed", err);
    } finally {
      running = false;
    }
  };

  setInterval(() => void tick(), INTERVAL_MS).unref?.();
  console.info("[jobs] dev interval started — auto-release runs every 60s against the demo clock");
}
