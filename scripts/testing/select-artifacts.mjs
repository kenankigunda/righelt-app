// Artifact names are emitted with github.run_attempt. GitHub creation timestamps
// can be inverted across reruns; they are metadata, never attempt authority.
export function selectSuiteArtifacts(artifacts, { runId, headSha, runAttempt }) {
  if (!Number.isSafeInteger(runId) || runId < 1 || typeof headSha !== 'string' || !headSha)
    throw Error('Suite artifact expected run/head missing');
  const byLane = new Map(), seen = new Set();
  for (const artifact of artifacts) {
    if (!artifact.name?.startsWith('suite-')) continue;
    const match = /^(suite-[\w.-]+)-([1-9]\d*)$/.exec(artifact.name);
    const attempt = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(attempt) || (runAttempt !== undefined && (!Number.isSafeInteger(runAttempt) || runAttempt < 1 || attempt > runAttempt)))
      throw Error('Suite artifact attempt malformed');
    if (artifact.workflow_run?.id !== runId || artifact.workflow_run?.head_sha !== headSha)
      throw Error('Suite artifact run/head mismatch');
    if (!Number.isFinite(Date.parse(artifact.created_at)))
      throw Error('Artifact creation time missing');
    const testAttempt = /-attempt-([12])$/.exec(match[1]);
    const logicalLane = testAttempt ? match[1].slice(0, -testAttempt[0].length) : match[1];
    const key = `${match[1]}:${attempt}`;
    if (seen.has(key)) throw Error('Ambiguous suite artifact attempt');
    seen.add(key);
    const lane = byLane.get(logicalLane) ?? new Map();
    const current = lane.get(attempt) ?? [];
    current.push({artifact, testAttempt: Number(testAttempt?.[1] ?? 1)});
    lane.set(attempt, current);
    byLane.set(logicalLane, lane);
  }
  const selected = [];
  for (const attempts of byLane.values()) {
    const entries = [...attempts.entries()].flatMap(([workflowAttempt, values]) =>
      values.map((value) => ({ ...value, workflowAttempt })),
    );
    const firstAttempt = Math.max(...entries.filter((entry) => entry.testAttempt === 1).map((entry) => entry.workflowAttempt));
    const first = entries.filter((entry) => entry.testAttempt === 1 && entry.workflowAttempt === firstAttempt);
    const eligibleSecondAttempts = entries
      .filter((entry) => entry.testAttempt === 2 && entry.workflowAttempt >= firstAttempt)
      .map((entry) => entry.workflowAttempt);
    const secondAttempt = eligibleSecondAttempts.length ? Math.max(...eligibleSecondAttempts) : null;
    const second = entries.filter((entry) => entry.testAttempt === 2 && entry.workflowAttempt === secondAttempt);
    if (first.length !== 1 || second.length > 1)
      throw Error('Suite artifact retry inventory malformed');
    selected.push(first[0].artifact, ...second.map((entry) => entry.artifact));
  }
  if (selected.some(artifact => artifact.expired)) throw Error('Latest suite artifact unavailable');
  return selected;
}
