import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

const testMatch = "**/storage-lifecycle.spec.mjs";
export default defineConfig({
  ...base,
  testIgnore: "**/auth/**",
  testMatch,
  // Project-level matches override the root match. Do not inherit the general
  // Firefox/WebKit inventory into the stack whose storage this proof resets.
  projects: base.projects.map(project => ({ ...project, testMatch })),
});
