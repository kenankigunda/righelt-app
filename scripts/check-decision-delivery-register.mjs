import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REGISTER = path.join(
  path.dirname(process.cwd()),
  "righelt-backlog/backlog/docs/ux-decisions/decision-delivery-register.json",
);

const addUnique = (errors, owners, kind, value, taskId) => {
  if (!value) return;
  const prior = owners.get(value);
  if (prior) errors.push(`Duplicate ${kind} ${value}: ${prior} and ${taskId}.`);
  else owners.set(value, taskId);
};

export const checkDecisionDeliveryRegister = (registerPath) => {
  const absoluteRegister = path.resolve(registerPath);
  const repositoryRoot = path.resolve(path.dirname(absoluteRegister), "../../..");
  const register = JSON.parse(readFileSync(absoluteRegister, "utf8"));
  const errors = [];
  const decisionOwners = new Map();
  const taskOwners = new Map();
  const activePrOwners = new Map();

  if (!Array.isArray(register.queue)) return ["Register queue must be an array."];

  for (const entry of register.queue) {
    const taskId = entry.taskId || "unknown task";
    if (!entry.decisionId) errors.push(`${taskId} is missing a decision ID.`);
    if (!entry.taskId) errors.push(`Queue entry ${entry.decisionId || "with unknown decision"} is missing a task ID.`);
    addUnique(errors, decisionOwners, "decision ID", entry.decisionId, taskId);
    addUnique(errors, taskOwners, "task ID", entry.taskId, taskId);

    const missingLinks = [
      !entry.taskPath && "task path",
      !entry.handoff && "handoff",
      !(entry.references || []).length && "selected reference",
    ].filter(Boolean);
    if (missingLinks.length) errors.push(`${taskId} is missing required queue links: ${missingLinks.join(", ")}.`);
    const requiredPaths = [entry.taskPath, entry.handoff, ...(entry.references || [])].filter(Boolean);
    for (const relativePath of requiredPaths) {
      if (!existsSync(path.join(repositoryRoot, relativePath))) {
        errors.push(`${taskId} references missing path ${relativePath}.`);
      }
    }

    const latest = entry.deliveryEvidence?.at(-1);
    if (!latest) {
      errors.push(`${taskId} has no delivery evidence.`);
      continue;
    }

    if (latest.stage === "pr-opened") {
      const canonicalPr = latest.pr || latest.canonicalPr;
      if (!canonicalPr) errors.push(`${taskId} is active without a canonical PR.`);
      else addUnique(errors, activePrOwners, "active canonical PR", canonicalPr, taskId);
    }

    if (latest.stage === "deployed-and-accepted") {
      const requiredEvidence = {
        PR: latest.pr || latest.canonicalPr,
        merge: latest.mergeCommit || latest.mergedCommit,
        deployment: latest.servedIdentity || latest.deployedIdentity,
        acceptance: latest.acceptance || latest.productionEvidence,
        tracking: latest.trackingEvidence,
      };
      for (const [name, value] of Object.entries(requiredEvidence)) {
        if (!value) errors.push(`${taskId} is complete without ${name} evidence.`);
      }
      if (latest.taskStatus !== "Done") errors.push(`${taskId} is complete but status is not Done.`);
    }
  }

  return errors;
};

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const registerFlag = process.argv.indexOf("--register");
  const registerPath = registerFlag >= 0 ? process.argv[registerFlag + 1] : DEFAULT_REGISTER;
  if (!registerPath) throw new Error("--register requires a path");
  const errors = checkDecisionDeliveryRegister(registerPath);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Decision delivery register is consistent.");
  }
}
