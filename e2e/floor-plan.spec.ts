import { expect, test, type Page } from "@playwright/test";

async function openFloor(page: Page) {
  await page.goto("/floor");
  await page.getByLabel("Sign in as a different person (demo)").waitFor();
  await page.locator("[data-seat]").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

test("renders all 141 seats and no CAD paths in the live DOM", async ({ page }) => {
  await openFloor(page);
  await expect(page.locator("[data-seat]")).toHaveCount(141);

  // The architecture rule: linework is one raster, not 8,603 nodes. If this
  // ever fails somebody has inlined the walls SVG and the plan will crawl.
  const paths = await page.locator(".relative svg path").count();
  expect(paths).toBeLessThan(50);

  const interactive = await page.locator("[data-seat]").count();
  expect(interactive).toBeLessThan(200);
});

test("a seat announces itself with code, zone, bay and status", async ({ page }) => {
  await openFloor(page);
  const label = await page.locator("[data-seat='C3-01']").getAttribute("aria-label");
  expect(label).toMatch(/^Seat C3-01, Zone C, bay C3, /);
});

test("reserved fixed seats are not clickable and name their occupant", async ({ page }) => {
  await openFloor(page);
  const fixed = page.locator("[data-seat][data-status='reserved_fixed']").first();
  // aria-disabled rather than disabled, so it stays keyboard reachable and can
  // still tell you whose desk it is.
  await expect(fixed).toHaveAttribute("aria-disabled", "true");
  // Not the `disabled` attribute, so it keeps its place in the tab order.
  // (Playwright reads aria-disabled as disabled, hence checking the DOM.)
  expect(await fixed.evaluate((el: HTMLButtonElement) => el.disabled)).toBe(false);
  await fixed.focus();
  await expect(fixed).toBeFocused();
  await expect(fixed).toHaveAttribute("aria-label", /Reserved, fixed allocation/);
  // dispatchEvent rather than click(): Playwright refuses to click an
  // aria-disabled element, which is the point — this fires the handler
  // directly to prove the guard inside it, not just the actionability check.
  await fixed.dispatchEvent("click");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a seat is reachable by keyboard and arrows move within the bay", async ({ page }) => {
  await openFloor(page);
  const first = page.locator("[data-seat]").first();
  await first.focus();
  const startCode = await first.getAttribute("data-seat");
  const startBay = await first.getAttribute("data-bay");

  await page.keyboard.press("ArrowRight");
  const focused = page.locator("[data-seat]:focus");
  await expect(focused).toHaveCount(1);
  const nextCode = await focused.getAttribute("data-seat");
  expect(nextCode).not.toBe(startCode);
  // Arrow navigation prefers staying inside the bay.
  expect(await focused.getAttribute("data-bay")).toBe(startBay);
});

test("hovering a seat shows its card", async ({ page }) => {
  await openFloor(page);
  await page.locator("[data-seat='C3-01']").hover();
  // The card is aria-hidden — the seat button's own accessible name already
  // says all of this, so it is visual reinforcement, not a second
  // announcement. Located by attribute rather than by role for that reason.
  const card = page.locator("[data-seat-card='C3-01']");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Zone C");
  await expect(card).toContainText("Bay C3");
});

test("clicking an available seat opens the booking flow", async ({ page }) => {
  await openFloor(page);
  const seat = page.locator("[data-seat][data-status='available']").first();
  const seatCode = await seat.getAttribute("data-seat");

  await seat.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The seat, date and slot are spelled out before anybody commits to them.
  await expect(dialog).toContainText(`Book seat ${seatCode}`);
  await expect(dialog.getByRole("button", { name: "Confirm booking" })).toBeEnabled();
  // exact: the dialog also has a "Close dialog" X, and the default substring
  // match resolves to both.
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("changing the slot reloads seat states", async ({ page }) => {
  await openFloor(page);
  const before = await page.locator("[data-seat][data-status='available']").count();
  await page.getByRole("radio", { name: /Afternoon/ }).click();
  await page.waitForTimeout(900);
  const after = await page.locator("[data-seat][data-status='available']").count();
  // The seeded data mixes AM-only and PM-only bookings, so the two differ.
  expect(after).not.toBe(before);
});

test("the zone filter narrows the plan to one wing", async ({ page }) => {
  await openFloor(page);
  await page.getByRole("radio", { name: "Zone C" }).click();
  await page.waitForTimeout(700);
  await expect(page.locator("[data-seat]")).toHaveCount(66);
  await expect(page.locator("[data-seat][data-zone='D']")).toHaveCount(0);

  await page.getByRole("radio", { name: "Whole floor" }).click();
  await page.waitForTimeout(700);
  await expect(page.locator("[data-seat]")).toHaveCount(141);
});

test("fit to floor and keyboard zoom work", async ({ page }) => {
  await openFloor(page);
  const layer = page.locator("[role='application'] > div").first();
  const initial = await layer.evaluate((el) => getComputedStyle(el).transform);

  await page.locator("[role='application']").focus();
  await page.keyboard.press("+");
  await page.waitForTimeout(600);
  expect(await layer.evaluate((el) => getComputedStyle(el).transform)).not.toBe(initial);

  await page.getByRole("button", { name: "Fit to floor" }).click();
  await page.waitForTimeout(900);
  // Compared with a tolerance rather than as a string. The fit is computed from
  // the measured container, so a sub-pixel difference in layout — a scrollbar,
  // a font metric — moves the translation by a fraction and an exact string
  // comparison fails on a difference nobody could see.
  const refit = await layer.evaluate((el) => getComputedStyle(el).transform);
  const numbers = (m: string) => (m.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const [a, b] = [numbers(initial), numbers(refit)];
  expect(b).toHaveLength(a.length);
  for (const [i, value] of a.entries()) {
    expect(Math.abs(value - b[i]!), `transform component ${i}`).toBeLessThan(1);
  }
});

test("the list view carries the same seats and can be filtered", async ({ page }) => {
  await openFloor(page);
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("141 of 141 seats")).toBeVisible();

  await page.locator("#list-zone").selectOption("D");
  await expect(page.getByText("67 of 141 seats")).toBeVisible();

  await page.getByLabel("Search seat, bay or person").fill("PD-01");
  await expect(page.getByText("1 of 141 seats")).toBeVisible();
});

test("the occupancy count is always visible", async ({ page }) => {
  await openFloor(page);
  await expect(page.getByText("Occupancy, this slot")).toBeVisible();
  await expect(page.getByText(/% occupied/)).toBeVisible();
});

test("the date strip skips weekends and holidays", async ({ page }) => {
  await openFloor(page);
  const days = page.getByRole("radiogroup", { name: "Booking date" }).getByRole("radio");
  // settings.booking_window_working_days, which Phase 3 made the enforced rule
  // rather than a display limit. Five, not the six the Phase 2 strip showed.
  await expect(days).toHaveCount(5);
  const labels = await days.allInnerTexts();
  expect(labels.join(" ")).not.toMatch(/\bSat\b|\bSun\b/);
});

test("the admin editor loads and flags interpolated seats", async ({ page }) => {
  await page.goto("/admin/floor-plan");
  await page.locator("[data-seat]").first().waitFor({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Floor Plan Editor" })).toBeVisible();
  await expect(page.getByText("11 interpolated")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  // The per-bay reconciliation is on the page, not only in the handoff doc.
  await expect(page.getByRole("table")).toContainText("Zone B");
});
