import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

export default defineConfig({
  ...base,
  testMatch: "**/pr/guest-smoke.spec.mjs",
  testIgnore: undefined,
  projects: base.projects.filter((project) => project.name === "chromium"),
});
