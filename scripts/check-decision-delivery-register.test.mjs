import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkDecisionDeliveryRegister } from "./check-decision-delivery-register.mjs";

const fixture = (queue) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "righelt-register-"));
  const registerPath = path.join(root, "backlog/docs/ux-decisions/register.json");
  for (const relativePath of ["backlog/tasks/t-1.md", "backlog/docs/tickets/t-1/handoff.md", "backlog/assets/ref.png"]) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, "fixture");
  }
  mkdirSync(path.dirname(registerPath), { recursive: true });
  writeFileSync(registerPath, JSON.stringify({ queue }));
  return registerPath;
};

const completeEntry = {
  decisionId: "G01",
  taskId: "T-1",
  taskPath: "backlog/tasks/t-1.md",
  handoff: "backlog/docs/tickets/t-1/handoff.md",
  references: ["backlog/assets/ref.png"],
  deliveryEvidence: [{
    stage: "deployed-and-accepted",
    canonicalPr: "https://example.test/pr/1",
    mergedCommit: "abc",
    deployedIdentity: "abc",
    productionEvidence: "passed",
    acceptance: "accepted",
    trackingEvidence: "pushed",
    taskStatus: "Done",
  }],
};

test("accepts a closed decision with legacy evidence field names", () => {
  assert.deepEqual(checkDecisionDeliveryRegister(fixture([completeEntry])), []);
});

test("rejects duplicate ownership and missing queue links", () => {
  const duplicate = {
    ...completeEntry,
    decisionId: "G02",
    taskPath: "backlog/tasks/missing.md",
  };
  const errors = checkDecisionDeliveryRegister(fixture([completeEntry, duplicate]));
  assert.ok(errors.some((error) => error.includes("Duplicate task ID")));
  assert.ok(errors.some((error) => error.includes("references missing path")));
});
