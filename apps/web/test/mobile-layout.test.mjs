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

test("shell header separates layout spacing from panel chrome", () => {
  assert.doesNotMatch(
    shellStylesSource,
    /^\*\s*\{/m,
  );
  assert.doesNotMatch(
    shellStylesSource,
    /\.panel\s*\{/,
  );
  assert.doesNotMatch(
    shellStylesSource,
    /\.meta,\s*$/m,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header\s*\{[\s\S]*display:\s*flex;[\s\S]*border-radius:\s*14px;[\s\S]*padding:\s*0\.9rem 1rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header h1\s*\{[\s\S]*font-size:\s*2rem;/s,
  );
});

test("shell main layout transitions width when docked flyouts open or close", () => {
  assert.match(
    shellStylesSource,
    /\.app-root\s*\{[\s\S]*transition:\s*padding-right 180ms ease;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-main-content\s*\{[\s\S]*transition:[\s\S]*width 180ms ease,[\s\S]*max-width 180ms ease;/s,
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
    /#app\[data-shell-layout-mode="wide"\]\[data-debug-open="true"\],\s*#app\[data-shell-layout-mode="wide"\]\[data-scenarios-open="true"\]\s*\{[\s\S]*width:\s*100%;[\s\S]*margin:\s*1rem\s+0\s+2rem;/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\[data-debug-open="true"\],\s*#app\[data-shell-layout-mode="wide"\]\[data-scenarios-open="true"\]\s*\{[\s\S]*padding-left:\s*1rem;[\s\S]*padding-right:\s*calc\(var\(--shell-flyout-wide-width\)\s*\+\s*var\(--shell-flyout-content-gap\)\);/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\[data-debug-open="true"\]\s+\.shell-main-content,\s*#app\[data-shell-layout-mode="wide"\]\[data-scenarios-open="true"\]\s+\.shell-main-content\s*\{[\s\S]*width:\s*min\(var\(--shell-main-max-width\),\s*calc\(100vw\s*-\s*var\(--shell-flyout-wide-width\)\s*-\s*var\(--shell-flyout-content-gap\)\s*-\s*1rem\)\);[\s\S]*margin:\s*0\s+auto;/s,
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
    /\.shell-flyout-scroll\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*1rem;[\s\S]*align-content:\s*start;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-flyout-scroll > \*,\s*\.debug-panel > \*\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;[\s\S]*align-self:\s*start;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-flyout\s*\{[\s\S]*border-radius:\s*0;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-flyout-header\s*\{[\s\S]*border-bottom:\s*1px solid var\(--line\);/s,
  );
  assert.match(
    shellStylesSource,
    /button\.secondary\.is-active,\s*\.button-link\.secondary\.is-active,\s*button\.secondary\[aria-pressed="true"\],\s*\.button-link\.secondary\[aria-pressed="true"\]\s*\{[\s\S]*border-color:\s*var\(--accent\);[\s\S]*box-shadow:/s,
  );
  assert.match(
    shellStylesSource,
    /button\.secondary\.is-active,\s*\.button-link\.secondary\.is-active,\s*button\.secondary\[aria-pressed="true"\],\s*\.button-link\.secondary\[aria-pressed="true"\]\s*\{[\s\S]*background:\s*#fff;[\s\S]*color:\s*var\(--ink\);/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-flyout-stack\s*\{[\s\S]*top:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0;[\s\S]*gap:\s*0;/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\[data-flyout-count="1"\]\s+\.shell-flyout,\s*#app\[data-shell-layout-mode="wide"\]\[data-flyout-count="2"\]\s+\.shell-flyout\s*\{[\s\S]*width:\s*var\(--shell-flyout-wide-width\);[\s\S]*border-top:\s*0;[\s\S]*border-right:\s*0;[\s\S]*border-bottom:\s*0;[\s\S]*box-shadow:\s*none;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 640px\)\s*\{[\s\S]*\.shell-flyout-stack\s*\{[\s\S]*left:\s*0;[\s\S]*flex-direction:\s*column;[\s\S]*justify-content:\s*flex-end;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 640px\)\s*\{[\s\S]*\.shell-flyout\s*\{[\s\S]*width:\s*100%;[\s\S]*max-height:\s*50vh;[\s\S]*flex:\s*0 1 50vh;[\s\S]*border-left:\s*0;[\s\S]*border-right:\s*0;[\s\S]*border-bottom:\s*0;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 640px\)\s*\{[\s\S]*\.shell-flyout\s*\{[\s\S]*transform:\s*translateY\(calc\(100%\s*\+\s*1rem\)\);/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 640px\)\s*\{[\s\S]*\.shell-flyout\.is-open\s*\{[\s\S]*transform:\s*translateY\(0\);/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 640px\)\s*\{[\s\S]*\.shell-flyout\.is-closing\s*\{[\s\S]*transform:\s*translateY\(100%\);/s,
  );
});

test("narrow-screen shell layout still collapses to one column without sticky rules in that breakpoint", () => {
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="narrow"\]\s+\.layout-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="narrow"\]\s+\[data-shell-panel="board"\]\s+\.board\s*>\s*\.cell\s*\{[\s\S]*aspect-ratio:\s*1\s*\/\s*1;[\s\S]*min-height:\s*0;/s,
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
    /\.mini-board-card-list\[data-game-count="1"\]\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*justify-items:\s*start;/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card-list\[data-game-count="1"\]\s*>\s*\.mini-board-card\s*\{[\s\S]*width:\s*min\(100%,\s*26rem\);/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card\s*\{[\s\S]*display:\s*grid;[\s\S]*width:\s*100%;/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card-link-surface\s*\{[\s\S]*display:\s*grid;[\s\S]*width:\s*100%;[\s\S]*padding:\s*0\.85rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.home-games-section-header\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\s+\.home-games-section-header\[data-home-header-has-action="true"\]\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/s,
  );
  assert.match(
    shellStylesSource,
    /\.home-games-section-header-center\s*\{[\s\S]*display:\s*none;[\s\S]*justify-content:\s*flex-end;[\s\S]*justify-self:\s*end;/s,
  );
  assert.match(
    shellStylesSource,
    /\.home-games-section-header-actions\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*justify-content:\s*flex-end;[\s\S]*justify-self:\s*end;/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\s+\.home-games-section-header-center\s*\{\s*display:\s*inline-flex;\s*\}/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-layout-mode="wide"\]\s+\.home-games-section-header\[data-home-header-has-action="true"\]\s+\.home-games-section-header-center\s*\{[\s\S]*justify-content:\s*center;[\s\S]*justify-self:\s*stretch;/s,
  );
  assert.match(
    shellStylesSource,
    /\.home-games-section-controls\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*gap:\s*0\.175rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.home-games-section-controls-footer\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*justify-content:\s*center;[\s\S]*width:\s*100%;/s,
  );
});
