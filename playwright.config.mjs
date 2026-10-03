import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.RIGHELT_E2E_WEB_PORT || "9888";
const baseURL = `http://127.0.0.1:${webPort}`;
const junitOutputFile = process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE || "test-results/playwright/results.xml";
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results/playwright/artifacts";
const reporter = process.env.CI
  ? [["github"], ["line"], ["junit", { outputFile: junitOutputFile }]]
  : [["list"]];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  outputDir,
  reporter,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1100 },
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.RIGHELT_CHROMIUM_EXECUTABLE } },
    },
    ...["firefox", "webkit"].map(name => ({
      name,
      testMatch: /(sync-recovery-(pressure|ux)|browser-move-input|home-create-refresh)\.spec\.mjs/,
      use: { ...devices[name === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
        launchOptions: { executablePath: process.env[`RIGHELT_${name.toUpperCase()}_EXECUTABLE`] } },
    })),
  ],
  webServer: {
    command: "node scripts/e2e-stack.mjs",
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
    url: baseURL,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 180_000,
  },
});
