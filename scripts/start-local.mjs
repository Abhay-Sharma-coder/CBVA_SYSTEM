/**
 * `next start` against the LOCAL database.
 *
 * WHY THIS EXISTS, AND IT IS NOT A CONVENIENCE.
 *
 * `next start` sets NODE_ENV=production, and Next.js loads `.env.production.local`
 * at HIGHER priority than `.env.local` in production. So the obvious way to
 * exercise a production build locally —
 *
 *     npm run build && npm start
 *     PLAYWRIGHT_BASE_URL=http://127.0.0.1:8081 npm run e2e
 *
 * — silently points the whole suite at the DEPLOYED database. Phase 6's handoff
 * recommends exactly that command, because `next dev` restarts itself on Next's
 * memory threshold mid-suite and looks like flakiness. The recommendation is
 * right about the flakiness and wrong about the target.
 *
 * It is a quiet failure in the worst way: everything passes, because the app is
 * fine and the data is a copy of the same seed. Nothing reports it. The only
 * symptom is that the e2e suite — which books, cancels, advances the demo clock
 * and drives a real auto-release, on purpose (see CLAUDE.md) — has been doing
 * all of that to the database a partner is looking at.
 *
 * This happened in Phase 7. Production came back with 65 auto-released desks on
 * the front page and five extra bookings, and was repaired with `prod:seed`.
 *
 * So: this script resolves the connection strings from `.env.local` ITSELF and
 * puts them in the child's environment, where they outrank every .env file Next
 * will read. Then it refuses outright if the resolved host is not the local one.
 *
 *     npm run start:local            # port 8081
 *     npm run start:local -- -p 8093
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "dotenv";

const LOCAL_HOST_FRAGMENT = "ep-empty-hall";
const ENV_FILE = ".env.local";

if (!existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} is missing — see docs/RUNBOOK.md.`);
  process.exit(1);
}

// Into a bag of our own, NOT process.env, so nothing already exported can
// shadow what the file says.
const local = {};
config({ path: ENV_FILE, processEnv: local, quiet: true });

const pooled = local.DATABASE_URL;
const direct = local.DATABASE_URL_UNPOOLED ?? pooled;
if (!direct) {
  console.error(`${ENV_FILE} sets neither DATABASE_URL nor DATABASE_URL_UNPOOLED.`);
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(direct).host;
  } catch {
    return "(unparseable)";
  }
})();

if (!host.includes(LOCAL_HOST_FRAGMENT)) {
  console.error(
    `REFUSING: ${ENV_FILE} resolves to ${host}, which is not the local database.\n` +
      `This script exists precisely so a local production-build run cannot reach\n` +
      `the deployment. Fix ${ENV_FILE} rather than bypassing this.`,
  );
  process.exit(1);
}

console.log(`next start against LOCAL ${host}`);
console.log("(.env.production.local is deliberately overridden — see the header)");

const args = process.argv.slice(2);
if (!args.includes("-p") && !args.includes("--port")) {
  args.push("-H", "127.0.0.1", "-p", "8081");
}

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "start", ...args],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      // Shell environment beats every .env file Next reads, including
      // .env.production.local. That is the whole mechanism.
      DATABASE_URL: pooled ?? direct,
      DATABASE_URL_UNPOOLED: direct,
      APP_MODE: local.APP_MODE ?? "demo",
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
