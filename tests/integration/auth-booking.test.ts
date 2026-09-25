import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as bookSeatRoute } from "@/app/api/bookings/route";
import { GET as myBookingsRoute } from "@/app/api/bookings/route";
import { hashPassword } from "@/lib/auth/password";
import { JWT_COOKIE_NAME } from "@/lib/auth/jwt";

describe("Authenticated JWT Desk Booking Integration Test", () => {
  const testEmail = "bookingtest.article@cbva.test";
  const password = "Password123!";
  let jwtCookieHeader = "";

  beforeAll(async () => {
    // Setup clean test user
    await db().delete(schema.users).where(eq(schema.users.email, testEmail));

    await db().insert(schema.users).values({
      email: testEmail,
      displayName: "Booking Test Article",
      grade: "article",
      team: "Audit",
      seatMode: "bookable",
      isAdmin: false,
      isActive: true,
      passwordHash: hashPassword(password),
    });

    // Sign in via API to obtain real JWT cookie header
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password }),
    });

    const loginRes = await loginRoute(loginReq);
    expect(loginRes.status).toBe(200);

    const setCookie = loginRes.headers.get("set-cookie");
    expect(setCookie).toBeDefined();

    // Extract cookie value for authentication in sub-requests
    const match = setCookie?.match(new RegExp(`${JWT_COOKIE_NAME}=([^;]+)`));
    expect(match).toBeDefined();
    jwtCookieHeader = `${JWT_COOKIE_NAME}=${match![1]}`;
  });

  it("authenticated user can book an available seat and view it in My Bookings", async () => {
    // Find an available seat
    const [availableSeat] = await db()
      .select()
      .from(schema.seats)
      .where(eq(schema.seats.status, "bookable"))
      .limit(1);

    expect(availableSeat).toBeDefined();

    const bookingDate = "2026-10-15";
    const slot = "AM";

    // 1. Post a new booking with JWT Cookie header
    const bookReq = new Request("http://localhost/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: jwtCookieHeader,
      },
      body: JSON.stringify({
        seatCode: availableSeat.seatCode,
        bookingDate,
        slot,
      }),
    });

    const bookRes = await bookSeatRoute(bookReq);
    expect(bookRes.status).toBe(201);

    const bookData = await bookRes.json();
    expect(bookData.id).toBeDefined();
    expect(bookData.seatCode).toBe(availableSeat.seatCode);

    // 2. Query /api/bookings to verify the booking belongs to this user
    const myReq = new Request("http://localhost/api/bookings", {
      method: "GET",
      headers: {
        Cookie: jwtCookieHeader,
      },
    });

    const myRes = await myBookingsRoute(myReq);
    expect(myRes.status).toBe(200);

    const myData = await myRes.json();
    expect(myData.bookings).toBeDefined();
    const created = myData.bookings.find((b: { id: string }) => b.id === bookData.id);
    expect(created).toBeDefined();
    expect(created.seatCode).toBe(availableSeat.seatCode);
  });
});
