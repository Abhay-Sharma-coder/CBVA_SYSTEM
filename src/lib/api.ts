/**
 * The boundary between HTTP and the booking services.
 *
 * Routes do three things and nothing else: resolve who is asking, validate the
 * body with zod, and translate a thrown BookingError into a status code. All
 * the judgement lives in src/lib/booking and src/lib/rooms, where it can be
 * tested without a request.
 */
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

import { auth } from "@/lib/adapters";
import { BookingError, isBookingError } from "@/lib/booking/errors";
import { getClock } from "@/lib/clock";
import { db, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import type { Clock } from "@/lib/clock";

export interface RouteContext {
  db: Db;
  clock: Clock;
  actor: User;
}

/** Who is asking. Throws rather than returning null so callers stay linear. */
export async function requireActor(): Promise<User> {
  const user = await auth().currentUser();
  if (!user) {
    throw new BookingError("NOT_SIGNED_IN", "You need to be signed in to do that.");
  }
  if (!user.isActive) {
    throw new BookingError("FORBIDDEN", "This account is no longer active.");
  }
  return user;
}

export async function routeContext(): Promise<RouteContext> {
  const [actor, clock] = await Promise.all([requireActor(), getClock()]);
  return { db: db(), clock, actor };
}

/**
 * Parses a request body, turning a zod failure into the same error shape every
 * other refusal uses so the client has one code path for "that was not allowed".
 */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new BookingError("INVALID_RANGE", "That request body was not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BookingError(
      "INVALID_RANGE",
      parsed.error.issues.map((i) => i.message).join(" "),
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

export function errorResponse(err: unknown): NextResponse {
  if (isBookingError(err)) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details ?? null },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: err.issues.map((i) => i.message).join(" "), code: "INVALID_RANGE" },
      { status: 422 },
    );
  }
  // Anything unmapped is a genuine bug and must look like one. Dressing an
  // unexpected exception up as a booking conflict would hide it forever.
  console.error("[api] unhandled error", err);
  return NextResponse.json(
    { error: "Something went wrong at our end. Nothing was changed.", code: "INTERNAL" },
    { status: 500 },
  );
}

/** Wraps a handler so every route reports failures identically. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}
