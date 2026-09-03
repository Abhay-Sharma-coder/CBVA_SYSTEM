import { serverEnv } from "@/lib/config";
import type { Adapters } from "@/lib/adapters/types";
import {
  DemoAuthProvider,
  DemoCalendarSync,
  DemoCheckInSource,
  DemoMailProvider,
} from "@/lib/adapters/demo";
import {
  BadgeWebhookCheckInSource,
  EntraAuthProvider,
  GraphCalendarSync,
  GraphMailProvider,
} from "@/lib/adapters/production";

export * from "@/lib/adapters/types";

/**
 * THE ONLY PLACE APP_MODE IS BRANCHED ON.
 *
 * If you find yourself writing `if (appMode === ...)` anywhere else, the logic
 * belongs behind an adapter instead.
 */
let cached: Adapters | null = null;

export function adapters(): Adapters {
  if (cached) return cached;
  cached =
    serverEnv().appMode === "production"
      ? {
          auth: new EntraAuthProvider(),
          mail: new GraphMailProvider(),
          calendar: new GraphCalendarSync(),
          checkIn: new BadgeWebhookCheckInSource(),
        }
      : {
          auth: new DemoAuthProvider(),
          mail: new DemoMailProvider(),
          calendar: new DemoCalendarSync(),
          checkIn: new DemoCheckInSource(),
        };
  return cached;
}

export const auth = () => adapters().auth;
export const mail = () => adapters().mail;
export const calendar = () => adapters().calendar;
export const checkIn = () => adapters().checkIn;
