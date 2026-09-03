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
