import { createHash } from "node:crypto";

export const TOOLING_WEB_FILES = Object.freeze([
  "ci-workflow.test.mjs",
  "deploy-config.test.mjs",
  "e2e-stack.test.mjs",
  "local-dev-ports.test.mjs",
  "local-dev-scripts.test.mjs",
  "local-https.test.mjs",
  "db-retention-cleanup-workflow.test.mjs",
  "ticket-workflow-docs.test.mjs",
  "playwright-launch-options.test.mjs",
]);
const suite = (id, script, paths, requirements, extra = {}) =>
  Object.freeze({ id, script, paths, requirements, ...extra });
export const SUITES = Object.freeze([
  suite(
    "typecheck",
    "typecheck",
    ["apps/", "packages/", "tsconfig"],
    ["type-contracts"],
  ),
  suite(
    "generated",
    "check:web-engine-generated",
    [
      "packages/",
      "apps/web/generated/",
      "scripts/build-web-engine.mjs",
      "scripts/check-web-engine-generated.mjs",
    ],
    ["runtime-freshness"],
  ),
  suite(
    "engine-unit",
    "test:engine:unit",
    ["packages/game-engine/"],
    ["game-rules"],
  ),
  suite(
    "web-unit",
    "test:web:unit",
    ["apps/web/", "packages/"],
    ["client-state"],
  ),
  suite("computer-unit", "test:computer-player:unit", ["packages/computer-player/", "packages/game-engine/", "packages/shared-types/"], ["computer-search", "computer-representation"]),
  suite("computer-integration", "test:computer-player:integration", ["packages/computer-player/", "packages/game-engine/", "packages/shared-types/"], ["computer-legality", "computer-transitions"]),
  suite(
    "engine-integration",
    "test:engine:integration",
    ["packages/game-engine/"],
    ["replay-determinism"],
  ),
  suite(
    "api-handler",
    "test:api-handler",
    [
      "packages/",
      "apps/api/",
      "apps/auth/",
      "apps/auth-hash/",
      "db/",
      "browser-integration/support/lookup.json",
    ],
    [
      "api-contracts",
      "browser-fixture-contracts",
      "authentication",
      "authorization",
      "migration-contracts",
    ],
  ),
  suite(
    "api-worker",
    "test:api-worker",
    ["apps/api/", "packages/"],
    ["worker-boundary"],
  ),
  suite(
    "web-integration",
    "test:web:integration",
    ["apps/web/", "packages/"],
    ["client-api-contracts", "journal-ordering"],
  ),
  suite(
    "sync-stress",
    "test:sync-stress",
    ["apps/web/shell/", "packages/", "db/"],
    ["seeded-faults"],
  ),
  suite(
    "sync-runtime",
    "test:sync-runtime",
    ["apps/api/", "apps/auth/", "apps/auth-hash/", "packages/", "db/"],
    ["transactions", "restart-durability", "authority"],
  ),
  suite(
    "tooling",
    "test:tooling",
    [
      "scripts/",
      ".github/",
      "docs/",
      "skills/",
      "AGENTS.md",
      "CLAUDE.md",
      "apps/web/local-dev-ports.js",
      "apps/web/test/",
    ],
    ["test-infrastructure", "workflow-safety"],
    { browser: true },
  ),
  suite(
    "browser-integration",
    "test:browser:integration",
    [
      "apps/web/",
      "packages/shared-types/",
      "browser-integration/",
      "playwright.browser.config.mjs",
    ],
    ["ui-semantics", "ui-geometry", "focus", "reduced-motion"],
    { browser: true, projects: ["chromium", "firefox", "webkit"], shards: 1 },
  ),
  suite(
    "e2e",
    "test:e2e",
    [
      "apps/",
      "packages/",
      "db/",
      "e2e/",
      "scripts/e2e-stack.mjs",
      "playwright.config.mjs",
    ],
    ["create-move-watch", "persistence", "browser-recovery"],
    { browser: true, projects: ["chromium", "firefox", "webkit"], shards: 2 },
  ),
  suite(
    "auth-e2e",
    "test:e2e:auth:journeys",
    [
      "apps/",
      "packages/",
      "db/",
      "e2e/auth/",
      "scripts/e2e-auth-stack.mjs",
      "scripts/auth-fixture-control.mjs",
      "playwright.auth.config.mjs",
    ],
    ["account-journeys", "cross-tab-authority", "cutover", "result-rematch"],
    { browser: true, projects: ["chromium", "firefox", "webkit"], shards: 2 },
  ),
  suite(
    "auth-controls",
    "test:e2e:auth:controls",
    ["apps/", "packages/", "db/", "e2e/auth/", "scripts/e2e-auth-stack.mjs"],
    ["cutover", "session-expiration", "maintenance"],
    { browser: true, projects: ["chromium", "firefox", "webkit"], shards: 1 },
  ),
  suite(
    "responsive",
    "test:responsive",
    [
      "apps/",
      "packages/",
      "db/",
      "validation-e2e/",
      "scripts/validation/",
      "playwright.validation.config.mjs",
    ],
    ["responsive-continuity"],
    { browser: true },
  ),
  suite(
    "report-viewer",
    "test:report-viewer",
    ["scripts/validation/"],
    ["evidence-review"],
    { browser: true },
  ),
  suite(
    "performance",
    "test:performance",
    ["apps/", "packages/", "db/", "scripts/testing/performance.mjs"],
    ["performance-observation"],
    { browser: true, observational: true },
  ),
]);
export const suiteById = (id) => {
  const found = SUITES.find((s) => s.id === id);
  if (!found) throw Error(`Unknown suite: ${id}`);
  return found;
};
export const catalogDigest = () =>
  createHash("sha256").update(JSON.stringify(SUITES)).digest("hex");
export function fullLanes() {
  return SUITES.flatMap((s) =>
    s.projects
      ? s.projects.flatMap((project) =>
          Array.from({ length: s.shards }, (_, i) => ({
            suite: s.id,
            project,
            shard: i + 1,
            shards: s.shards,
          })),
        )
      : [{ suite: s.id, project: null, shard: 1, shards: 1 }],
  );
}
export const laneKey = (lane) =>
  `${lane.suite}:${lane.project ?? "default"}:${lane.shard}/${lane.shards}`;

export const suiteKind = (id) =>
  ["typecheck", "generated", "report-viewer"].includes(id) ? "check" : "tests";
