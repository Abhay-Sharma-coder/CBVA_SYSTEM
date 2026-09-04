/**
 * The dev job runner.
 *
 * In production a Vercel cron calls /api/cron/jobs; see vercel.json. In
 * development there is no cron, and without something on a timer the
 * auto-release rule would only fire when somebody remembered to press a button
 * — which is exactly how a demo goes wrong in front of a partner.
 *
 * Node runtime only; see the guard in instrumentation.ts.
 */
import { getClock } from "@/lib/clock";
import { db } from "@/lib/db";
import { runScheduledJobs } from "@/lib/jobs/run-jobs";

const INTERVAL_MS = 60_000;

if (process.env.NODE_ENV !== "production" && process.env.CBVA_DISABLE_JOB_INTERVAL !== "1") {
  let running = false;

  const tick = async () => {
    // Overlapping runs are safe by construction — every transition is a
    // conditional UPDATE — but skipping one keeps the dev log readable.
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

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
  console.info("[jobs] dev interval started — auto-release runs every 60s against the demo clock");
}
