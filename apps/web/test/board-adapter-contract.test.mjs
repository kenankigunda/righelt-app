import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertGameBoardAdapter } from "../board-adapter-contract.js";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const contractSource = readFileSync(join(testDir, "..", "board-adapter-contract.js"), "utf8");

test("assertGameBoardAdapter accepts valid adapter shape", () => {
  const adapter = {
    getCapabilities() {
      return { live: true, history: false, tutorial: false, offlineLocal: false };
    },
    mount() {},
    unmount() {},
    getPieceAt() {
      return null;
    },
    getPieceById() {
      return null;
    },
    nextSelectionForCell() {
      return { selection: { selectedPieceId: null, source: null, target: null }, nextActionType: "pass" };
    },
    render() {},
    getCommanderSupplySummary() {
      return "-";
    },
    getSelectedPieceSummary() {
      return null;
    },
  };

  assert.doesNotThrow(() => assertGameBoardAdapter(adapter));
});

test("assertGameBoardAdapter throws when required method is missing", () => {
  const adapter = {
    getCapabilities() {
      return { live: true, history: false, tutorial: false, offlineLocal: false };
    },
  };

  assert.throws(() => assertGameBoardAdapter(adapter), /missing method/i);
});

test("board adapter contract documents static interaction mode on mount and render", () => {
  assert.match(contractSource, /interactionMode\?: "interactive" \| "static"/);
});
