import { expect } from "@playwright/test";

const DEFAULT_A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export const normalizeRect = (rect) => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
  right: rect.left + rect.width,
  bottom: rect.top + rect.height,
});

export const getViewportZoneRect = (viewport, zone) => {
  if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) {
    throw new Error(`Viewport is required to resolve a UX zone. Received: ${JSON.stringify(viewport)}`);
  }

  if (typeof zone === "string") {
    switch (zone) {
      case "header-center":
        return {
          left: viewport.width * 0.3,
          top: 0,
          width: viewport.width * 0.4,
          height: Math.min(160, viewport.height * 0.2),
        };
      case "top-overlay":
        return {
          left: 0,
          top: 0,
          width: viewport.width,
          height: Math.min(220, viewport.height * 0.28),
        };
      case "full-viewport":
        return { left: 0, top: 0, width: viewport.width, height: viewport.height };
      default:
        throw new Error(`Unknown UX zone: ${zone}`);
    }
  }

  if (zone && typeof zone === "object") {
    if (zone.unit === "percent") {
      return {
        left: viewport.width * zone.left,
        top: viewport.height * zone.top,
        width: viewport.width * zone.width,
        height: viewport.height * zone.height,
      };
    }
    return {
      left: zone.left,
      top: zone.top,
      width: zone.width,
      height: zone.height,
    };
  }

  throw new Error(`Unsupported UX zone: ${JSON.stringify(zone)}`);
};

export const rectWithinZone = (rect, zoneRect, tolerancePx = 0) => {
  const normalizedRect = normalizeRect(rect);
  const normalizedZone = normalizeRect(zoneRect);

  return (
    normalizedRect.left >= normalizedZone.left - tolerancePx &&
    normalizedRect.top >= normalizedZone.top - tolerancePx &&
    normalizedRect.right <= normalizedZone.right + tolerancePx &&
    normalizedRect.bottom <= normalizedZone.bottom + tolerancePx
  );
};

export const fingerprintAxeViolations = (results) =>
  (results?.violations ?? []).map((violation) => ({
    rule: violation.id,
    impact: violation.impact ?? "unknown",
    targets: violation.nodes.map((node) => node.target),
  }));

export const assertMaxCumulativeLayoutShift = (entries, maxValue = 0.02) => {
  const total = entries.reduce((sum, entry) => sum + (entry.hadRecentInput ? 0 : entry.value), 0);
  if (total > maxValue) {
    throw new Error(`Expected cumulative layout shift <= ${maxValue}, received ${total}`);
  }
  return total;
};

const loadAxeBuilder = async () => {
  const module = await import("@axe-core/playwright");
  return module.default ?? module;
};

export const installUxMetricsCollector = async (page, storageKey = "__righeltUxMetrics") => {
  const install = (key) => {
    if (window[key]) return;
    const metrics = {
      layoutShiftEntries: [],
      measures: [],
    };

    const storeMeasure = (entry) => {
      metrics.measures.push({
        name: entry.name,
        duration: entry.duration,
        startTime: entry.startTime,
      });
    };

    const storeLayoutShift = (entry) => {
      metrics.layoutShiftEntries.push({
        value: entry.value,
        hadRecentInput: entry.hadRecentInput === true,
        startTime: entry.startTime,
      });
    };

    window[key] = metrics;

    if (typeof PerformanceObserver !== "function") {
      return;
    }

    try {
      const layoutShiftObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          storeLayoutShift(entry);
        }
      });
      layoutShiftObserver.observe({ type: "layout-shift", buffered: true });
    } catch {}

    try {
      const measureObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          storeMeasure(entry);
        }
      });
      measureObserver.observe({ type: "measure", buffered: true });
    } catch {}
  };
  await page.addInitScript(install, storageKey);
  await page.evaluate(install, storageKey);
};

export const readUxMetrics = async (page, storageKey = "__righeltUxMetrics") =>
  page.evaluate((key) => window[key] ?? { layoutShiftEntries: [], measures: [] }, storageKey);

export const expectLocatorInZone = async (page, locator, { zone, tolerancePx = 8 } = {}) => {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected a visible locator with a bounding box");
  }
  const viewport = page.viewportSize() ?? (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
  const zoneRect = getViewportZoneRect(viewport, zone);
  const rect = { left: box.x, top: box.y, width: box.width, height: box.height };
  if (!rectWithinZone(rect, zoneRect, tolerancePx)) {
    throw new Error(`Expected locator to be within zone ${JSON.stringify(zone)}. Rect=${JSON.stringify(rect)} Zone=${JSON.stringify(zoneRect)}`);
  }
};

export const expectStableScreenshot = async (target, name, options = {}) => {
  const { mask = [], maxDiffPixels = 20, stylePath, ...rest } = options;
  await expect(target).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    mask,
    maxDiffPixels,
    stylePath,
    ...rest,
  });
};

export const expectAriaStructure = async (locator, snapshot, options = {}) => {
  await expect(locator).toMatchAriaSnapshot(snapshot, options);
};

export const runScopedAxeScan = async ({ page, include, exclude = [], tags = DEFAULT_A11Y_TAGS, testInfo = null } = {}) => {
  const AxeBuilder = await loadAxeBuilder();
  let builder = new AxeBuilder({ page }).withTags(tags);
  if (include) {
    builder = builder.include(include);
  }
  for (const selector of exclude) {
    builder = builder.exclude(selector);
  }
  const results = await builder.analyze();
  if (testInfo) {
    await testInfo.attach("accessibility-scan-results", {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
  }
  return results;
};
