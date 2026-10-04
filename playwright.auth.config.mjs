import { defineConfig, devices } from "@playwright/test";
import { browserLaunchOptions } from "./scripts/playwright-launch-options.mjs";
import { LOCAL_DEV_PORT_VARIANTS } from "./apps/web/local-dev-ports.js";
const variant = LOCAL_DEV_PORT_VARIANTS.find(item => item.suffix === "auth-e2e");
const baseURL = `https://127.0.0.1:${process.env.RIGHELT_AUTH_E2E_WEB_PORT || variant.webPort}`;
export default defineConfig({
  testDir: "./e2e/auth",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results/auth/artifacts",
  reporter: process.env.CI ? [["github"], ["line"], ["junit", { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE || "test-results/auth/results.xml" }]] : [["list"]],
  use: { baseURL, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: ["chromium", "firefox", "webkit"].map(name => ({ name,
    use: { ...devices[name === "chromium" ? "Desktop Chrome" : name === "firefox" ? "Desktop Firefox" : "Desktop Safari"],
      launchOptions: browserLaunchOptions(name) } })),
  webServer: { command: "node scripts/e2e-auth-stack.mjs", url: baseURL, ignoreHTTPSErrors: true,
    reuseExistingServer: false, timeout: 180000, gracefulShutdown: { signal: "SIGTERM", timeout: 15000 }, stdout: "pipe", stderr: "pipe" },
});
