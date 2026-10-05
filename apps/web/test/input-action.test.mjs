import test from "node:test";
import assert from "node:assert/strict";
import { renderInputAction } from "../shell/input-action.js";

test("input actions identify their field and never submit the surrounding form", () => {
  const markup = renderInputAction({ label: "Show", accessibleLabel: "Show password", action: "toggle-password", controls: "password" });
  assert.match(markup, /type="button"/);
  assert.match(markup, /class="input-action"/);
  assert.match(markup, /aria-controls="password"/);
  assert.match(markup, /aria-label="Show password"/);
  assert.match(markup, /data-input-action="toggle-password"/);
});

test("reusable input actions escape text and attribute values", () => {
  const markup = renderInputAction({ label: '<Show & "hide">', action: '" onclick="run()', controls: '" onfocus="run()' });
  assert.doesNotMatch(markup, /<Show| onclick="| onfocus="/);
  assert.match(markup, /&lt;Show &amp; &quot;hide&quot;&gt;/);
});
