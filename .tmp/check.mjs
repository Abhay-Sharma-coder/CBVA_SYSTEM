import { chromium } from "@playwright/test";
const url = process.argv[2] ?? "http://127.0.0.1:8081/admin/analytics";
const shot = process.argv[3] ?? "screenshots/p5-trends.png";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 160)));
await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
await p.waitForSelector("main svg, main [role=alert]", { timeout: 90000 }).catch(()=>{}); await p.waitForTimeout(1200);
console.log("HEADINGS:", (await p.locator("main h1, main h2, main h3").allInnerTexts()).join(" | "));
const t = (await p.locator("main").innerText()).replace(/\s+/g, " ");
const m = t.match(/Over \d+ working days.{0,220}/);
console.log("HEADLINE:", m ? m[0] : "(not found)");
console.log("MARKS: svg=", await p.locator("main svg").count(),
            "rect=", await p.locator("main svg rect").count(),
            "path=", await p.locator("main svg path").count(),
            "heatcells=", await p.locator("main table td[style]").count());
console.log("SRTABLES:", await p.locator("main table.sr-only").count());
console.log("ERRORS:", errs.length ? errs.slice(0, 4) : "none");
await p.screenshot({ path: shot, fullPage: true });
console.log("shot →", shot);
await b.close();
