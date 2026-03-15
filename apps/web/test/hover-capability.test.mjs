import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOVER_CAPABILITY_ATTRIBUTE,
  HOVER_CAPABILITY_QUERY,
  createHoverCapabilityController,
  detectSupportsHover,
} from "../hover-capability.js";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const stylesSource = readFileSync(join(testDir, "..", "styles.css"), "utf8");
const shellStylesSource = readFileSync(join(testDir, "..", "shell", "shell.css"), "utf8");

test("hover capability uses any-hover media query and treats hybrid devices as hover-capable", () => {
  let queried = null;
  const hybridMatchMedia = (query) => {
    queried = query;
    return { matches: true };
  };

  assert.equal(detectSupportsHover(hybridMatchMedia), true);
  assert.equal(queried, HOVER_CAPABILITY_QUERY);
});

test("hover capability controller updates the root marker when capability changes", () => {
  const root = {
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
  };
  let changeListener = null;
  const mediaQueryList = {
    matches: true,
    addEventListener(_eventName, listener) {
      changeListener = listener;
    },
    removeEventListener() {},
  };
  const controller = createHoverCapabilityController({
    root,
    windowObject: {
      matchMedia(query) {
        assert.equal(query, HOVER_CAPABILITY_QUERY);
        return mediaQueryList;
      },
    },
  });

  assert.equal(controller.getSupportsHover(), true);
  assert.equal(root.attributes.get(HOVER_CAPABILITY_ATTRIBUTE), "hover");

  mediaQueryList.matches = false;
  changeListener?.();

  assert.equal(controller.getSupportsHover(), false);
  assert.equal(root.attributes.get(HOVER_CAPABILITY_ATTRIBUTE), "none");
});

test("hover-only styles are gated behind the root hover capability marker", () => {
  assert.match(stylesSource, /\[data-hover-capability="hover"\]\s+\.board-preview-inline-button:hover/);
  assert.match(stylesSource, /\[data-hover-capability="hover"\]\s+\.cell:not\(.unselectable\):hover/);
  assert.match(shellStylesSource, /\[data-hover-capability="hover"\]\s+\.history-item:hover\s+\.history-move-at/);
  assert.match(shellStylesSource, /\[data-hover-capability="hover"\]\s+\.history-item:hover\s+\.history-move-line/);
});
