// Partial reruns retain earlier lane artifacts. IDs do not encode chronology.
export function selectJUnitArtifacts(artifacts, { runId, headSha }) {
  if (!Number.isSafeInteger(runId) || runId <= 0 || !/^[0-9a-f]{40}$/.test(headSha || ''))
    throw new Error('Invalid expected workflow provenance');
  const lanes = new Map();
  for (const artifact of artifacts) {
    if (!artifact.name?.startsWith('junit-')) continue;
    if (!/^junit-[a-z0-9-]+$/.test(artifact.name)) throw new Error('Invalid lane artifact name');
    if (artifact.workflow_run?.id !== runId || artifact.workflow_run?.head_sha !== headSha)
      throw new Error(`Unexpected workflow provenance: ${artifact.name}`);
    const created = Date.parse(artifact.created_at);
    if (typeof artifact.created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(artifact.created_at) || !Number.isFinite(created)
      || new Date(created).toISOString().slice(0, 19) !== artifact.created_at.slice(0, 19))
      throw new Error(`Invalid creation time: ${artifact.name}`);
    if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0)
      throw new Error(`Invalid artifact ID: ${artifact.name}`);
    const previous = lanes.get(artifact.name);
    if (!previous || created > previous.created) lanes.set(artifact.name, { artifact, created, ambiguous: false });
    else if (created === previous.created) previous.ambiguous = true;
  }
  return [...lanes.values()].sort((a, b) => a.artifact.name.localeCompare(b.artifact.name)).map(({ artifact, ambiguous }) => {
    if (ambiguous) throw new Error(`Ambiguous creation time: ${artifact.name}`);
    if (artifact.expired !== false) throw new Error(`Latest artifact unavailable: ${artifact.name}`);
    return { id: artifact.id, name: artifact.name, created_at: artifact.created_at };
  });
}
