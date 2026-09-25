import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signJwt, verifyJwt } from "@/lib/auth/jwt";

describe("Password and JWT Authentication Unit Tests", () => {
  describe("Password Hashing & Verification", () => {
    it("hashes passwords into salt:hash format and verifies correctly", () => {
      const plain = "SuperSecret123!";
      const hash = hashPassword(plain);

      expect(hash).toContain(":");
      expect(hash.split(":").length).toBe(2);

      expect(verifyPassword(plain, hash)).toBe(true);
      expect(verifyPassword("WrongPassword", hash)).toBe(false);
    });

    it("returns false for invalid or missing hashes", () => {
      expect(verifyPassword("test", "")).toBe(false);
      expect(verifyPassword("test", null as unknown as string)).toBe(false);
      expect(verifyPassword("test", "invalid_format_without_colon")).toBe(false);
    });
  });

  describe("JWT Signing & Verification", () => {
    it("signs and verifies valid JWT tokens", () => {
      const payload = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        email: "partner@cbva.in",
        grade: "partner",
        isAdmin: true,
      };

      const token = signJwt(payload, 3600);
      expect(token).toBeDefined();
      expect(token.split(".").length).toBe(3);

      const verified = verifyJwt<typeof payload>(token);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe(payload.userId);
      expect(verified?.email).toBe(payload.email);
      expect(verified?.grade).toBe(payload.grade);
      expect(verified?.isAdmin).toBe(true);
    });

    it("returns null for tampered or invalid JWT tokens", () => {
      const payload = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        email: "test@cbva.in",
        grade: "article",
        isAdmin: false,
      };

      const token = signJwt(payload, 3600);
      const parts = token.split(".");
      
      // Tamper signature
      const tamperedToken = `${parts[0]}.${parts[1]}.invalidSignature`;
      expect(verifyJwt(tamperedToken)).toBeNull();

      // Malformed token
      expect(verifyJwt("not.a.valid.jwt.token")).toBeNull();
      expect(verifyJwt("")).toBeNull();
    });

    it("returns null for expired JWT tokens", () => {
      const payload = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        email: "test@cbva.in",
        grade: "article",
        isAdmin: false,
      };

      // Expired 10 seconds ago
      const expiredToken = signJwt(payload, -10);
      expect(verifyJwt(expiredToken)).toBeNull();
    });
  });
});
