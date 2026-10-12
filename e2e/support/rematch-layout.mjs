import { waitForOverlayEntry } from "./overlay-motion.mjs";
import { expect } from "@playwright/test";

export async function expectRematchRadioGeometry(dialog) {
  await waitForOverlayEntry(dialog);
  const radios = dialog.getByRole("radio");
  await expect(radios).toHaveCount(2);
  for (const radio of await radios.all()) {
    const geometry = await radio.evaluate(input => {
      const rect = input.getBoundingClientRect();
      const label = input.closest("label");
      const labelRect = label.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label.lastChild);
      const text = range.getBoundingClientRect();
      return { width: rect.width, height: rect.height, appearance: getComputedStyle(input).appearance,
        right: rect.right, textLeft: text.left, textRight: text.right, labelRight: labelRect.right,
        textHeight: text.height, labelWidth: label.clientWidth, scrollWidth: label.scrollWidth };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(16);
    expect(geometry.width).toBeLessThanOrEqual(24);
    expect(geometry.height).toBeGreaterThanOrEqual(16);
    expect(geometry.height).toBeLessThanOrEqual(24);
    expect(["auto", "radio"]).toContain(geometry.appearance);
    expect(geometry.textLeft).toBeGreaterThan(geometry.right);
    expect(geometry.textRight).toBeLessThanOrEqual(geometry.labelRight + 1);
    expect(geometry.textHeight).toBeLessThanOrEqual(28);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.labelWidth + 1);
  }
}
