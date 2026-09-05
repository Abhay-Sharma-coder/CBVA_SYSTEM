import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { auth } from "@/lib/adapters";
import { errorResponse } from "@/lib/api";
import { getClock } from "@/lib/clock";
import { serverEnv } from "@/lib/config";
import { db } from "@/lib/db";
import { runScheduledJobs } from "@/lib/jobs/run-jobs";

export const dynamic = "force-dynamic";
// The job holds transactions and talks to the calendar adapter; it is not an
// edge-runtime workload (ADR-002).
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Constant-time comparison, so the endpoint does not leak the secret one byte
 * at a time to anybody willing to measure. Cheap, and the alternative is a
 * genuinely exploitable side channel on a route that mutates bookings.
 */
function secretMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function authorise(request: Request): Promise<boolean> {
  const { cronSecret, appMode } = serverEnv();

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; curl and the demo
  // panel may send the header directly. Both are accepted.
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const header = request.headers.get("x-cron-secret");

  if (cronSecret && (secretMatches(bearer, cronSecret) || secretMatches(header, cronSecret))) {
    return true;
  }

  // In demo mode an admin may run the jobs from the demo panel. This is what
  // makes "advance the clock, then watch the desk release" a deterministic
  // step in a walkthrough rather than a wait for the next interval tick.
  if (appMode !== "production") {
    const user = await auth().currentUser();
    if (user?.isAdmin) return true;
    // A laptop with no secret configured should not be locked out of its own
    // demo; production always requires one.
    if (!cronSecret) return true;
  }

  return false;
}

async function run(request: Request): Promise<NextResponse> {
  try {
    if (!(await authorise(request))) {
      return NextResponse.json(
        { error: "This endpoint requires the scheduled-job secret.", code: "FORBIDDEN" },
        { status: 401 },
      );
    }
    const clock = await getClock();
    // ?dryRun=1 reports what the tick WOULD do and changes nothing. A job that
    // can rewrite attendance history should be inspectable without running it —
    // see ASSUMPTIONS A22.
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    const result = await runScheduledJobs({ db: db(), clock, dryRun });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  return run(request);
}

/**
 * Vercel Cron issues a GET. Mutating on GET is normally wrong, but this is not
 * a URL a browser ever follows: it is unlinked, secret-gated, and the platform
 * gives no choice about the verb.
 */
export async function GET(request: Request) {
  return run(request);
}
