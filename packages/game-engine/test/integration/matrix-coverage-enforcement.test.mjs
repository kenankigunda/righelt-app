import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const MATRIX_DOC_PATH = "docs/RIGHELT_ENGINE_TEST_MATRIX.md";
const OWNERSHIP_MANIFEST_PATH = "docs/manifests/engine-matrix-ownership.json";

function parseMatrixSections(matrixMarkdown) {
  const sectionRegex = /^## ([A-Z])\.\s.+$/gm;
  const sectionMatches = Array.from(matrixMarkdown.matchAll(sectionRegex));
  const sections = [];

  for (let i = 0; i < sectionMatches.length; i += 1) {
    const current = sectionMatches[i];
    const next = sectionMatches[i + 1];
    const sectionId = current[1];
    const start = current.index ?? 0;
    const end = next?.index ?? matrixMarkdown.length;
    const block = matrixMarkdown.slice(start, end);
    const scenarioIds = Array.from(block.matchAll(/^### ([A-Z]-\d{3})\s.+$/gm)).map((match) => match[1]);

    sections.push({
      sectionId,
      scenarioIds,
    });
  }

  return sections;
}

test("matrix ownership manifest covers every matrix section with executable scenarios", async () => {
  const matrixDoc = await readFile(MATRIX_DOC_PATH, "utf8");
  const manifest = JSON.parse(await readFile(OWNERSHIP_MANIFEST_PATH, "utf8"));
  const sections = parseMatrixSections(matrixDoc);

  const requiredMatrixIds = sections
    .filter((section) => section.scenarioIds.length > 0)
    .map((section) => section.sectionId)
    .sort();
  const manifestMatrixIds = manifest.scenarios
    .map((scenario) => scenario.matrixId)
    .sort();

  assert.deepEqual(manifestMatrixIds, requiredMatrixIds);
});

test("matrix ownership manifest has unique matrix ownership and valid owner tracks", async () => {
  const manifest = JSON.parse(await readFile(OWNERSHIP_MANIFEST_PATH, "utf8"));
  const validTracks = new Set(["A", "B", "C"]);
  const seenMatrixIds = new Set();

  for (const scenario of manifest.scenarios) {
    assert.equal(validTracks.has(scenario.ownerTrack), true, `unknown owner track ${scenario.ownerTrack}`);
    assert.equal(typeof scenario.defaultTestFile, "string");
    assert.ok(scenario.defaultTestFile.startsWith("packages/game-engine/test/"));
    assert.equal(
      seenMatrixIds.has(scenario.matrixId),
      false,
      `duplicate matrix ownership entry for ${scenario.matrixId}`,
    );
    seenMatrixIds.add(scenario.matrixId);
  }
});
