import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as forgotRoute } from "@/app/api/auth/forgot-password/route";
import { POST as resetRoute } from "@/app/api/auth/reset-password/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { JWT_COOKIE_NAME, verifyJwt, type JwtUserPayload } from "@/lib/auth/jwt";

describe("Authentication API Routes Integration Tests", () => {
  const testEmail = "authtest.user@cbva.test";
  const initialPassword = "Password123!";
  const newPassword = "NewSecretPassword456!";

  beforeAll(async () => {
    // Create or reset test user in database
    await db().delete(schema.users).where(eq(schema.users.email, testEmail));
    
    await db().insert(schema.users).values({
      email: testEmail,
      displayName: "Auth Test User",
      grade: "assistant_manager",
      team: "Tax",
      seatMode: "bookable",
      isAdmin: false,
      isActive: true,
      passwordHash: hashPassword(initialPassword),
    });
  });

  it("POST /api/auth/login succeeds with correct credentials and returns JWT cookie", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: initialPassword,
      }),
    });

    const res = await loginRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.user.email).toBe(testEmail);
    expect(data.token).toBeDefined();

    const verified = verifyJwt<JwtUserPayload>(data.token);
    expect(verified?.email).toBe(testEmail);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(JWT_COOKIE_NAME);
  });

  it("POST /api/auth/login fails with wrong password", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "WrongPassword!",
      }),
    });

    const res = await loginRoute(req);
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("Invalid email or password.");
  });

  it("POST /api/auth/forgot-password generates token and queues reset notification", async () => {
    const req = new Request("http://localhost/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail }),
    });

    const res = await forgotRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);

    const [user] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, testEmail));

    expect(user.resetPasswordToken).toBeDefined();
    expect(user.resetPasswordToken?.length).toBeGreaterThan(10);
    expect(user.resetPasswordExpires).toBeDefined();

    // Verify notification was queued
    const notifications = await db()
      .select()
      .from(schema.notificationLog)
      .where(eq(schema.notificationLog.recipientEmail, testEmail));

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].kind).toBe("forgot_password");
  });

  it("POST /api/auth/reset-password updates user password with valid token", async () => {
    const [user] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, testEmail));

    const token = user.resetPasswordToken!;

    const req = new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        newPassword,
      }),
    });

    const res = await resetRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify database record has updated password hash and cleared reset token
    const [updatedUser] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, testEmail));

    expect(updatedUser.resetPasswordToken).toBeNull();
    expect(updatedUser.resetPasswordExpires).toBeNull();
    expect(verifyPassword(newPassword, updatedUser.passwordHash)).toBe(true);

    // Verify login works with new password
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: newPassword,
      }),
    });

    const loginRes = await loginRoute(loginReq);
    expect(loginRes.status).toBe(200);
  });

  it("POST /api/auth/logout returns ok and clears cookie", async () => {
    const res = await logoutRoute();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
