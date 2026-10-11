import { defineConfig, devices } from "@playwright/test";
import { browserLaunchOptions } from "./scripts/playwright-launch-options.mjs";
const port = process.env.RIGHELT_BROWSER_PORT ?? "10188";
export default defineConfig({
  testDir: "./browser-integration",
  workers: 2,
  fullyParallel: true,
  retries: 0,
  timeout: 30000,
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/browser-integration",
  reporter: [
    ["list"],
    ...(process.env.RIGHELT_TEST_OBSERVATIONS
      ? [["./scripts/testing/browser-reporter.mjs"]]
      : []),
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: ["chromium", "firefox", "webkit"].map((name) => ({
    name,
    use: {
      ...devices[
        name === "chromium"
          ? "Desktop Chrome"
          : name === "firefox"
            ? "Desktop Firefox"
            : "Desktop Safari"
      ],
      launchOptions: browserLaunchOptions(name),
    },
  })),
  webServer: {
    command:
      "node scripts/resources/cli.mjs run --kind preview -- node scripts/testing/browser-server.mjs",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
