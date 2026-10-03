import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e/components", testMatch: "mobile-dock.spec.mjs", workers: 1, reporter: "list", outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results/mobile-dock", projects: ["chromium", "firefox", "webkit"].map(browserName => ({ name: browserName, use: { browserName } })) });
