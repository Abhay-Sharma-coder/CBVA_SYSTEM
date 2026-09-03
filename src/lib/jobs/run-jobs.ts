/**
 * Everything that happens without somebody clicking.
 *
 * One entry point, called from three places: a 60-second interval in dev, a
 * Vercel cron in production, and a button in the demo panel. All three run the
 * same code against the same Clock, which is what makes "advance the demo clock
 * two hours and watch the desk release" a demonstration of production behaviour
 * rather than a simulation of it.
 *
 * Each step is independently safe to run concurrently, so overlapping runs are
 * not a problem worth engineering around.
 */
import { runAutoRelease, type AutoReleaseResult } from "@/lib/booking/auto-release";
import type { Clock } from "@/lib/clock";
import type { Db } from "@/lib/db";
import { dispatchNotifications, type DispatchResult } from "@/lib/notifications/outbox";
import { retryCalendarSync, type RetrySyncResult } from "@/lib/rooms/service";

export interface JobRunResult {
  ranAt: string;
  autoRelease: AutoReleaseResult;
  notifications: DispatchResult;
  calendar: RetrySyncResult;
}

export async function runScheduledJobs(options: {
  db: Db;
  clock: Clock;
}): Promise<JobRunResult> {
  const { db, clock } = options;

  // Order matters exactly once: auto-release enqueues notifications, so
  // dispatching after it means a released desk's email goes out in the same run
  // rather than a minute later.
  const autoRelease = await runAutoRelease({ db, clock });
  const notifications = await dispatchNotifications({ db, clock });
  const calendar = await retryCalendarSync({ db, clock });

  return {
    ranAt: clock.now().toISOString(),
    autoRelease,
    notifications,
    calendar,
  };
}
