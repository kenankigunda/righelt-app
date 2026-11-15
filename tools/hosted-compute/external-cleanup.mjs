import { assert, POLICY } from './policy.mjs';
import { validateReference } from './external-control.mjs';
import { githubUsageReviewRequired } from './github-usage.mjs';

// There is deliberately no create/stop/renew operation. Runpod's underlying
// pods:write credential is broader than this code, not a delete-only grant.
export class RunpodCleanup {
  constructor({token,accountId,fetcher=(...args)=>fetch(...args)}) {
    assert(token && typeof accountId==='string' && accountId.length>=3,'reviewed Runpod cleanup credentials required');
    Object.assign(this,{token,accountId,fetcher});
  }
  async request(path,method='GET') {
    assert((method==='GET' && /^\/pods(?:\?limit=100(?:&cursor=[A-Za-z0-9%_.~-]+)?|\/[A-Za-z0-9%_.~-]+)?$/.test(path)) || (method==='DELETE' && /^\/pods\/[A-Za-z0-9%_.~-]+$/.test(path)), 'cleanup permits only fixed Runpod inventory and termination');
    const response=await this.fetcher(`https://api.runpod.io/v2${path}`,{method,redirect:'error',signal:AbortSignal.timeout(POLICY.requestMs),headers:{authorization:`Bearer ${this.token}`,accept:'application/json'}});
    if(response.status===404) return null;
    assert(response.ok && (method!=='DELETE' || response.status===204),`Runpod cleanup ${method} failed (${response.status})`);
    return response.status===204 ? {} : response.json();
  }
  inspect(id) { assert(typeof id==='string' && /^[A-Za-z0-9_-]+$/.test(id),'invalid Runpod identity'); return this.request(`/pods/${encodeURIComponent(id)}`); }
  async list() {
    const records=[],seen=new Set(); let path='/pods?limit=100';
    while(path) {
      assert(!seen.has(path) && seen.size<100,'Runpod inventory pagination incomplete'); seen.add(path);
      const data=await this.request(path);
      assert(Array.isArray(data?.pods) && typeof data.pagination?.hasNextPage==='boolean','Runpod inventory unavailable');
      for(const pod of data.pods) assert(typeof pod?.id==='string' && typeof pod.name==='string','Runpod inventory identity missing');
      records.push(...data.pods);
      assert(!data.pagination.hasNextPage || typeof data.pagination.nextCursor==='string' && data.pagination.nextCursor.length>0 && data.pagination.nextCursor.length<2048,'Runpod inventory cursor missing');
      const cursor=data.pagination.hasNextPage ? encodeURIComponent(data.pagination.nextCursor).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`) : null;
      path=cursor ? `/pods?limit=100&cursor=${cursor}` : null;
    }
    assert(new Set(records.map(x=>x.id)).size===records.length,'Runpod inventory repeats identities');
    return records;
  }
  async terminate(id,name) {
    const current=await this.inspect(id);
    if(!current) return {id,name,absent:true};
    assert(current.id===id && current.name===name,'refusing unrelated Runpod termination');
    await this.request(`/pods/${encodeURIComponent(id)}`,'DELETE');
    return {id,name,absent:await this.inspect(id)===null};
  }
}

export async function sweepExternal({store,reference,provider,clock=Date.now,workflowRevision}) {
  const record=await store.readPrearm(reference); await validateReference(reference,record);
  assert(provider.accountId===record.accountId && workflowRevision===record.workflowRevision,'cleanup account or pinned runtime differs');
  const now=clock();
  assert(Number.isSafeInteger(now) && now>=record.createdAt,'cleanup clock unavailable or predates prearm');
  const usageReviewRequired=githubUsageReviewRequired(record.githubUsage,now);
  if(now<record.cutoff) return {schema:1,state:'waiting',cutoff:record.cutoff,armed:true,usageReviewRequired};
  const names=new Set(record.launches.map(x=>x.name)), deleted=[],failures=[];
  // Publish/read back terminal state when possible. Once the immutable cutoff
  // has passed, that cutoff already fences ALL primary creates. A control-store
  // write outage must not prevent exact, previously authorized Pod cleanup.
  let terminalFenceConfirmed=false;
  try { await store.fence(record,reference,now); terminalFenceConfirmed=true; }
  catch { failures.push({operation:'terminal-fence',reason:'control-write-unavailable'}); }
  let inventory;
  try { inventory=await provider.list(); }
  catch { failures.push({operation:'inventory',reason:'provider-unavailable-or-incomplete'}); }
  if(inventory) {
    for(const pod of inventory.filter(x=>names.has(x.name))) {
      try { deleted.push(await provider.terminate(pod.id,pod.name)); }
      catch { failures.push({operation:'termination',id:pod.id,name:pod.name,reason:'provider-unavailable-or-ownership-changed'}); }
    }
  }
  let remaining=null;
  try { remaining=(await provider.list()).filter(x=>names.has(x.name)).map(({id,name})=>({id,name})); }
  catch { failures.push({operation:'verification',reason:'provider-unavailable-or-incomplete'}); }
  const receipt={schema:1,kind:'external-cleanup-receipt',nonce:record.nonce,prearmSha256:reference.sha256,
    observedAt:now,cutoff:record.cutoff,terminalFenceConfirmed,deleted,remaining,failures,
    cleanupObservedAbsent:remaining!==null && remaining.length===0 && deleted.every(x=>x.absent) && failures.every(x=>x.operation==='terminal-fence'),
    // An empty inventory cannot rule out an in-flight/lost create or arbitrarily
    // late provider visibility. Only an operator resolution may disarm the job.
    armed:true,requiresOperatorResolution:true,billingReconciliationRequired:true,usageReviewRequired};
  try { await store.receipt(record,receipt); return {...receipt,durableReceiptConfirmed:true}; }
  catch { return {...receipt,durableReceiptConfirmed:false,failures:[...failures,{operation:'receipt',reason:'control-write-unavailable'}]}; }
}
