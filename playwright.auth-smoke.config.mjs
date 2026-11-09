import { defineConfig } from "@playwright/test";
import base from "./playwright.auth.config.mjs";

export default defineConfig({
  ...base,
  testMatch: "**/accounts.spec.mjs",
  testIgnore: undefined,
  grep: /registration preserves the play attempt and the same seat works in another browser/,
  projects: base.projects.filter((project) => project.name === "chromium"),
});
