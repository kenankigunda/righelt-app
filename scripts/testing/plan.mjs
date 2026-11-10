import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { laneKey, prGateLanes } from "./catalog.mjs";

const requirements = JSON.parse(readFileSync(new URL("./requirements.json", import.meta.url), "utf8"));
const productionPrefixes = ["apps/", "packages/", "db/", "e2e/", "browser-integration/", "validation-e2e/", "scripts/", "docs/", "skills/"];
const assetExtension = /\.(?:css|html|json|svg|png|jpe?g|webp|woff2?|ttf|wasm)$/i;

const isBroad = (file) => requirements.broadPrefixes.some((prefix) =>
  prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix || file.startsWith(prefix),
);
const matchingRules = (file) => requirements.rules.filter(({ prefix }) =>
  prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix,
);

export function planForFiles(files, { advisory = true, unsafeInputs = [] } = {}) {
  const unique = [...new Set(files)].sort();
  const broad = unique.filter(isBroad);
  const unmatched = unique.filter((file) => !isBroad(file) && !matchingRules(file).length);
  const unresolvedProduction = unmatched.filter((file) =>
    productionPrefixes.some((prefix) => file.startsWith(prefix)) || assetExtension.test(file),
  );
  const fallback = broad.length > 0 || unmatched.length > 0 || unresolvedProduction.length > 0 || unsafeInputs.length > 0;
  const selectedSuites = new Set();
  const selectedRequirements = new Set();
  for (const file of unique) for (const rule of matchingRules(file)) {
    rule.suites.forEach((suite) => selectedSuites.add(suite));
    rule.requirements.forEach((requirement) => selectedRequirements.add(requirement));
  }
  const lanes = prGateLanes();
  const proposed = fallback ? lanes : lanes.filter((lane) => selectedSuites.has(lane.suite));
  return {
    version: 2,
    manifestVersion: requirements.version,
    advisory,
    files: unique,
    suites: [...new Set(proposed.map((lane) => lane.suite))],
    lanes: proposed.map((lane) => ({ ...lane, key: laneKey(lane) })),
    requirements: [...selectedRequirements].sort(),
    fallback,
    reasons: [
      ...broad.map((file) => `Shared configuration selects the broad stable gate: ${file}`),
      ...unmatched.map((file) => `Unknown input selects the broad stable gate: ${file}`),
      ...unsafeInputs.map((file) => `Unresolved dynamic dependency selects the broad stable gate: ${file}`),
    ],
  };
}

function parseNameStatus(output) {
  const tokens = output.split("\0").filter(Boolean), files = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    if (/^[RC]\d+/.test(status)) files.push(tokens[i++], tokens[i++]);
    else files.push(tokens[i++]);
  }
  return files.filter(Boolean);
}

export function changedFiles(cwd, base) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  return [
    ...parseNameStatus(git("diff", "--name-status", "-z", `${base}...HEAD`)),
    ...parseNameStatus(git("diff", "--name-status", "-z", "HEAD")),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean),
  ];
}

export function affectedPlan(cwd, base) {
  const changed = changedFiles(cwd, base);
  const unsafeInputs = changed.filter((file) => {
    if (!/\.[cm]?[jt]sx?$/.test(file)) return false;
    try {
      const source = readFileSync(path.join(cwd, file), "utf8");
      return /\b(?:import|fetch)\s*\(\s*(?:[^\s"'`]|`[^`]*\$\{)/.test(source);
    } catch {
      return false;
    }
  });
  const plan = planForFiles(changed, { unsafeInputs });
  plan.changed = [...new Set(changed)].sort();
  plan.base = base;
  plan.shadowOnly = true;
  return plan;
}
