// Artifact names are emitted with github.run_attempt. GitHub creation timestamps
// can be inverted across reruns; they are metadata, never attempt authority.
export function selectSuiteArtifacts(artifacts, { runId, headSha }) {
  if (!Number.isSafeInteger(runId) || runId < 1 || typeof headSha !== 'string' || !headSha)
    throw Error('Suite artifact expected run/head missing');
  const byLane = new Map(), seen = new Set();
  for (const artifact of artifacts) {
    if (!artifact.name?.startsWith('suite-')) continue;
    const match = /^(suite-[\w.-]+)-([1-9]\d*)$/.exec(artifact.name);
    const attempt = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(attempt))
      throw Error('Suite artifact attempt malformed');
    if (artifact.workflow_run?.id !== runId || artifact.workflow_run?.head_sha !== headSha)
      throw Error('Suite artifact run/head mismatch');
    if (!Number.isFinite(Date.parse(artifact.created_at)))
      throw Error('Artifact creation time missing');
    const key = `${match[1]}:${attempt}`;
    if (seen.has(key)) throw Error('Ambiguous suite artifact attempt');
    seen.add(key);
    const prior = byLane.get(match[1]);
    if (!prior || attempt > prior.attempt) byLane.set(match[1], {artifact, attempt});
  }
  const selected = [...byLane.values()].map(({artifact}) => artifact);
  if (selected.some(artifact => artifact.expired)) throw Error('Latest suite artifact unavailable');
  return selected;
}
