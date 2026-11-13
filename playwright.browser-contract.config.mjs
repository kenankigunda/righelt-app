import { defineConfig } from "@playwright/test";
import base from "./playwright.browser.config.mjs";

export default defineConfig({
  ...base,
  testMatch: [
    "**/controlled-heading-inset.spec.mjs",
    "**/pr-browser-contracts.spec.mjs",
  ],
  grep:
    /native account focus and accessibility|controlled heading owns unchanged leading inset|production command journal survives close, reopen and removal|production account authority retires before cross-tab rehydration|empty full and mini board squares keep their recess without center dots/,
});
