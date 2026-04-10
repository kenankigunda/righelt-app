import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const indexSource = readFileSync(join(testDir, "..", "index.html"), "utf8");
const shellStylesSource = readFileSync(join(testDir, "..", "shell", "shell.css"), "utf8");
const stylesSource = readFileSync(join(testDir, "..", "styles.css"), "utf8");

test("web app keeps the standard mobile viewport meta tag", () => {
  assert.match(indexSource, /<meta name="viewport" content="width=device-width, initial-scale=1\.0" \/>/);
});

test("shell header wraps long mobile status and identity tokens instead of widening the page", () => {
  assert.match(
    shellStylesSource,
    /\.shell-header \.mono\s*\{[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;/s,
  );
});

test("shell header stacks cleanly on narrow screens", () => {
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-header-status\s*\{[\s\S]*position:\s*fixed;[\s\S]*top:\s*1rem;[\s\S]*z-index:\s*20;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-header\s*\{[\s\S]*align-items:\s*center;[\s\S]*\}[\s\S]*\.shell-header-main,\s*\.shell-header-status,\s*\.shell-header-actions\s*\{[\s\S]*flex:\s*0 1 auto;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-header-main\s*\{[\s\S]*flex:\s*1 1 auto;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-header-actions\s*\{[\s\S]*justify-self:\s*end;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-header-menu-root\s*\{[\s\S]*display:\s*block;/s,
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
    /\.shell-header\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*32rem\)\s*minmax\(0,\s*1fr\);[\s\S]*align-items:\s*center;[\s\S]*position:\s*relative;[\s\S]*border-radius:\s*14px;[\s\S]*padding:\s*0\.9rem\s+1rem\s+0\.9rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header-status\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*0\.9rem;[\s\S]*left:\s*50%;[\s\S]*width:\s*min\(100%,\s*32rem\);[\s\S]*max-width:\s*calc\(100% - 2rem\);[\s\S]*min-height:\s*var\(--shell-alert-stack-height,\s*5\.6rem\);[\s\S]*height:\s*var\(--shell-alert-stack-height,\s*5\.6rem\);[\s\S]*display:\s*flex;[\s\S]*align-items:\s*flex-start;[\s\S]*transform:\s*translateX\(-50%\);/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header-status\[data-shell-alert-zone="idle"\]\s*\{[\s\S]*visibility:\s*hidden;[\s\S]*pointer-events:\s*none;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header h1\s*\{[\s\S]*font-size:\s*2rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header-title-link\s*\{[\s\S]*color:\s*inherit;[\s\S]*text-decoration:\s*none;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header-menu-panel\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*calc\(100%\s*\+\s*0\.45rem\);[\s\S]*right:\s*0;[\s\S]*width:\s*min\(17rem,\s*calc\(100vw\s*-\s*3\.5rem\)\);/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header-menu-panel\s*\{[\s\S]*gap:\s*0;[\s\S]*padding:\s*0;[\s\S]*overflow:\s*hidden;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header-menu-panel\s*\{[\s\S]*transform-origin:\s*top right;[\s\S]*transform:\s*translateY\(-0\.35rem\) scale\(0\.78\);[\s\S]*opacity:\s*0;[\s\S]*pointer-events:\s*none;[\s\S]*transition:\s*[\s\S]*transform 180ms ease,[\s\S]*opacity 180ms ease;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header-menu-panel\.is-open\s*\{[\s\S]*transform:\s*translateY\(0\) scale\(1\);[\s\S]*opacity:\s*1;[\s\S]*pointer-events:\s*auto;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-header-menu-panel button\.secondary\.shell-header-menu-item\s*\{[\s\S]*width:\s*100%;[\s\S]*min-height:\s*3\.75rem;[\s\S]*border-radius:\s*0;[\s\S]*padding:\s*1rem 1\.1rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card\s*\{[\s\S]*position:\s*relative;[\s\S]*overflow:\s*clip;/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card\[data-home-game-card\] \.mini-board-card-link-surface\s*\{[\s\S]*padding-top:\s*3rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card-menu\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*0\.55rem;[\s\S]*right:\s*0\.55rem;[\s\S]*z-index:\s*3;/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card-menu-button\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*min-width:\s*2\.75rem;[\s\S]*min-height:\s*2\.75rem;[\s\S]*border-radius:\s*999px;/s,
  );
  assert.match(
    shellStylesSource,
    /\.mini-board-card-menu-panel\s*\{[\s\S]*width:\s*min\(14rem,\s*calc\(100vw\s*-\s*3rem\)\);[\s\S]*box-shadow:\s*var\(--shell-elevated-shadow\);/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-header-menu-panel\s*\{[\s\S]*width:\s*calc\(100vw\s*-\s*3\.5rem\);[\s\S]*max-width:\s*calc\(100vw\s*-\s*3\.5rem\);/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.mini-board-card-menu-button\s*\{[\s\S]*min-width:\s*3\.75rem;[\s\S]*min-height:\s*3\.75rem;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.mini-board-card-menu-panel\s*\{[\s\S]*width:\s*min\(15rem,\s*calc\(100vw\s*-\s*3rem\)\);/s,
  );
});

test("shell main layout transitions width when docked flyouts open or close", () => {
  assert.match(
    shellStylesSource,
    /\.app-root\s*\{[\s\S]*transition:\s*padding-right 180ms ease;/s,
  );
  assert.match(
    shellStylesSource,
    /\.app-root\s*\{[\s\S]*gap:\s*0\.75rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-main-content\s*\{[\s\S]*transition:[\s\S]*width 180ms ease,[\s\S]*max-width 180ms ease;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-main-content\s*\{[\s\S]*gap:\s*0\.75rem;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-game-alerts:empty,\s*#shell-game-alerts:empty\s*\{[\s\S]*display:\s*none;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-game-alert\s*\{[\s\S]*height:\s*100%;[\s\S]*animation:\s*shell-game-alert-reveal 180ms ease;[\s\S]*overflow:\s*hidden;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-game-alert-stack-card\s*\{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*transform-origin:\s*top center;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-game-alert-copy\s*\{[\s\S]*-webkit-line-clamp:\s*2;[\s\S]*overflow:\s*hidden;/s,
  );
  assert.match(
    shellStylesSource,
    /\.left-game-banner\s*\{[\s\S]*box-shadow:\s*0 18px 40px rgba\(29, 45, 53, 0\.12\);/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-route-transition-layer\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*pointer-events:\s*none;[\s\S]*opacity:\s*0;[\s\S]*visibility:\s*hidden;/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-route-transition-layer-swipe\s*\{[\s\S]*var\(--player-p1\)[\s\S]*var\(--player-p2\)/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-route-transition-layer\[data-phase="covering"\]\s+\.shell-route-transition-layer-swipe\s*\{[\s\S]*animation:\s*shell-game-entry-swipe-in var\(--shell-game-entry-cover-ms,\s*160ms\)/s,
  );
  assert.match(
    shellStylesSource,
    /\.shell-route-transition-layer\[data-phase="revealing"\]\s+\.shell-route-transition-layer-swipe\s*\{[\s\S]*animation:\s*shell-game-entry-swipe-out var\(--shell-game-entry-reveal-ms,\s*200ms\)/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-transition-active="true"\]\[data-shell-transition="game-entry"\]\[data-shell-transition-phase="revealing"\]\[data-shell-route="game"\]\s+\.shell-main-content\s*\{[\s\S]*animation:\s*shell-game-entry-content-reveal var\(--shell-game-entry-reveal-ms,\s*200ms\)/s,
  );
});

test("create-game handoff disables branded motion when reduced motion is requested", () => {
  assert.match(
    shellStylesSource,
    /@media \(prefers-reduced-motion: reduce\) \{\s*[\s\S]*\.shell-game-alert\s*\{[\s\S]*animation:\s*none;[\s\S]*\}[\s\S]*\.shell-game-alert-stack-card\s*\{[\s\S]*transition:\s*none;[\s\S]*\}[\s\S]*\.shell-route-transition-layer-backdrop,\s*\.shell-route-transition-layer-swipe,[\s\S]*animation:\s*none;[\s\S]*\.shell-route-transition-layer\s*\{[\s\S]*display:\s*none;/s,
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
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-flyout-stack\s*\{[\s\S]*left:\s*0;[\s\S]*flex-direction:\s*column;[\s\S]*justify-content:\s*flex-end;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-flyout\s*\{[\s\S]*width:\s*100%;[\s\S]*max-height:\s*50vh;[\s\S]*flex:\s*0 1 50vh;[\s\S]*border-left:\s*0;[\s\S]*border-right:\s*0;[\s\S]*border-bottom:\s*0;/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-flyout\s*\{[\s\S]*transform:\s*translateY\(calc\(100%\s*\+\s*1rem\)\);/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-flyout\.is-open\s*\{[\s\S]*transform:\s*translateY\(0\);/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.shell-flyout\.is-closing\s*\{[\s\S]*transform:\s*translateY\(100%\);/s,
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
  assert.match(
    shellStylesSource,
    /#app\[data-shell-route="game"\]\[data-shell-layout-mode="narrow"\]\s+\.game-shell-track\s*\{[\s\S]*display:\s*flex;[\s\S]*transform:\s*translateX\(calc\(var\(--shell-game-panel-index,\s*1\)\s*\*\s*-100%\)\);[\s\S]*transition:\s*transform var\(--shell-mobile-panel-transition\);/s,
  );
  assert.match(
    shellStylesSource,
    /#app\[data-shell-route="game"\]\[data-shell-layout-mode="narrow"\]\s+\.shell-mobile-tabbar\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*position:\s*sticky;[\s\S]*bottom:\s*0;/s,
  );
  assert.doesNotMatch(
    shellStylesSource,
    /#app\[data-shell-layout-mode="narrow"\]\s+\.layout-grid > \[data-shell-sticky-target\][\s\S]*position:\s*sticky;/s,
  );
});

test("shared legacy grid collapses at the unified 900px breakpoint", () => {
  assert.match(
    stylesSource,
    /@media \(max-width: 900px\)\s*\{[\s\S]*\.grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/s,
  );
});

test("board preview prompt tightens font size on very narrow screens to preserve a two-line helper block", () => {
  assert.match(
    stylesSource,
    /\.board-preview-label\s*\{[\s\S]*line-height:\s*1\.45;[\s\S]*min-height:\s*calc\(2 \* 1\.45em\);[\s\S]*font-size:\s*1\.3rem;/s,
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 430px\)\s*\{[\s\S]*\.board-preview-label\s*\{[\s\S]*font-size:\s*1\.15rem;/s,
  );
});

test("very narrow home and game shells tighten gutters to maximize screen real estate", () => {
  assert.match(
    shellStylesSource,
    /@media \(max-width: 480px\)\s*\{[\s\S]*#app\[data-shell-route="home"\],\s*#app\[data-shell-route="game"\],\s*#app\[data-shell-route="invite"\]\s*\{[\s\S]*calc\(100vw - 0\.65rem\)/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 480px\)\s*\{[\s\S]*#app\[data-shell-route="home"\] \.shell-header,\s*#app\[data-shell-route="game"\] \.shell-header,\s*#app\[data-shell-route="invite"\] \.shell-header\s*\{[\s\S]*padding-left:\s*0\.65rem;[\s\S]*padding-right:\s*0\.65rem;/s,
  );
});

test("very narrow game shell still hides board axis labels and trims board padding", () => {
  assert.match(
    shellStylesSource,
    /@media \(max-width: 480px\)\s*\{[\s\S]*\[data-shell-panel="board"\]\s*\.axis-label[\s\S]*display:\s*none/s,
  );
  assert.match(
    shellStylesSource,
    /@media \(max-width: 480px\)\s*\{[\s\S]*\[data-shell-panel="board"\]\s*\.board-wrap[\s\S]*padding-bottom:\s*0\.35rem/s,
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
    /\.home-games-section-header\[data-home-header-paging="true"\]\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/s,
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
    /\.home-games-section-header\[data-home-header-paging="true"\]\s+\.home-games-section-header-center\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*justify-content:\s*center;[\s\S]*justify-self:\s*stretch;/s,
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
