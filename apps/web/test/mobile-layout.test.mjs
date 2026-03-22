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

test("wide-screen shell sticky columns only target the left and board stacks", () => {
  assert.match(
    shellStylesSource,
    /\.layout-grid\s*\{[\s\S]*align-items:\s*start;/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\s+\.layout-grid > \[data-shell-sticky-target\]\[data-sticky-enabled="true"\]\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*1rem;[\s\S]*align-self:\s*start;/s,
  );
  assert.doesNotMatch(
    shellStylesSource,
    /\.layout-grid > :last-child[\s\S]*position:\s*sticky|data-game-panel="history"[\s\S]*position:\s*sticky/,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\[data-debug-open="true"\]\s*\{[\s\S]*width:\s*100%;[\s\S]*margin:\s*1rem\s+0\s+2rem;/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\[data-debug-open="true"\]\s*\{[\s\S]*padding-left:\s*1rem;[\s\S]*padding-right:\s*calc\(var\(--shell-debug-wide-width\)\s*\+\s*1rem\);/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\[data-debug-open="true"\]\s+\.shell-main-content\s*\{[\s\S]*width:\s*min\(var\(--shell-main-max-width\),\s*calc\(100vw\s*-\s*var\(--shell-debug-wide-width\)\s*-\s*2rem\)\);[\s\S]*margin:\s*0\s+auto;/s,
  );
  assert.match(
    shellStylesSource,
    /\.form-row\s*\{[\s\S]*display:\s*grid;[\s\S]*min-width:\s*0;/s,
  );
  assert.match(
    shellStylesSource,
    /select,\s*input,\s*textarea\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*min-width:\s*0;/s,
  );
  assert.match(
    shellStylesSource,
    /\.debug-flyout-scroll > \*,\s*\.debug-panel > \*\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/s,
  );
  assert.match(
    shellStylesSource,
    /\.debug-flyout\s*\{[\s\S]*border-radius:\s*0;/s,
  );
  assert.match(
    shellStylesSource,
    /\.debug-flyout-header\s*\{[\s\S]*border-bottom:\s*1px solid var\(--line\);/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\[data-debug-open="true"\]\s+\.debug-flyout\s*\{[\s\S]*position:\s*fixed;[\s\S]*top:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0;[\s\S]*width:\s*var\(--shell-debug-wide-width\);[\s\S]*border-top:\s*0;[\s\S]*border-right:\s*0;[\s\S]*border-bottom:\s*0;[\s\S]*box-shadow:\s*none;/s,
  );
});

test("narrow-screen shell layout still collapses to one column without sticky rules in that breakpoint", () => {
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="narrow"\]\s+\.layout-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/s,
  );
  assert.doesNotMatch(
    shellStylesSource,
    /#app\[data-shell-layout-mode="narrow"\]\s+\.layout-grid > \[data-shell-sticky-target\][\s\S]*position:\s*sticky;/s,
  );
});

test("home mini-board cards use uniform grid widths across wrapped rows", () => {
  assert.match(
    shellStylesSource,
    /\.mini-board-card-list\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%, 22rem\), 1fr\)\);[\s\S]*align-items:\s*stretch;/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card\s*\{[\s\S]*display:\s*grid;[\s\S]*width:\s*100%;/s,
  );
  assert.match(
    shellStylesSource,
    /\.home-games-section-header\s*\{[\s\S]*display:\s*flex;[\s\S]*justify-content:\s*space-between;[\s\S]*flex-wrap:\s*wrap;/s,
  );
});
