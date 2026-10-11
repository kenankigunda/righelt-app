import { readdirSync } from "node:fs";
import path from "node:path";
import { TOOLING_WEB_FILES } from "./catalog.mjs";
import { classifyWebTestFile } from "../../apps/web/test/test-layers.mjs";
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(path.join(dir, e.name))
      : e.name.endsWith(".test.mjs")
        ? [path.join(dir, e.name)]
        : [],
  );
const roots = {
  "engine-unit": "packages/game-engine/test/unit",
  "engine-integration": "packages/game-engine/test/integration",
  "api-handler": "packages/api-handler/test",
  "api-worker": "apps/api/test",
  "sync-stress": "packages/api-handler/test-stress",
  "sync-runtime": "packages/api-handler/test-runtime",
};
export function nodeInventory(id, cwd = process.cwd()) {
  if (roots[id]) return walk(path.join(cwd, roots[id]));
  if (["web-unit", "web-integration"].includes(id))
    return walk(path.join(cwd, "apps/web/test")).filter(
      (f) =>
        !TOOLING_WEB_FILES.includes(path.basename(f)) &&
        classifyWebTestFile(path.basename(f)) ===
          (id === "web-unit" ? "unit" : "integration"),
    );
  if (id === "tooling")
    return [
      ...[
        "scripts/testing/test",
        "scripts/resources/test",
        "scripts/validation/test",
      ].flatMap((dir) => walk(path.join(cwd, dir))),
      ...readdirSync(path.join(cwd, "scripts"))
        .filter((f) => f.endsWith(".test.mjs"))
        .map((f) => path.join(cwd, "scripts", f)),
      ...TOOLING_WEB_FILES.map((f) => path.join(cwd, "apps/web/test", f)),
    ];
  return null;
}
export function verifyInventory(expected, observations, cwd) {
  const normalize = (f) => (path.isAbsolute(f) ? path.relative(cwd, f) : f);
  const actual = (observations?.tests ?? []).map((t) =>
    normalize(t.file ?? ""),
  );
  const missing = expected.map(normalize).filter((f) => !actual.includes(f));
  return { expected: expected.map(normalize), missing };
}
