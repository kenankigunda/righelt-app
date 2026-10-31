import { defineConfig, devices } from "@playwright/test";
import { browserLaunchOptions } from "./scripts/playwright-launch-options.mjs";

const webPort = process.env.RIGHELT_E2E_WEB_PORT || "9888";
const baseURL = `http://127.0.0.1:${webPort}`;
const junitOutputFile = process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE || "test-results/playwright/results.xml";
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results/playwright/artifacts";
const reporter = process.env.CI
  ? [["github"], ["line"], ["junit", { outputFile: junitOutputFile }]]
  : [["list"]];

const config = defineConfig({
  testDir: "./e2e",
  testIgnore: "**/auth/**",
  fullyParallel: false,
  workers: 1,
  outputDir,
  reporter: [...reporter,...(process.env.RIGHELT_TEST_OBSERVATIONS ? [["./scripts/testing/browser-reporter.mjs"]] : [])],
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
      use: { ...devices["Desktop Chrome"], launchOptions: browserLaunchOptions("chromium") },
    },
    ...["firefox", "webkit"].map(name => ({
      name,
      testMatch: /(home-card-pagination-reorder|invitation-load-recovery|named-observer-result|desktop-board-fit|home-opponent-identity|opponent-invite-polish|destruction-sound|human-opponent-replay|computer-feedback|mobile-board-history|sync-recovery-(pressure|ux)|recovery-freeze-regression|browser-move-input|home-create-refresh|guest-computer-play|computer-tab-recovery|storage-lifecycle|destruction-lifecycle|home-pagination-ghost)\.spec\.mjs/,
      use: { ...devices[name === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
        launchOptions: browserLaunchOptions(name) },
    })),
  ],
  webServer: {
    command: "node scripts/resources/cli.mjs run --kind preview -- node scripts/e2e-stack.mjs",
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
    url: baseURL,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 180_000,
  },
});

for (const project of config.projects) {
  if (project.name === "firefox" || project.name === "webkit") {
    project.testMatch = [project.testMatch, "**/completion-preserving-retreat.spec.mjs"];
  }
}

export default config;
