import { z } from "zod";

/**
 * Environment parsing. The whole app reads config from here, never from
 * process.env directly, so a missing variable fails loudly at boot instead of
 * quietly at 3am inside the auto-release job.
 */
const serverEnvSchema = z.object({
  APP_MODE: z.enum(["demo", "production"]).default("demo"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /**
   * Neon's direct (non-PgBouncer) endpoint. Migrations, the seed script and the
   * constraint tests need real session-scoped transactions; transaction pooling
   * breaks DDL sequencing and makes the concurrency tests non-deterministic.
   * Falls back to DATABASE_URL when the deployment has only one endpoint.
   */
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  /**
   * Shared secret for the scheduled-job route. Vercel Cron sends it as
   * `Authorization: Bearer`; the demo panel and curl may send `x-cron-secret`.
   * Optional in demo — an unprotected job endpoint on a laptop is not a risk
   * worth a required variable — and checked at the route in production.
   */
  CRON_SECRET: z.string().min(1).optional(),
  /** Origin the printed desk QR codes point at. */
  NEXT_PUBLIC_APP_URL: z.string().min(1).optional(),
});

export type AppMode = z.infer<typeof serverEnvSchema>["APP_MODE"];

let cached: ServerEnv | null = null;

export interface ServerEnv {
  appMode: AppMode;
  databaseUrl: string;
  databaseUrlDirect: string;
  cronSecret: string | null;
  appUrl: string;
}

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = {
    appMode: parsed.data.APP_MODE,
    databaseUrl: parsed.data.DATABASE_URL,
    databaseUrlDirect: parsed.data.DATABASE_URL_UNPOOLED ?? parsed.data.DATABASE_URL,
    cronSecret: parsed.data.CRON_SECRET ?? null,
    appUrl: parsed.data.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:8081",
  };
  return cached;
}

/** The IANA zone every date in this product is reasoned about in. */
export const APP_TIMEZONE = "Asia/Kolkata";
