import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filters = process.argv.slice(2).map((value) => value.toLowerCase());
const candidates = readdirSync(__dirname)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();

const selected =
  filters.length === 0
    ? candidates
    : candidates.filter((file) => filters.some((filter) => file.toLowerCase().includes(filter)));

if (selected.length === 0) {
  console.error("No test files matched filters:", filters.join(", "));
  process.exit(1);
}

const args = ["--test", ...selected.map((file) => path.join(__dirname, file))];
const result = spawnSync(process.execPath, args, { stdio: "inherit" });

process.exit(result.status ?? 1);
