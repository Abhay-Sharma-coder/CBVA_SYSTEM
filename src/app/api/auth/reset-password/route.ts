import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, gte, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

import { getClock } from "@/lib/clock";

export const dynamic = "force-dynamic";

const resetSchema = z.object({
  token: z.string().min(1, "Reset token is required."),
  newPassword: z
    .string()
    .min(6, "New password must be at least 6 characters long."),
});

export async function POST(request: Request) {
  try {
    const clock = await getClock();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 }
      );
    }

    const { token, newPassword } = parsed.data;
    const now = clock.now();

    const [user] = await db()
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.resetPasswordToken, token),
          gte(schema.users.resetPasswordExpires, now)
        )
      )
      .limit(1);

    if (!user || !user.isActive) {
      return NextResponse.json(
        {
          error:
            "Invalid or expired password reset token. Please request a new password reset.",
        },
        { status: 400 }
      );
    }

    const newHash = hashPassword(newPassword);

    await db()
      .update(schema.users)
      .set({
        passwordHash: newHash,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      })
      .where(eq(schema.users.id, user.id));

    return NextResponse.json({
      ok: true,
      message:
        "Your password has been successfully reset. You can now sign in with your new password.",
    });
  } catch (err) {
    console.error("[reset-password] error", err);
    return NextResponse.json(
      { error: "An error occurred while resetting your password." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { valid: false, error: "Reset token is missing." },
        { status: 400 }
      );
    }

    const clock = await getClock();
    const now = clock.now();

    const [user] = await db()
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.resetPasswordToken, token),
          gte(schema.users.resetPasswordExpires, now)
        )
      )
      .limit(1);

    if (!user) {
      return NextResponse.json({
        valid: false,
        error: "Invalid or expired reset token. Please request a new password reset.",
      });
    }

    return NextResponse.json({
      valid: true,
      user: {
        email: user.email,
        displayName: user.displayName,
      },
    });
  } catch (err) {
    console.error("[verify-token] error", err);
    return NextResponse.json(
      { valid: false, error: "An error occurred while verifying the reset token." },
      { status: 500 }
    );
  }
}
