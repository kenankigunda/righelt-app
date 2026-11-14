import { expect, test } from "@playwright/test";
import { gameDocumentIconSvg } from "../apps/web/shell/document-icon.js";
import { gameDateInlayModel, renderGameDateInlay } from "../apps/web/shell/game-date-inlay.js";

const phases = [
  ["late night", "2026-11-13T01:00:00.000Z"],
  ["night", "2026-11-13T21:00:00.000Z"],
];

const rasterStats = async (page, svg, { width, height, color, viewBox, region }) => page.evaluate(async ({ svg, width, height, color, viewBox, region }) => {
  const image = new Image();
  const standalone = /<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  image.src = `data:image/svg+xml,${encodeURIComponent(standalone)}`;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("SVG did not rasterize"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const expected = color.match(/[0-9a-f]{2}/gi).map(value => Number.parseInt(value, 16));
  let deepPixels = 0;
  let deepAlpha = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const pixel = index / 4;
    const pixelX = pixel % width;
    const pixelY = Math.floor(pixel / width);
    const unitX = (pixelX + 0.5) * viewBox[0] / width;
    const unitY = (pixelY + 0.5) * viewBox[1] / height;
    if (Math.abs(unitX - region.x) > region.radius || Math.abs(unitY - region.y) > region.radius) continue;
    const nearDeep = expected.every((component, channel) => Math.abs(pixels[index + channel] - component) <= 8);
    if (!nearDeep || pixels[index + 3] === 0) continue;
    deepPixels += 1;
    deepAlpha += pixels[index + 3];
  }
  return { deepPixels, deepAlpha };
}, { svg, width, height, color, viewBox, region });

test("both night phases retain a filled crescent at page and favicon sizes", async ({ page }) => {
  for (const [expectedPhase, startedAt] of phases) {
    const options = { locale: "en-US", timeZone: "UTC" };
    const model = gameDateInlayModel(startedAt, options);
    expect(model.phase).toBe(expectedPhase);
    expect(model.moon).toBe(true);

    const pageSvg = renderGameDateInlay(startedAt, options);
    const pagePixels = await rasterStats(page, pageSvg, {
      width: 48,
      height: 56,
      color: model.palette[0],
      viewBox: [48, 56],
      region: { x: model.position[0], y: model.position[1], radius: 5 },
    });
    expect(pagePixels.deepPixels, `${expectedPhase} page crescent`).toBeGreaterThan(0);
    expect(pagePixels.deepAlpha, `${expectedPhase} page crescent alpha`).toBeGreaterThan(255);

    const iconSvg = gameDocumentIconSvg(startedAt, options);
    for (const size of [16, 32]) {
      const iconPixels = await rasterStats(page, iconSvg, {
        width: size,
        height: size,
        color: model.palette[0],
        viewBox: [64, 64],
        region: { x: model.position[0] + 8, y: model.position[1] + 4, radius: 5 },
      });
      expect(iconPixels.deepPixels, `${expectedPhase} ${size}px favicon crescent`).toBeGreaterThan(0);
      expect(iconPixels.deepAlpha, `${expectedPhase} ${size}px favicon crescent alpha`).toBeGreaterThan(0);
    }
  }
});

test("the historical corrected-radius path is a genuine zero-area negative control", async ({ page }) => {
  const broken = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56"><path fill="#2c405b" d="M12.7 46.5a3.5 3.5 0 1 0 0 7 3.2 3.2 0 0 1 0-7Z"/></svg>';
  const pixels = await rasterStats(page, broken, {
    width: 48,
    height: 56,
    color: "#2c405b",
    viewBox: [48, 56],
    region: { x: 10, y: 50, radius: 5 },
  });
  expect(pixels.deepPixels).toBe(0);
  expect(pixels.deepAlpha).toBe(0);
});
