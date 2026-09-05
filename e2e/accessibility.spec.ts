import nodePath from "node:path";

import { expect, test, type Page } from "@playwright/test";

// Playwright transpiles specs to CJS, so import.meta is not available here.
// It always runs from the project root, so cwd is the reliable anchor.
const AXE_PATH = nodePath.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");

interface AxeNode {
  target: string[];
  failureSummary?: string;
}
interface AxeViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  help: string;
  nodes: AxeNode[];
}
interface AxeResults {
  violations: AxeViolation[];
}

async function audit(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE_PATH });
  const results = await page.evaluate(async () => {
    // @ts-expect-error axe is injected into the page above
    return (await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    })) as AxeResults;
  });
  return results.violations;
}

function report(violations: AxeViolation[]) {
  return violations
    .map(
      (v) =>
        `${v.impact ?? "unknown"} · ${v.id} · ${v.help}\n` +
        v.nodes
          .slice(0, 3)
          .map((n) => `      ${n.target.join(" ")}`)
          .join("\n"),
    )
    .join("\n");
}

/**
 * Zero critical or serious violations is the bar. Anything below that is
 * printed rather than swallowed, so a regression is visible even when the
 * suite is green.
 */

const CASES: Array<[string, string, (page: Page) => Promise<void>]> = [
  [
    "floor plan",
    "/floor",
    async (page) => {
      await page.locator("[data-seat]").first().waitFor({ timeout: 30_000 });
    },
  ],
  [
    "floor list view",
    "/floor",
    async (page) => {
      await page.locator("[data-seat]").first().waitFor({ timeout: 30_000 });
      await page.getByRole("radio", { name: "List" }).click();
      await page.getByRole("table").waitFor();
    },
  ],
  [
    "booking dialog",
    "/floor",
    async (page) => {
      await page.locator("[data-seat][data-status='available']").first().waitFor({
        timeout: 30_000,
      });
      await page.locator("[data-seat][data-status='available']").first().click();
      await page.getByRole("dialog").waitFor();
    },
  ],
  [
    "floor plan editor",
    "/admin/floor-plan",
    async (page) => {
      await page.locator("[data-seat]").first().waitFor({ timeout: 30_000 });
    },
  ],
  /* ---- Phase 3 surfaces ---- */
  [
    "my bookings",
    "/bookings",
    async (page) => {
      await page.getByRole("heading", { level: 1, name: "My Bookings" }).waitFor();
      await page.waitForTimeout(500);
    },
  ],
  [
    "meeting room grid",
    "/rooms",
    async (page) => {
      // Every hour is a real button in a table with a caption and row headers;
      // this is the surface most likely to regress into a div grid.
      await page.getByRole("table").waitFor({ timeout: 30_000 });
    },
  ],
  [
    "on-behalf person picker",
    "/floor",
    async (page) => {
      await page.locator("[data-seat][data-status='available']").first().waitFor({
        timeout: 30_000,
      });
      await page.locator("[data-seat][data-status='available']").first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      // Only offered to grades that may book for a colleague, so this is a
      // no-op for personas that cannot — the audit still covers the dialog.
      const choice = dialog.getByRole("radio", { name: "For a colleague" });
      if (await choice.isVisible().catch(() => false)) {
        await choice.click();
        await dialog.getByRole("combobox", { name: "Colleague" }).click();
        await dialog.getByRole("listbox").waitFor();
      }
    },
  ],
  [
    "demo notification inbox",
    "/admin/notifications",
    async (page) => {
      await page.getByRole("heading", { level: 1, name: "Notifications" }).waitFor();
      await page.waitForTimeout(500);
    },
  ],
  [
    "desk QR sheet",
    "/admin/qr",
    async (page) => {
      await page.locator(".qr-card").first().waitFor({ timeout: 30_000 });
    },
  ],

  /* ------------------------------------------------- Phase 5 surfaces ---
   *
   * The analytics screens are the deliverable and carry the densest content in
   * the product — nine widgets, five tables and seven SVG figures on Trends
   * alone. They are also the screens most likely to grow an unlabelled control
   * as they change, so they are swept rather than trusted.
   *
   * /admin was previously not covered at all, which is how it kept an entirely
   * missing authorisation check for four phases.
   */
  [
    "admin index",
    "/admin",
    async (page) => {
      await page.getByRole("heading", { level: 1, name: "Admin" }).waitFor();
    },
  ],
  [
    "analytics — trends",
    "/admin/analytics",
    async (page) => {
      await page
        .getByRole("heading", { name: "Desks needed against desks held" })
        .waitFor({ timeout: 90_000 });
    },
  ],
  [
    "analytics — today",
    "/admin/analytics/today",
    async (page) => {
      await page.getByRole("heading", { level: 1, name: "Today on the floor" }).waitFor();
      await page.waitForTimeout(2_000);
    },
  ],
  [
    "analytics — forecast",
    "/admin/analytics/forecast",
    async (page) => {
      await page
        .getByRole("heading", { name: /working days/ })
        .waitFor({ timeout: 60_000 });
    },
  ],
  [
    "seat inventory",
    "/admin/seats",
    async (page) => {
      await page.getByRole("heading", { name: "All desks" }).waitFor({ timeout: 60_000 });
    },
  ],
  [
    "people",
    "/admin/users",
    async (page) => {
      // The page h1 is also "People", so pin the card title by level.
      await page
        .getByRole("heading", { level: 2, name: "People" })
        .waitFor({ timeout: 60_000 });
    },
  ],
  [
    "settings",
    "/admin/settings",
    async (page) => {
      await page.getByRole("heading", { name: "Booking rules" }).waitFor({ timeout: 60_000 });
    },
  ],
  [
    "audit log",
    "/admin/audit",
    async (page) => {
      // level 1: the card title is also "Audit log", plus its entry count.
      await page
        .getByRole("heading", { level: 1, name: "Audit log" })
        .waitFor({ timeout: 60_000 });
    },
  ],
  [
    "scheduled jobs",
    "/admin/jobs",
    async (page) => {
      await page
        .getByRole("heading", { level: 2, name: /What the next run would do/ })
        .waitFor({ timeout: 60_000 });
    },
  ],
  [
    "who is in",
    "/who",
    async (page) => {
      await page.getByRole("heading", { level: 1, name: /Who/ }).waitFor();
      await page.waitForTimeout(2_500);
    },
  ],
  [
    "your settings",
    "/me",
    async (page) => {
      await page.getByRole("switch").first().waitFor({ timeout: 30_000 });
    },
  ],
  [
    "my desk — releases and repeats",
    "/bookings",
    async (page) => {
      await page.getByRole("tab", { name: /My desk/ }).click();
      await page.waitForTimeout(1_500);
    },
  ],
  [
    "check-in page",
    "/checkin/C5-01",
    async (page) => {
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
    },
  ],
];

for (const [name, path, prepare] of CASES) {
  test(`no serious accessibility violations: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await page.getByLabel("Sign in as a different person (demo)").waitFor();
    await prepare(page);

    const violations = await audit(page);
    const blocking = violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    const minor = violations.filter((v) => !blocking.includes(v));
    if (minor.length > 0) {
      console.log(`\n  ${name} — non-blocking:\n${report(minor)}`);
    }
    expect(blocking, `\n${report(blocking)}\n`).toEqual([]);
  });
}

test("every seat is a real button with an accessible name", async ({ page }) => {
  await page.goto("/floor");
  await page.locator("[data-seat]").first().waitFor({ timeout: 30_000 });

  const names = await page
    .locator("[data-seat]")
    .evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName,
        label: el.getAttribute("aria-label") ?? "",
      })),
    );

  expect(names).toHaveLength(141);
  for (const { tag, label } of names) {
    expect(tag).toBe("BUTTON");
    // "Seat C3-04, Zone C, bay C3, Available" — code, zone, bay and state.
    expect(label).toMatch(/^Seat [A-Z]+\d*-\d{2}, Zone [ABCD], bay [A-Z]+\d*, .+/);
  }
});

test("the plan region and its controls are labelled", async ({ page }) => {
  await page.goto("/floor");
  await page.locator("[data-seat]").first().waitFor({ timeout: 30_000 });

  await expect(page.getByRole("application")).toHaveAttribute("aria-label", /arrow keys/i);
  for (const group of ["Booking date", "Slot", "Zone", "View"]) {
    await expect(page.getByRole("radiogroup", { name: group })).toHaveCount(1);
  }
});
