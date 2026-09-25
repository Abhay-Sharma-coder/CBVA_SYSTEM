import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "@/lib/db";
import { dispatchSoon } from "@/lib/notifications/outbox";

import { getClock } from "@/lib/clock";

export const dynamic = "force-dynamic";

const forgotSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
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

    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 }
      );
    }

    const email = parsed.data.email.toLowerCase().trim();

    const [user] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (user && user.isActive) {
      const resetToken = randomBytes(32).toString("hex");
      const expiresAt = new Date(clock.now().getTime() + 60 * 60 * 1000); // 1 hour

      await db()
        .update(schema.users)
        .set({
          resetPasswordToken: resetToken,
          resetPasswordExpires: expiresAt,
        })
        .where(eq(schema.users.id, user.id));

      // Enqueue notification email in outbox
      await db().insert(schema.notificationLog).values({
        kind: "forgot_password",
        recipientEmail: user.email,
        subject: "CBVA Workspace — Password Reset Request",
        body: `<div style="font-family: sans-serif; max-width: 600px; color: #14181F;">
          <h2 style="color: #1E2A5A; margin-top: 0;">Reset Your Password</h2>
          <p>Hello ${user.displayName},</p>
          <p>We received a request to reset your password for your CBVA Workspace account.</p>
          <p style="margin: 24px 0;">
            <a href="/auth/reset-password?token=${resetToken}" style="background-color: #1E2A5A; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 500;">Reset Password</a>
          </p>
          <p style="font-size: 14px; color: #4A5568;">
            Or copy and paste this token into the password reset page:<br/>
            <code style="background-color: #F7FAFC; padding: 4px 8px; border: 1px solid #E2E8F0; border-radius: 4px; font-family: monospace;">${resetToken}</code>
          </p>
          <p style="font-size: 13px; color: #718096; margin-top: 24px;">This request link and token will expire in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
        </div>`,
        channel: "email",
        status: "queued",
        attempts: 0,
      });

      dispatchSoon();

      return NextResponse.json({
        ok: true,
        found: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        message: "Employee email verified in database.",
        resetToken,
        resetUrl: `/auth/reset-password?token=${resetToken}`,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        found: false,
        error: `No registered employee account found with email "${email}". Please check the spelling.`,
      },
      { status: 404 }
    );
  } catch (err) {
    console.error("[forgot-password] error", err);
    return NextResponse.json(
      { error: "An error occurred while processing your request." },
      { status: 500 }
    );
  }
}
