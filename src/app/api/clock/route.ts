import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceDemoClock, getClock, readDemoOffsetSeconds, resetDemoClock } from "@/lib/clock";
import { serverEnv } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * The shared clock. The browser reads "now" from here rather than from its own
 * Date, so the client and server never disagree about whether a slot has
 * started — and so shifting the demo clock moves the whole product at once.
 */
export async function GET() {
  const clock = await getClock();
  return NextResponse.json({
    now: clock.now().toISOString(),
    offsetSeconds: await readDemoOffsetSeconds(),
    appMode: serverEnv().appMode,
  });
}

const bodySchema = z.union([
  /**
   * Bounded to +/- 30 days, matching the settings_demo_offset_bounded CHECK.
   *
   * This is the ACTUAL cause of the A22 incident, closed at source. The offset
   * was an unbounded integer, and one fat-fingered value moves the clock far
   * enough that every future booking in the database looks expired — at which
   * point the auto-release job settles the lot while behaving perfectly
   * correctly. No downstream bound can fix a wrong input; only rejecting the
   * input can. A single step is capped tighter still, at 7 days, because every
   * legitimate demo move is hours.
   */
  z.object({
    action: z.literal("advance"),
    seconds: z.number().int().min(-604_800).max(604_800),
  }),
  z.object({ action: z.literal("reset") }),
]);

/**
 * Shifts the demo clock. Phase 3 uses this to demonstrate auto-release: advance
 * two hours and the REAL job runs the REAL rule and really releases the seat.
 */
export async function POST(request: Request) {
  if (serverEnv().appMode === "production") {
    return NextResponse.json(
      { error: "The clock cannot be shifted in production mode." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Send {"action":"advance","seconds":N} or {"action":"reset"}.' },
      { status: 400 },
    );
  }

  if (parsed.data.action === "reset") {
    await resetDemoClock();
  } else {
    await advanceDemoClock(parsed.data.seconds);
  }

  const clock = await getClock();
  return NextResponse.json({
    now: clock.now().toISOString(),
    offsetSeconds: await readDemoOffsetSeconds(),
  });
}
