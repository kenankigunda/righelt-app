export const WEB_UNIT_TEST_FILES = Object.freeze([
  "adapter-render-status.test.mjs",
  "api-proxy.test.mjs",
  "board-adapter-contract.test.mjs",
  "bootstrap.test.mjs",
  "brand.test.mjs",
  "client-move-generation.test.mjs",
  "deploy-config.test.mjs",
  "engine-board-adapter.test.mjs",
  "e2e-stack.test.mjs",
  "foundation-boundary.test.mjs",
  "hover-capability.test.mjs",
  "interaction.test.mjs",
  "legend.test.mjs",
  "local-dev-ports.test.mjs",
  "local-dev-scripts.test.mjs",
  "mobile-layout.test.mjs",
  "operation-manager.test.mjs",
  "play-view.test.mjs",
  "optimistic-live.test.mjs",
  "routing.test.mjs",
  "shell-host.test.mjs",
  "shell-render-stability.test.mjs",
  "sync-store.test.mjs",
  "syntax-smoke.test.mjs",
  "ticket-workflow-docs.test.mjs",
  "test-layers.test.mjs",
  "tutorial.test.mjs",
  "ui-guards.test.mjs",
]);

const WEB_UNIT_TEST_FILE_SET = new Set(WEB_UNIT_TEST_FILES);

export const classifyWebTestFile = (fileName) => (WEB_UNIT_TEST_FILE_SET.has(fileName) ? "unit" : "integration");
