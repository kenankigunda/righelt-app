import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../src/index.ts";

const env = {
  DB: {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          return { success: true, meta: { last_row_id: 1 } };
        },
      };
    },
  },
};

test("/api/shell/ws returns 426 when runtime has no WebSocketPair support", async () => {
  const response = await handleApiRequest(
    new Request("https://example.test/api/shell/ws?scope=home&identityId=id-a"),
    env,
  );

  assert.equal(response.status, 426);
});
