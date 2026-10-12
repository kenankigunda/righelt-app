import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { SUITES, catalogDigest } from "./catalog.mjs";
const universal =
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|playwright[^/]*\.mjs|scripts\/testing\/|scripts\/resources\/|\.github\/)/;
const known =
  /^(apps\/|packages\/|db\/|e2e\/|browser-integration\/|validation-e2e\/|scripts\/|docs\/|skills\/|AGENTS\.md$|CLAUDE\.md$|tsconfig)/;
export function planForFiles(files, { advisory = true } = {}) {
  const unique = [...new Set(files)].sort();
  let broad = unique.filter((f) => universal.test(f) || !known.test(f));
  const selected = broad.length
    ? SUITES
    : SUITES.filter((s) =>
        unique.some((f) => s.paths.some((p) => f.startsWith(p))),
      );
  const uncovered = unique.filter(
    (f) =>
      !selected.some((s) => s.paths.some((p) => f.startsWith(p))) &&
      !universal.test(f),
  );
  const suites = uncovered.length ? SUITES : selected;
  return {
    version: 1,
    catalog: catalogDigest(),
    advisory,
    files: unique,
    suites: suites.map((s) => s.id),
    reasons: [
      ...broad.map((f) => `Shared or unknown input: ${f}`),
      ...uncovered.map((f) => `Unmapped input, full fallback: ${f}`),
    ],
    requirements: [...new Set(suites.flatMap((s) => s.requirements))],
  };
}
export function changedFiles(cwd, base) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  // Include committed branch changes, staged/unstaged edits, deletions and untracked inputs.
  return [
    ...git("diff", "--name-only", "-z", `${base}...HEAD`).split("\0"),
    ...git("diff", "--name-only", "-z", "HEAD").split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean);
}
export function affectedPlan(cwd, base) {
  const files = changedFiles(cwd, base),
    tracked = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
  // Reverse local import graph includes re-exports and dynamic literal imports.
  const reverse = new Map();
  let unresolved = false;
  for (const file of tracked.filter((f) => /\.(?:mjs|js|ts)$/.test(f))) {
    if (!existsSync(path.join(cwd, file))) continue;
    const text = readFileSync(path.join(cwd, file), "utf8");
    if (files.includes(file) && /import\s*\(\s*(?!['"])/.test(text))
      unresolved = true;
    for (const match of text.matchAll(
      /(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g,
    )) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      const raw = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), spec),
      );
      const target = [
        raw,
        raw.replace(/\.js$/, ".ts"),
        `${raw}.ts`,
        `${raw}.js`,
        `${raw}/index.ts`,
      ].find((p) => tracked.includes(p));
      if (!target) {
        if (files.includes(file)) unresolved = true;
        continue;
      }
      if (!reverse.has(target)) reverse.set(target, []);
      reverse.get(target).push(file);
    }
  }
  const closure = new Set(files),
    queue = [...files];
  while (queue.length) {
    for (const dependent of reverse.get(queue.shift()) ?? [])
      if (!closure.has(dependent)) {
        closure.add(dependent);
        queue.push(dependent);
      }
  }
  const plan = planForFiles([...closure]);
  plan.changed = files;
  plan.base = base;
  if (unresolved) {
    plan.suites = SUITES.map((s) => s.id);
    plan.reasons.push("Changed module has an unresolved import, full fallback");
  }
  return plan;
}
