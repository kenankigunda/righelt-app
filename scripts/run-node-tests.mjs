import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = [];
const reporters = [];
const reporterDestinations = [];

for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value === "--") {
    continue;
  }
  if (value === "--reporter") {
    const reporter = process.argv[index + 1];
    if (!reporter) {
      console.error("Missing value for --reporter");
      process.exit(1);
    }
    reporters.push(reporter);
    index += 1;
    continue;
  }
  if (value === "--reporter-destination") {
    const destination = process.argv[index + 1];
    if (!destination) {
      console.error("Missing value for --reporter-destination");
      process.exit(1);
    }
    reporterDestinations.push(destination);
    index += 1;
    continue;
  }
  roots.push(value);
}

if (roots.length === 0) {
  console.error("Expected at least one test file or directory root.");
  process.exit(1);
}

if (reporters.length === 0) {
  reporters.push("spec");
}

if (reporterDestinations.length > 0 && reporterDestinations.length !== reporters.length) {
  console.error("Reporter destinations must match the number of reporters.");
  process.exit(1);
}

if (reporters.length > 1 && reporterDestinations.length === 0) {
  console.error("Multiple reporters require explicit --reporter-destination entries.");
  process.exit(1);
}

for (const destination of reporterDestinations) {
  if (destination === "stdout" || destination === "stderr") {
    continue;
  }
  mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
}

const collectTestFiles = (rootPath) => {
  const absoluteRoot = path.resolve(rootPath);
  const stats = statSync(absoluteRoot);
  if (stats.isFile()) {
    return absoluteRoot.endsWith(".test.mjs") ? [absoluteRoot] : [];
  }

  const entries = readdirSync(absoluteRoot, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      files.push(entryPath);
    }
  }
  return files;
};

const selected = roots.flatMap(collectTestFiles);

if (selected.length === 0) {
  console.error("No test files found under:", roots.join(", "));
  process.exit(1);
}

const args = ["--import", "tsx", "--test"];
for (const reporter of reporters) {
  args.push("--test-reporter", reporter);
}
for (const destination of reporterDestinations) {
  args.push("--test-reporter-destination", destination);
}
args.push(...selected);

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
