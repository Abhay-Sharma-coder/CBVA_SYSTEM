import { defineConfig, devices } from "@playwright/test";

/**
 * Port 3000 is a busy default and a stale listener on it silently answers the
 * suite instead of this app, which shows up as every test failing for no
 * visible reason. PORT overrides it; 8081 is the project default.
 */
const PORT = Number(process.env.PORT ?? 8081);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  /**
   * Compiles every route once before the suite. `next dev` builds a route on
   * first request, and Phase 3 took the app from four routes to ten — without
   * this, the first navigation to each spends most of its assertion budget in
   * webpack, and specs pass in a warm order and fail in a cold one.
   */
  globalSetup: "./e2e/global-setup.ts",
  /**
   * Phase 3's flows are multi-step: sign in, navigate, wait for a mutation to
   * settle, screenshot. Thirty seconds was written for a suite that only read.
   */
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
