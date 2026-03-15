import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const indexSource = readFileSync(join(testDir, "..", "index.html"), "utf8");
const shellStylesSource = readFileSync(join(testDir, "..", "shell", "shell.css"), "utf8");

test("web app keeps the standard mobile viewport meta tag", () => {
  assert.match(indexSource, /<meta name="viewport" content="width=device-width, initial-scale=1\.0" \/>/);
});

test("shell header wraps long mobile status and identity tokens instead of widening the page", () => {
  assert.match(
    shellStylesSource,
    /\.shell-header-status\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header \.mono\s*\{[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;/s,
  );
});

test("shell header stacks cleanly on narrow screens", () => {
  assert.match(
    shellStylesSource,
    /@media \(max-width: 640px\)\s*\{[\s\S]*\.shell-header\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*\}[\s\S]*\.shell-header-main,\s*\.shell-header-actions\s*\{[\s\S]*flex:\s*1 1 100%;[\s\S]*max-width:\s*100%;/s,
  );
});
