import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_DEV_PORT_VARIANTS,
  buildLocalApiOrigin,
  buildLocalApiPersistPath,
  buildLocalApiWsHost,
  resolveLocalApiPort,
} from "../local-dev-ports.js";

test("local dev web ports map to isolated API worker ports and state directories", () => {
  assert.deepEqual(LOCAL_DEV_PORT_VARIANTS, [
    { suffix: "", webPort: 8788, apiPort: 8787 },
    { suffix: "a", webPort: 8789, apiPort: 8792 },
    { suffix: "b", webPort: 8790, apiPort: 8793 },
    { suffix: "c", webPort: 8791, apiPort: 8794 },
  ]);

  assert.equal(resolveLocalApiPort("8788"), 8787);
  assert.equal(resolveLocalApiPort("8789"), 8792);
  assert.equal(resolveLocalApiPort("8790"), 8793);
  assert.equal(resolveLocalApiPort("8791"), 8794);

  assert.equal(buildLocalApiOrigin("8789"), "http://127.0.0.1:8792");
  assert.equal(buildLocalApiOrigin("8789", "localhost"), "http://localhost:8792");
  assert.equal(buildLocalApiOrigin("8789", "[::1]"), "http://[::1]:8792");
  assert.equal(buildLocalApiWsHost("8790"), "127.0.0.1:8793");
  assert.equal(buildLocalApiWsHost("8790", "localhost"), "localhost:8793");
  assert.equal(buildLocalApiPersistPath("8788"), ".wrangler/state/api-local-dev");
  assert.equal(buildLocalApiPersistPath("8791"), ".wrangler/state/api-local-dev-c");
});

test("local dev port mapping falls back to the default API worker port", () => {
  assert.equal(resolveLocalApiPort("9999"), 8787);
  assert.equal(buildLocalApiOrigin(""), "http://127.0.0.1:8787");
});
