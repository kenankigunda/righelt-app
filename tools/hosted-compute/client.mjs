import { POLICY, assert, sha256 } from './policy.mjs';
export class InfrastructureError extends Error {}
export class Client {
  constructor({ url, token, id, generation, fetcher = (...args) => fetch(...args), clock=Date.now, deadline=()=>Infinity }) {
    assert(new URL(url).protocol === 'https:' || new URL(url).hostname === '127.0.0.1', 'controller requires HTTPS');
    assert(token && id, 'controller credentials and campaign required');
    Object.assign(this, { url: url.replace(/\/$/, ''), token, id, generation, fetcher,clock,deadline });
  }
  async request(action, method = 'GET', body, binary = false) {
    if(this.clock()>=this.deadline())throw new InfrastructureError('controller authority deadline expired');
    const headers = { authorization: `Bearer ${this.token}` };
    if (this.generation) headers['x-compute-generation'] = String(this.generation);
    if (binary) headers['content-length'] = String(body.byteLength);
    else if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try { response = await this.fetcher(`${this.url}/v1/${this.id}/${action}`, {
      method, headers, body: binary ? body : body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1,Math.floor(Math.min(POLICY.requestMs,this.deadline()-this.clock())))),
    }); } catch { throw new InfrastructureError('controller transport unavailable'); }
    // Keep remote errors categorical. Never log request headers or provider bodies.
    if (response.status === 429 || response.status >= 500) throw new InfrastructureError(`controller unavailable (${response.status})`);
    assert(response.ok, `controller ${action.split('/')[0]} rejected (${response.status})`);
    return response;
  }
  async readJSON(response) {
    try { return await response.json(); } catch(error) { assert(!(error instanceof SyntaxError),'controller response malformed');throw new InfrastructureError('controller response stream interrupted'); }
  }
  async json(action, body) {
    const safe=body===undefined||this.generation&&(['heartbeat','progress','settle','seal-endpoint','snapshot'].includes(action)||action==='claim'&&body?.allowCreate===false);
    const until=Math.min(this.clock()+120000,this.deadline());
    for(let attempt=0;attempt<3;attempt++){
      if(this.clock()>=until)throw new InfrastructureError('controller operation deadline expired');
      try{return await this.readJSON(await this.request(action,body===undefined?'GET':'POST',body));}
      catch(error){if(!safe||attempt===2||!(error instanceof InfrastructureError))throw error;}
    }
  }
  async upload(bytes) {
    const hash=await sha256(bytes);
    if(this.knownObjects?.has(hash)){
      const known=this.knownObjects.get(hash);assert(known.bytes===bytes.byteLength,'known object byte identity differs');return known;
    }
    const until=Math.min(this.clock()+120000,this.deadline());
    for(let attempt=0;attempt<3;attempt++){
      if(this.clock()>=until)throw new InfrastructureError('artifact upload deadline expired');
      try{const a=await this.readJSON(await this.request(`objects/${hash}`,'PUT',bytes,true));assert(a.sha256===hash&&a.bytes===bytes.byteLength,'upload verification failed');this.knownObjects?.set(hash,a);return a;}
      catch(error){if(attempt===2||!(error instanceof InfrastructureError))throw error;}
    }
  }
  rememberObjects(objects){this.knownObjects??=new Map();for(const a of objects)this.knownObjects.set(a.sha256,a);}
  async download(a) {
    const until=Math.min(this.clock()+120000,this.deadline());
    for(let attempt=0;attempt<3;attempt++){
      if(this.clock()>=until)throw new InfrastructureError('artifact download deadline expired');
      try{
        const response=await this.request(`objects/${a.sha256}`);let bytes;
        try{bytes=new Uint8Array(await response.arrayBuffer());}catch{throw new InfrastructureError('artifact response stream interrupted');}
        assert(bytes.length===a.bytes&&await sha256(bytes)===a.sha256,'download verification failed');return bytes;
      }catch(error){if(attempt===2||!(error instanceof InfrastructureError))throw error;}
    }
  }
}
