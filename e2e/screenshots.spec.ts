import { test } from "@playwright/test";

/** Captures the screens for visual review. Not an assertion suite. */
const PAGES = [
  ["home", "/"],
  ["styleguide", "/styleguide"],
  ["floor", "/floor"],
] as const;

for (const [name, path] of PAGES) {
  test(`shot ${name} desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    // The header widgets are client-rendered from /api/session and /api/clock;
    // networkidle alone fires before they replace their skeletons.
    await page.getByLabel("Sign in as a different person (demo)").waitFor();
    await page.locator("header time").waitFor();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `screenshots/${name}-1440.png`, fullPage: true });
  });

  test(`shot ${name} mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.getByLabel("Sign in as a different person (demo)").waitFor();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `screenshots/${name}-390.png`, fullPage: true });
  });
}
