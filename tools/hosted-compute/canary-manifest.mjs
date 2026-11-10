// Pure builder: consumes prepared fixture inventory plus reviewed quote/authority.
// It neither provisions hosts nor grants spending authority.
import fixture from './fixture-contract.json' with { type: 'json' };
import { validateManifest, assert } from './policy.mjs';
export function canaryManifest({ prepared, id, host, sourceRevision, dependencySha256, authorizationReference, deadline, maxCents, seconds = 600 }) {
  assert(prepared.fixtureOnly === true && prepared.seed === fixture.seed, 'supported fixture seed required');
  const find = name => { const a = prepared.inputs.find(a => a.name === name); assert(a, `missing prepared ${name}`); return a; };
  const runDir = `.ai-runs/${id}/run`;
  const argv = ['tools/ai-trainer/.venv/bin/python', '-m', 'righelt_training.hosted_canary', '--run-dir', runDir,
    '--checkpoint', find('initial.pt').path, '--corpus', find('corpus.json').path];
  return validateManifest({ schema: 1, id, purpose: 'reliability-pilot', sourceRevision, dependencySha256,
    authorizationReference, deadline, maxCents, seed: prepared.seed,
    checkpointSha256: find('initial.pt').sha256, corpusSha256: find('corpus.json').sha256,
    recipeSha256: find('recipe.json').sha256, executionRecipeSha256: find('execution-recipe.json').sha256,
    inputs: prepared.inputs.map(({role,...a}) => a), phases: [{ id: 'closed-loop', kind: 'rehearsal', device: host.provider === 'runpod' ? 'cuda' : 'cpu',
      seconds, host, argv, resumeArgv: [...argv, '--resume'], runDir, workIds: fixture.workIds,
      outputs: ['result'], outputPaths: {result: `${runDir}/result.json`}, expect: { result: { disposition: 'complete' } } }] });
}

// Local preparation only. Existing files are never overwritten.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [preparedPath, configPath, outputPath] = process.argv.slice(2);
  assert(preparedPath && configPath && outputPath, 'Usage: canary-manifest.mjs PREPARED_JSON REVIEWED_CONFIG_JSON NEW_MANIFEST_JSON');
  const manifest = canaryManifest({...JSON.parse(readFileSync(configPath)), prepared: JSON.parse(readFileSync(preparedPath))});
  writeFileSync(outputPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
}
