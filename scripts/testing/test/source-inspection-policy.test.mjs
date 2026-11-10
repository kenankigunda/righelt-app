import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const policy = JSON.parse(readFileSync(path.join(root, "scripts/testing/source-inspection-allowlist.json"), "utf8"));
const productionSourceReaders = execFileSync("git", ["ls-files", "*.test.mjs"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => {
    const source = readFileSync(path.join(root, file), "utf8");
    return /readFile(?:Sync)?/.test(source) &&
      (/shell\/app\.js/.test(source) || /["'`]app\.js["'`]/.test(source));
  })
  .sort();

test("production app source inspection is explicit and allowlisted", () => {
  assert.equal(policy.version, 1);
  const allowed = policy.allowed.map(({ file, contract }) => {
    assert.match(contract, /workflow|generated|native-fixture|pinned-third-party/);
    return file;
  }).sort();
  assert.deepEqual(productionSourceReaders, allowed);
});
