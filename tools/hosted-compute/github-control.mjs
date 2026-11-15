import { canonical, encode, sha256, assert, POLICY } from './policy.mjs';
import { controlRepositoryName, noncePattern, prearmPath, fencePath, validatePrearm, validateReference } from './external-control.mjs';
import { verifyGithubUsage } from './github-usage.mjs';

// Contents credentials are repository-scoped. Reader has no write methods.
// Writer's code only appends immutable records. GitHub's underlying contents
// grant is broader, so keep it off the training host and the primary controller.
export class GitHubControlReader {
  constructor({repository,token,branch='main',fetcher=(...args)=>fetch(...args),authentication='bearer'}) {
    assert(controlRepositoryName.test(repository) && (authentication==='bearer' && token || authentication==='keyring') && /^[A-Za-z0-9_.-]+$/.test(branch), 'private control repository credentials required');
    Object.assign(this,{repository,token,branch,fetcher,authentication});
  }
  async request(path,{method='GET',body,missing=false}={}) {
    assert(path.startsWith(`/repos/${this.repository}/`) || path === `/repos/${this.repository}`, 'fixed GitHub repository required');
    const contentsPrefix=`/repos/${this.repository}/contents/`;
    assert(method === 'GET' || this instanceof GitHubControlWriter && method === 'PUT' && path.startsWith(contentsPrefix) && /^control\/(prearms|fences|receipts)\//.test(path.slice(contentsPrefix.length)), 'read-only primary control transport');
    const response = await this.fetcher(`https://api.github.com${path}`, {method,redirect:'manual',signal:AbortSignal.timeout(POLICY.requestMs),
      headers:{...(this.authentication==='bearer'?{authorization:`Bearer ${this.token}`}:{ }),accept:'application/vnd.github+json','user-agent':'righelt-compute-controller','x-github-api-version':'2022-11-28','content-type':'application/json'},
      body:body === undefined ? undefined : JSON.stringify(body)});
    if(response.status === 404 && missing) return null;
    assert(response.ok, `private control ${method} failed (${response.status})`);
    return response.json();
  }
  async privateRepository(fresh=false) {
    if(fresh) this.privateCheck=undefined;
    this.privateCheck ??= this.request(`/repos/${this.repository}`).then(record => {
      assert(record.private === true && record.full_name?.toLowerCase() === this.repository.toLowerCase() && record.default_branch === this.branch, 'control repository must be private on the reviewed default branch');
    }).catch(error=>{this.privateCheck=undefined;throw error;});
    await this.privateCheck;
  }
  async read(path,ref=this.branch) {
    await this.privateRepository();
    assert(/^control\/(prearms|fences|receipts)\/[a-f0-9/-]+(?:\.json)$/.test(path) && (ref === this.branch || /^[a-f0-9]{40}$/.test(ref)), 'invalid control object path or revision');
    const result = await this.request(`/repos/${this.repository}/contents/${path}?ref=${encodeURIComponent(ref)}`,{missing:true});
    if(!result) return null;
    assert(result.type === 'file' && result.encoding === 'base64' && result.size <= 65536 && typeof result.content === 'string', 'bounded control JSON required');
    const bytes = Uint8Array.from(atob(result.content.replaceAll('\n','')), c=>c.charCodeAt(0));
    assert(bytes.length === result.size, 'control JSON length mismatch');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async readPrearm(reference) {
    assert(reference.repository === this.repository, 'external repository mismatch');
    const record = await this.read(reference.path,reference.commit);
    assert(record,'immutable prearm unavailable'); await validateReference(reference,record); return record;
  }
  async readFence(nonce,reference) {
    assert(noncePattern.test(nonce),'invalid fence nonce');
    const fence=await this.read(fencePath(nonce));
    if(fence!==null) return fence;
    // GitHub uses 404 for both absent files and lost private-repository access.
    // A missing fence is usable only with a new positive private/access check
    // and a fresh successful contents read of this exact pinned prearm.
    assert(reference,'missing fence requires bound access verification');
    await this.privateRepository(true);
    const record=await this.readPrearm(reference);
    assert(record.nonce===nonce,'fence verification prearm differs');
    return null;
  }
}
export class GitHubControlWriter extends GitHubControlReader {
  async append(path,record,acceptExisting=old=>canonical(old)===canonical(record)) {
    const prior = await this.read(path);
    if(prior) { assert(acceptExisting(prior),'immutable control record differs'); return {existing:true}; }
    const raw=encode(canonical(record)); assert(raw.length<=65536,'control record too large');
    let result;
    try {
      result=await this.request(`/repos/${this.repository}/contents/${path}`,{method:'PUT',body:{message:'Record hosted compute control evidence',branch:this.branch,content:btoa(String.fromCharCode(...raw))}});
    } catch(error) {
      // A lost commit response is reconciled by exact bytes, never a blind PUT.
      const observed=await this.read(path);
      if(observed && acceptExisting(observed)) return {existing:true};
      throw error;
    }
    assert(/^[a-f0-9]{40}$/.test(result.commit?.sha),'control commit identity missing');
    const observed=await this.read(path,result.commit.sha);
    assert(observed && acceptExisting(observed),'control commit readback differs');
    return {commit:result.commit.sha};
  }
  async prearm(record) {
    validatePrearm(record); assert(record.controlRepository===this.repository,'prearm repository differs');
    await verifyGithubUsage(record.githubUsage,{createdAt:record.createdAt,cutoff:record.cutoff,repository:record.controlRepository});
    const path=prearmPath(record.nonce),result=await this.append(path,record);
    // Retrying an already-created prearm must recover its exact immutable git
    // commit, not bind a moving branch. Git's commit API supplies the path commit.
    const commit=result.commit ?? (await this.request(`/repos/${this.repository}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(this.branch)}&per_page=1`))[0]?.sha;
    const reference={repository:this.repository,commit,path,sha256:await sha256(encode(canonical(record)))};
    await this.readPrearm(reference); return reference;
  }
  async fence(record,reference,now) {
    await validateReference(reference,record);
    const fence={schema:1,kind:'terminal',nonce:record.nonce,prearmSha256:reference.sha256,cutoff:record.cutoff,observedAt:now};
    await this.append(fencePath(record.nonce),fence,old=>old.schema===1 && old.kind==='terminal' && old.nonce===record.nonce && old.prearmSha256===reference.sha256 && old.cutoff===record.cutoff);
    const observed=await this.readFence(record.nonce);
    assert(observed?.kind==='terminal' && observed.prearmSha256===reference.sha256,'terminal fence readback failed');
    return observed;
  }
  async receipt(record,receipt) {
    assert(noncePattern.test(record.nonce),'invalid receipt nonce');
    const suffix=crypto.randomUUID().replaceAll('-','');
    await this.append(`control/receipts/${record.nonce}/${suffix}.json`,receipt);
  }
}
export function primaryControlStore(env,fetcher) {
  return new GitHubControlReader({repository:env.COMPUTE_CONTROL_REPOSITORY,token:env.COMPUTE_CONTROL_READ_TOKEN,branch:env.COMPUTE_CONTROL_BRANCH??'main',fetcher});
}
