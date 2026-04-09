import test from "node:test";
import assert from "node:assert/strict";

import {
  assertMaxCumulativeLayoutShift,
  fingerprintAxeViolations,
  getViewportZoneRect,
  rectWithinZone,
} from "../../../e2e/support/ux.mjs";

test("resolves named UX zones against the current viewport", () => {
  const headerCenter = getViewportZoneRect({ width: 1200, height: 900 }, "header-center");
  assert.deepEqual(headerCenter, {
    left: 360,
    top: 0,
    width: 480,
    height: 160,
  });

  const overlay = getViewportZoneRect({ width: 390, height: 844 }, "top-overlay");
  assert.equal(overlay.left, 0);
  assert.equal(overlay.top, 0);
  assert.equal(overlay.width, 390);
  assert.equal(overlay.height, 220);
});

test("supports percent-based custom UX zones", () => {
  const zone = getViewportZoneRect(
    { width: 1000, height: 800 },
    { unit: "percent", left: 0.1, top: 0.2, width: 0.5, height: 0.25 },
  );

  assert.deepEqual(zone, {
    left: 100,
    top: 160,
    width: 500,
    height: 200,
  });
});

test("checks whether a rect stays within a zone with tolerance", () => {
  const rect = { left: 110, top: 165, width: 480, height: 180 };
  const zone = { left: 100, top: 160, width: 500, height: 200 };

  assert.equal(rectWithinZone(rect, zone), true);
  assert.equal(rectWithinZone({ left: 90, top: 165, width: 480, height: 180 }, zone), false);
  assert.equal(rectWithinZone({ left: 90, top: 165, width: 480, height: 180 }, zone, 12), true);
});

test("fingerprints axe violations without snapshotting volatile HTML", () => {
  const fingerprints = fingerprintAxeViolations({
    violations: [
      {
        id: "color-contrast",
        impact: "serious",
        nodes: [{ target: ["#primary-button"] }, { target: [".shell-banner"] }],
      },
    ],
  });

  assert.deepEqual(fingerprints, [
    {
      rule: "color-contrast",
      impact: "serious",
      targets: [["#primary-button"], [".shell-banner"]],
    },
  ]);
});

test("asserts cumulative layout shift budgets for UX-sensitive flows", () => {
  const total = assertMaxCumulativeLayoutShift(
    [
      { value: 0.004, hadRecentInput: false },
      { value: 0.003, hadRecentInput: true },
      { value: 0.01, hadRecentInput: false },
    ],
    0.02,
  );

  assert.equal(total, 0.014);
  assert.throws(
    () => assertMaxCumulativeLayoutShift([{ value: 0.05, hadRecentInput: false }], 0.02),
    /Expected cumulative layout shift <= 0.02/,
  );
});
