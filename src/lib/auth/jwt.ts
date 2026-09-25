import { createHmac, timingSafeEqual } from "node:crypto";
import { SystemClock, type Clock } from "@/lib/clock";

export const JWT_COOKIE_NAME = "cbva_jwt";

const defaultClock: Clock = new SystemClock();

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
  return secret;
}

function base64UrlEncode(str: string | Buffer): string {
  const buf = typeof str === "string" ? Buffer.from(str, "utf-8") : str;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf-8");
}

export interface JwtUserPayload {
  userId: string;
  email: string;
  grade: string;
  isAdmin: boolean;
  iat?: number;
  exp?: number;
}

/**
 * Signs a JWT payload with HMAC SHA-256 (HS256).
 */
export function signJwt(
  payload: Omit<JwtUserPayload, "iat" | "exp">,
  expiresInSeconds = 7 * 24 * 3600,
  clock: Clock = defaultClock,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const iat = Math.floor(clock.now().getTime() / 1000);
  const exp = iat + expiresInSeconds;

  const fullPayload: JwtUserPayload = {
    ...payload,
    iat,
    exp,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", getSecret())
    .update(dataToSign)
    .digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${dataToSign}.${encodedSignature}`;
}

/**
 * Verifies a JWT token signature and expiration.
 * Returns decoded payload if valid, null if invalid or expired.
 */
export function verifyJwt<T = JwtUserPayload>(token: string, clock: Clock = defaultClock): T | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  try {
    const expectedSignature = createHmac("sha256", getSecret())
      .update(dataToSign)
      .digest();
    const actualSignature = Buffer.from(
      encodedSignature.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );

    if (expectedSignature.length !== actualSignature.length) return null;
    if (!timingSafeEqual(expectedSignature, actualSignature)) return null;

    const decodedPayloadStr = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(decodedPayloadStr) as T & { exp?: number };

    if (payload.exp && typeof payload.exp === "number") {
      const now = Math.floor(clock.now().getTime() / 1000);
      if (now > payload.exp) return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}
