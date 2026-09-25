import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hashes a plaintext password using scrypt with a random 16-byte salt.
 * Returns formatted "salt:hash" string.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored "salt:hash" string.
 */
export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(":")) {
    return false;
  }

  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;

  try {
    const actualHash = scryptSync(password, salt, 64).toString("hex");
    const bufActual = Buffer.from(actualHash, "hex");
    const bufExpected = Buffer.from(expectedHash, "hex");

    if (bufActual.length !== bufExpected.length) return false;
    return timingSafeEqual(bufActual, bufExpected);
  } catch {
    return false;
  }
}
