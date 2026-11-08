/** A complete single-run inventory, with bounded pagination and no partial-page credit. */
async function completeInventory(api,runId,kind) {
 if(!Number.isSafeInteger(runId)||runId<1)throw Error('Invalid artifact run');
 const artifacts=[],ids=new Set();let total;
 for(let page=1;page<=100;page++) {
  const query=kind==='jobs'?'filter=latest&per_page=100':'per_page=100';
  const result=await api(`actions/runs/${runId}/${kind}?${query}${page===1?'':`&page=${page}`}`);
  const items=result[kind];
  if(!Number.isSafeInteger(result.total_count)||result.total_count<0||!Array.isArray(items)
    ||items.length>100)throw Error('Malformed artifact page');
  if(total===undefined)total=result.total_count;
  if(result.total_count!==total)throw Error('Artifact inventory changed during pagination');
  const remaining=total-artifacts.length;
  if(items.length!==Math.min(100,remaining))throw Error('Incomplete artifact page');
  for(const artifact of items) {
   if(!Number.isSafeInteger(artifact.id)||artifact.id<0||ids.has(artifact.id))throw Error('Duplicate or invalid artifact identity');
   ids.add(artifact.id);artifacts.push(artifact);
  }
  if(artifacts.length===total)return artifacts;
 }
 throw Error('Artifact pagination bound exceeded');
}

export const listRunArtifacts=(api,runId)=>completeInventory(api,runId,'artifacts');
export const listRunJobs=(api,runId)=>completeInventory(api,runId,'jobs');
