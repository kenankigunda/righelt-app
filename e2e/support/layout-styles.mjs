import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Offline component documents have no application URL for relative CSS imports.
// Inline the shipped token file at its original import position so all browsers
// exercise the same complete cascade as the application.
const stylesheetUrl = new URL("../../apps/web/styles.css", import.meta.url);
const stylesheet = await readFile(stylesheetUrl, "utf8");
const tokenImport = '@import url("./design-tokens.css");';
assert.equal(stylesheet.split(tokenImport).length, 2, "Update the component fixture when the shipped token import changes");
const tokens = await readFile(new URL("./design-tokens.css", stylesheetUrl), "utf8");
export const layoutStyles = stylesheet.replace(tokenImport, () => tokens)
  + "\n" + await readFile(new URL("../../apps/web/shell/shell.css", import.meta.url), "utf8");
assert.doesNotMatch(layoutStyles, /@import\b/, "Offline component styles must include every imported stylesheet");
