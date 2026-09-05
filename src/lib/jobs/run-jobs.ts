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
import { materialiseSeries, type MaterialiseResult } from "@/lib/booking/series";
import type { Clock } from "@/lib/clock";
import type { Db } from "@/lib/db";
import { dispatchNotifications, type DispatchResult } from "@/lib/notifications/outbox";
import { retryCalendarSync, type RetrySyncResult } from "@/lib/rooms/service";

export interface JobRunResult {
  ranAt: string;
  autoRelease: AutoReleaseResult;
  series: MaterialiseResult;
  notifications: DispatchResult;
  calendar: RetrySyncResult;
  dryRun: boolean;
}

export async function runScheduledJobs(options: {
  db: Db;
  clock: Clock;
  /**
   * Compute what every step WOULD do and change nothing.
   *
   * Exists so the cron's effect is inspectable before it is trusted — A22 asked
   * for it by name after an unbounded run settled 577 bookings. Threaded all
   * the way down rather than short-circuiting here, because "what would the job
   * do right now" is only a useful answer if every step answers it.
   */
  dryRun?: boolean;
}): Promise<JobRunResult> {
  const { db, clock, dryRun = false } = options;

  // Order matters twice.
  //
  // Auto-release enqueues notifications, and the series materialiser enqueues
  // one for every occurrence it could not book — so dispatching after BOTH of
  // them means a released desk's email and a "could not get you that desk"
  // email both go out in the same run rather than a tick later.
  const autoRelease = await runAutoRelease({ db, clock, dryRun });
  const series = await materialiseSeries({ db, clock, dryRun });
  const notifications = dryRun
    ? { attempted: 0, sent: 0, failed: 0, exhausted: 0 }
    : await dispatchNotifications({ db, clock });
  const calendar = dryRun
    ? { attempted: 0, synced: 0, failed: 0, stillFailing: 0 }
    : await retryCalendarSync({ db, clock });

  return {
    ranAt: clock.now().toISOString(),
    autoRelease,
    series,
    notifications,
    calendar,
    dryRun,
  };
}
