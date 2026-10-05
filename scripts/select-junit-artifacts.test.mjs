import test from 'node:test';
import assert from 'node:assert/strict';
import { selectJUnitArtifacts } from './select-junit-artifacts.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const expected = { runId: 37164064079, headSha: 'e2ecbefbe2f69595f33bae1ba2d946d587ed3b31' };
const artifact = (id, name, created_at, extra = {}) => ({ id, name, created_at, expired: false,
  workflow_run: { id: expected.runId, head_sha: expected.headSha }, ...extra });
const old = artifact(11289570113, 'junit-auth-e2e', '2026-10-04T00:17:52Z');
const newer = artifact(11289258407, 'junit-auth-e2e', '2026-10-04T00:45:17Z');
test('partial rerun selects later creation despite lower ID and preserves untouched lanes', () => {
  const unit = artifact(20, 'junit-web-unit', '2026-10-04T00:15:00Z');
  for (const input of [[old, newer, unit], [unit, newer, old]])
    assert.deepEqual(selectJUnitArtifacts(input, expected).map(a => a.id), [newer.id, unit.id]);
});
test('ignores non-JUnit artifacts and accepts an empty run', () => {
  assert.deepEqual(selectJUnitArtifacts([{ name: 'playwright-debug' }], expected), []);
});
test('rejects foreign run or head, invalid IDs and missing or malformed timestamps', () => {
  for (const bad of [
    { workflow_run: { id: 7, head_sha: expected.headSha } },
    { workflow_run: { id: expected.runId, head_sha: '0'.repeat(40) } },
    { workflow_run: undefined }, { id: 0 }, { created_at: undefined },
    { created_at: 'yesterday' }, { created_at: '2026-99-99T00:00:00Z' },
    { created_at: '2026-02-30T00:00:00Z' }, { name: 'junit-../../escape' },
  ]) assert.throws(() => selectJUnitArtifacts([{ ...newer, ...bad }], expected));
});
test('rejects tied creation times and expired newest artifact instead of falling back', () => {
  assert.throws(() => selectJUnitArtifacts([newer, { ...newer, id: 1 }], expected), /Ambiguous/);
  assert.throws(() => selectJUnitArtifacts([old, { ...newer, expired: true }], expected), /unavailable/);
});
test('older tied artifacts do not affect the unambiguous latest selection in any order', () => {
  const tiedOld = { ...old, id: 2 };
  for (const input of [[old, tiedOld, newer], [newer, old, tiedOld], [old, newer, tiedOld]])
    assert.deepEqual(selectJUnitArtifacts(input, expected).map(a => a.id), [newer.id]);
});
test('rejects missing expected run or head', () => {
  assert.throws(() => selectJUnitArtifacts([], { ...expected, runId: undefined }));
  assert.throws(() => selectJUnitArtifacts([], { ...expected, headSha: '' }));
});
test('archive extraction retains XML and rejects traversal and symbolic links', () => {
  const directory = mkdtempSync(join(tmpdir(), 'junit-extraction-'));
  try {
    for (const [entry, mode, ok] of [['nested/results.xml', 0, true], ['../escape.xml', 0, false], ['/escape.xml', 0, false], ['link', 0o120777, false]]) {
      const archive = join(directory, 'test.zip');
      const output = join(directory, 'output');
      const made = spawnSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); i=zipfile.ZipInfo(sys.argv[2]); i.external_attr=int(sys.argv[3])<<16; z.writestr(i,"<testsuites/>"); z.close()', archive, entry, String(mode)]);
      assert.equal(made.status, 0);
      const result = spawnSync('python3', ['scripts/extract-junit-artifact.py', archive, output]);
      assert.equal(result.status === 0, ok);
      if (ok) assert.equal(readFileSync(join(output, entry), 'utf8'), '<testsuites/>');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
