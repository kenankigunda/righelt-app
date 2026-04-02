import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyWebTestFile } from "./test-layers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let requestedLayer = "all";
let reporter = null;
let reporterDestination = null;
const filters = [];
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value === "--") {
    continue;
  }
  if (value === "--layer") {
    requestedLayer = process.argv[index + 1] ?? "all";
    index += 1;
    continue;
  }
  if (value === "--reporter") {
    reporter = process.argv[index + 1] ?? null;
    index += 1;
    continue;
  }
  if (value === "--reporter-destination") {
    reporterDestination = process.argv[index + 1] ?? null;
    index += 1;
    continue;
  }
  filters.push(value.toLowerCase());
}

if (!["all", "unit", "integration"].includes(requestedLayer)) {
  console.error("Unknown web test layer:", requestedLayer);
  process.exit(1);
}

const candidates = readdirSync(__dirname)
  .filter((file) => file.endsWith(".test.mjs"))
  .filter((file) => requestedLayer === "all" || classifyWebTestFile(file) === requestedLayer)
  .sort();

const selected =
  filters.length === 0
    ? candidates
    : candidates.filter((file) => filters.some((filter) => file.toLowerCase().includes(filter)));

if (selected.length === 0) {
  console.error("No test files matched filters:", filters.join(", "));
  process.exit(1);
}

const args = ["--test"];

if (reporter) {
  args.push("--test-reporter", reporter);
}

if (reporterDestination) {
  args.push("--test-reporter-destination", reporterDestination);
}

args.push(...selected.map((file) => path.join(__dirname, file)));
const result = spawnSync(process.execPath, args, { stdio: "inherit" });

process.exit(result.status ?? 1);
