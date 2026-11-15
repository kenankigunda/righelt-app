import { POLICY, assert, sha256 } from './policy.mjs';
export class InfrastructureError extends Error {}
export class Client {
  constructor({ url, token, id, generation, fetcher = (...args) => fetch(...args) }) {
    assert(new URL(url).protocol === 'https:' || new URL(url).hostname === '127.0.0.1', 'controller requires HTTPS');
    assert(token && id, 'controller credentials and campaign required');
    Object.assign(this, { url: url.replace(/\/$/, ''), token, id, generation, fetcher });
  }
  async request(action, method = 'GET', body, binary = false) {
    const headers = { authorization: `Bearer ${this.token}` };
    if (this.generation) headers['x-compute-generation'] = String(this.generation);
    if (binary) headers['content-length'] = String(body.byteLength);
    else if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try { response = await this.fetcher(`${this.url}/v1/${this.id}/${action}`, {
      method, headers, body: binary ? body : body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(POLICY.requestMs),
    }); } catch { throw new InfrastructureError('controller transport unavailable'); }
    // Keep remote errors categorical. Never log request headers or provider bodies.
    if (response.status === 429 || response.status >= 500) throw new InfrastructureError(`controller unavailable (${response.status})`);
    assert(response.ok, `controller ${action.split('/')[0]} rejected (${response.status})`);
    return response;
  }
  async readJSON(response) {
    try { return await response.json(); } catch { throw new InfrastructureError('controller response stream interrupted'); }
  }
  async json(action, body) { return this.readJSON(await this.request(action, body === undefined ? 'GET' : 'POST', body)); }
  async upload(bytes) {
    const hash = await sha256(bytes);
    const a = await this.readJSON(await this.request(`objects/${hash}`, 'PUT', bytes, true));
    assert(a.sha256 === hash && a.bytes === bytes.byteLength, 'upload verification failed'); return a;
  }
  async download(a) {
    const response = await this.request(`objects/${a.sha256}`);
    let bytes;
    try { bytes = new Uint8Array(await response.arrayBuffer()); } catch { throw new InfrastructureError('artifact response stream interrupted'); }
    assert(bytes.length === a.bytes && await sha256(bytes) === a.sha256, 'download verification failed'); return bytes;
  }
}
