import { POLICY, assert } from './policy.mjs';

// Never repeat a create request after an uncertain response. The controller
// persists its launch name first and reconciles by that exact name instead.
export class Providers {
  constructor(env, fetcher = (...args) => fetch(...args)) { this.env = env; this.fetcher = fetcher; }
  async request(provider, path, method = 'GET', body) {
    assert(provider === 'runpod','only Runpod is supported');
    const base = 'https://api.runpod.io/v2', token = this.env.RUNPOD_API_KEY;
    assert(token, 'provider credentials unavailable');
    const response = await this.fetcher(`${base}${path}`, {
      method, redirect:'manual', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(POLICY.requestMs),
    });
    if (response.status === 404 && method !== 'POST') return null;
    // Provider error bodies may contain bootstrap credentials. Never surface them.
    assert(response.ok, `provider ${method} failed (${response.status})`);
    if (response.status === 204) return {};
    return response.json();
  }
  async list(provider) {
    assert(provider==='runpod','only Runpod is supported');
    let path = '/pods?limit=100';
    const all = [], visited = new Set();
    while (path) {
      assert(!visited.has(path) && visited.size < 100, 'provider pagination incomplete'); visited.add(path);
      const data = await this.request(provider, path);
      const records = data?.pods;
      assert(Array.isArray(records), 'provider inventory unavailable'); all.push(...records);
      assert(data.pagination && typeof data.pagination.hasNextPage === 'boolean', 'provider pagination missing');
      assert(!data.pagination.hasNextPage || data.pagination.nextCursor, 'provider cursor missing');
      path = data.pagination.hasNextPage ? `/pods?limit=100&cursor=${encodeURIComponent(data.pagination.nextCursor)}` : null;
    }
    return all;
  }
  async find(provider, name) { return (await this.list(provider)).filter(r => r.name === name); }
  async create(host, name, workerEnv) {
    assert(host.provider==='runpod','only Runpod is supported');
    return this.request('runpod', '/pods', 'POST', {
      name, image:host.image, gpu:{id:host.gpu,count:1,minRamPerGpu:host.minRamGb,minVcpuCountPerGpu:host.minVcpu,minCudaVersion:host.minCudaVersion},
      dataCenterIds:[host.dataCenterId], disk:host.diskGb, cloud:'SECURE', env:workerEnv,
      entrypoint:['node','tools/hosted-compute/worker.mjs'],cmd:[],ports:[],
    });
  }
  inspect(provider,id) {return this.request(provider,`/pods/${encodeURIComponent(id)}`);}
  qualify(record,host,name) {
    const actualCuda=/^\d+\.\d+$/.test(record?.cudaVersion??'')?record.cudaVersion.split('.').map(Number):[];
    const requiredCuda=host.minCudaVersion?.split('.').map(Number)??[];
    const cudaCompatible=actualCuda.length===2 && requiredCuda.length===2 && (actualCuda[0]>requiredCuda[0] || actualCuda[0]===requiredCuda[0] && actualCuda[1]>=requiredCuda[1]);
    assert(record?.name===name && record.image===host.image && record.dataCenterId===host.dataCenterId && record.cloud==='SECURE' &&
      cudaCompatible &&
      record.gpu?.id===host.gpu && record.gpu.count===1 && record.gpu.vcpuCount>=host.minVcpu && record.gpu.memory>=host.minRamGb && record.disk>=host.diskGb &&
      Number.isFinite(record.cost) && record.cost>0 && Math.ceil(record.cost*100)<=host.hourlyCents,
      'actual Runpod placement, hardware or price differs from approved quote');
    return {id:record.id,dataCenterId:record.dataCenterId,image:record.image,gpu:record.gpu,disk:record.disk,cloud:record.cloud,cost:record.cost,cudaVersion:record.cudaVersion};
  }
  async remove(provider, id, expectedName) {
    const raw = await this.inspect(provider, id);
    if (!raw) return;
    const record = raw;
    assert(record?.name === expectedName, 'refusing cleanup of unrelated resource');
    await this.request(provider, `/pods/${encodeURIComponent(id)}`, 'DELETE');
    // Confirmation happens on the next reconciliation, including async deletes.
  }
}
