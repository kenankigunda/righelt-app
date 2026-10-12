// Preserve successful untouched lanes on a partial rerun, without accepting another run/head.
export function selectSuiteArtifacts(artifacts, { runId, headSha }) {
  const byLane = new Map();
  for (const artifact of artifacts) {
    const match = /^(suite-.+)-(\d+)$/.exec(artifact.name ?? "");
    if (!match || artifact.expired) continue;
    if (
      artifact.workflow_run?.id !== runId ||
      artifact.workflow_run?.head_sha !== headSha
    )
      throw Error("Suite artifact run/head mismatch");
    const time = Date.parse(artifact.created_at);
    if (!Number.isFinite(time)) throw Error("Artifact creation time missing");
    const prior = byLane.get(match[1]);
    if (prior && time === Date.parse(prior.created_at))
      throw Error("Ambiguous suite artifact creation time");
    if (!prior || time > Date.parse(prior.created_at))
      byLane.set(match[1], artifact);
  }
  return [...byLane.values()];
}
