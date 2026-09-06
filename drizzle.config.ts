import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

/**
 * Which env file to load.
 *
 * Defaults to `.env.local` (the LOCAL / test database). Set ENV_FILE to point
 * at another — `scripts/prod.mjs` sets it to `.env.production.local` so the
 * same script can be aimed at the deployed database without editing anything.
 *
 * dotenv does not override variables already in the environment, so an
 * explicitly exported DATABASE_URL still wins over both files.
 */
config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

// Migrations run against the DIRECT (unpooled) endpoint — PgBouncer transaction
// pooling breaks DDL sequencing, in particular CREATE EXTENSION.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
