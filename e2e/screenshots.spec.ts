import { test, type Page } from "@playwright/test";

/** Captures the screens for visual review. Not an assertion suite. */
const PAGES = [
  ["home", "/"],
  ["styleguide", "/styleguide"],
  ["floor", "/floor"],
  ["admin-floor-plan", "/admin/floor-plan"],
] as const;

const WIDTHS = [
  ["1440", 1440, 900],
  ["1280", 1280, 800],
  ["390", 390, 844],
] as const;

/**
 * The header widgets are client-rendered from /api/session and /api/clock, and
 * networkidle alone fires before they replace their skeletons. The floor plan
 * additionally waits on a seat button, because the plan mounts after two more
 * round trips and a shot taken before that is of an empty rectangle.
 */
async function settle(page: Page, path: string) {
  await page.getByLabel("Sign in as a different person (demo)").waitFor();
  // The clock readout is `hidden sm:inline`, so it is only a usable signal
  // that the header has hydrated on the wider viewports.
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await page.locator("header time").waitFor();
  }
  await page.waitForLoadState("networkidle");
  if (path.includes("floor")) {
    await page.locator("[data-seat]").first().waitFor({ timeout: 30_000 });
    // The plan springs into its fit-to-floor framing on mount.
    await page.waitForTimeout(900);
  }
}

for (const [name, path] of PAGES) {
  for (const [label, width, height] of WIDTHS) {
    test(`shot ${name} ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(path);
      await settle(page, path);
      await page.screenshot({
        path: `screenshots/${name}-${label}.png`,
        fullPage: true,
      });
    });
  }
}

test("shot floor zone focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/floor");
  await settle(page, "/floor");
  await page.getByRole("radio", { name: "Zone C" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "screenshots/floor-zone-c-1440.png", fullPage: true });
});

test("shot floor list view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/floor");
  await settle(page, "/floor");
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByRole("table").waitFor();
  await page.screenshot({ path: "screenshots/floor-list-1440.png", fullPage: true });
});
