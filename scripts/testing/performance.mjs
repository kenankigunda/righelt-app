import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createBrowserServer } from "./browser-server.mjs";
import { browserLaunchOptions } from "../playwright-launch-options.mjs";
const server = createBrowserServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch(browserLaunchOptions("chromium"));
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.fixtureReady);
    const duration = await page.evaluate(async () => {
      const start = performance.now();
      document.querySelector("button").click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return performance.now() - start;
    });
    if (!Number.isFinite(duration) || duration < 0)
      throw Error("Invalid performance observation");
    await page.getByRole("dialog").waitFor({ state: "visible" });
    if (
      !(await page
        .locator('[data-testid="account-dialog"]')
        .evaluate((dialog) => dialog.contains(document.activeElement)))
    )
      throw Error("Dialog did not receive focus");
    samples.push({
      dialogOpenThroughTwoFramesMs: duration,
      navigation: await page.evaluate(() =>
        performance.getEntriesByType("navigation")[0].toJSON(),
      ),
    });
    await page.close();
  }
  const out =
    process.env.RIGHELT_TEST_OBSERVATIONS ??
    "test-results/performance/observations.json";
  await mkdir(
    new URL(
      ".",
      `file://${out.startsWith("/") ? out : process.cwd() + "/" + out}`,
    ),
    { recursive: true },
  );
  await writeFile(
    out,
    JSON.stringify(
      {
        observational: true,
        clock: "real",
        samples,
        total: samples.length,
        passed: samples.length,
        failed: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    "Recorded five real-clock dialog-open and navigation observations; thresholds remain observational.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
