import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getCommandLegendColor, getCommandLegendSwatchStyle } from "../legend.js";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const mainSource = readFileSync(join(testDir, "..", "main.js"), "utf8");
const shellAppSource = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const stylesSource = readFileSync(join(testDir, "..", "styles.css"), "utf8");
const indexSource = readFileSync(join(testDir, "..", "index.html"), "utf8");

test("command legend uses current side-to-move color when no piece is selected", () => {
  assert.equal(
    getCommandLegendColor({ sideToMove: "P1", pieces: [] }, null),
    "var(--player-p1)",
  );
  assert.equal(
    getCommandLegendColor({ sideToMove: "P2", pieces: [] }, null),
    "var(--player-p2)",
  );
});

test("command legend uses selected piece color when a piece is selected", () => {
  assert.equal(
    getCommandLegendColor(
      {
        sideToMove: "P1",
        pieces: [
          { id: "A1", owner: "P2" },
          { id: "B1", owner: "P1" },
        ],
      },
      "A1",
    ),
    "var(--player-p2)",
  );
});

test("command legend swatch style exposes the CSS variable", () => {
  assert.equal(
    getCommandLegendSwatchStyle({ sideToMove: "P2", pieces: [] }),
    "--swatch-command-color: var(--player-p2);",
  );
});

test("playground command legend swatch is state-driven", () => {
  assert.match(indexSource, /id="playground-command-legend-swatch"/);
  assert.match(mainSource, /applyCommandLegendSwatch\(commandLegendSwatchEl, state, selectedPieceId\);/);
});

test("shell command legend swatch is state-driven", () => {
  assert.match(shellAppSource, /id="shell-command-legend-swatch"/);
  assert.match(shellAppSource, /getCommandLegendSwatchStyle\(game\.currentSnapshot \?\? null\)/);
  assert.match(shellAppSource, /applyCommandLegendSwatch\(document\.getElementById\("shell-command-legend-swatch"\), state, selectedPieceId\);/);
});

test("command legend swatch renders as a dashed line", () => {
  assert.match(stylesSource, /\.swatch\.command\s*\{[\s\S]*color:\s*var\(--swatch-command-color, var\(--player-p1\)\);/s);
  assert.match(stylesSource, /\.swatch\.command::before\s*\{[\s\S]*border-top:\s*3px dashed currentColor;/s);
});
