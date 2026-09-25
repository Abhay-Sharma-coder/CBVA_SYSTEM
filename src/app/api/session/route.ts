import { NextResponse } from "next/server";
import { auth } from "@/lib/adapters";
import { readDemoOffsetSeconds } from "@/lib/clock";
import { serverEnv } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Returns the authenticated identity only; it never exposes a user picker. */
export async function GET() {
  const [user, offsetSeconds] = await Promise.all([
    auth().currentUser(),
    readDemoOffsetSeconds(),
  ]);

  return NextResponse.json({
    appMode: serverEnv().appMode,
    offsetSeconds,
    user: user
      ? {
          email: user.email,
          displayName: user.displayName,
          grade: user.grade,
          seatMode: user.seatMode,
          isAdmin: user.isAdmin,
          team: user.team,
        }
      : null,
  });
}
