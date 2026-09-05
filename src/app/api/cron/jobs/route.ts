import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

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

  /**
   * IF A SECRET IS CONFIGURED, IT IS THE ONLY WAY IN. No session shortcut.
   *
   * This route used to accept an admin session in demo mode, so the demo panel
   * could run the jobs. On a laptop that is harmless. On a PUBLIC DEMO URL it
   * is a hole, and a subtle one: the demo AuthProvider deliberately resolves an
   * unknown visitor to a seeded admin, so "is the caller an admin?" is true for
   * anybody on the internet. The deployed endpoint answered 200 to an
   * unauthenticated POST, which meant a stranger could drive the job loop.
   *
   * The bounds added for A22 mean they could not empty the floor with it. That
   * is not a reason to leave it open.
   *
   * The demo panel now calls POST /api/admin/jobs instead, which is gated on an
   * admin session like every other admin action — the same posture as the rest
   * of the admin area, rather than a second front door with different rules.
   *
   * The no-secret case stays open on purpose: a laptop with nothing configured
   * should not be locked out of its own demo, and `npm run dev` sets nothing.
   */
  if (appMode !== "production" && !cronSecret) return true;

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
