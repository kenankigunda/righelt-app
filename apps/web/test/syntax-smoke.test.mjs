import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const webRoot = path.join(testDir, "..");

const shouldSkipDirectory = (dirname) => dirname === "test" || dirname === ".wrangler";

const shouldCheckFile = (filename) => filename.endsWith(".js");

const collectJavaScriptFiles = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }
      files.push(...collectJavaScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && shouldCheckFile(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
};

test("shipped web javascript modules parse successfully", async (t) => {
  const files = collectJavaScriptFiles(webRoot);
  assert.ok(files.length > 0, "expected at least one shipped web javascript module");

  for (const file of files) {
    await t.test(path.relative(webRoot, file), () => {
      const result = spawnSync(process.execPath, ["--check", file], {
        cwd: path.join(webRoot, "..", ".."),
        encoding: "utf8",
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
    });
  }
});
