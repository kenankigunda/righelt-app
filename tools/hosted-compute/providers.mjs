import { POLICY, assert } from './policy.mjs';

// Only locally constructed diagnostics cross the controller boundary. Never
// inspect arbitrary error messages, provider bodies, headers, request data or env.
const failures=new WeakMap();
const unknownDiagnostic=Object.freeze({schema:1,provider:'runpod',operation:'unknown',category:'unclassified',dispatch:'unknown',httpStatus:null});
function providerFailure(category,method,dispatch,httpStatus=null){
  const operation=method==='POST'?'create-pod':method==='DELETE'?'delete-pod':'read';
  const error=new Error(`provider ${method} failed${httpStatus===null?'':` (${httpStatus})`}`);
  failures.set(error,Object.freeze({schema:1,provider:'runpod',operation,category,dispatch,httpStatus}));
  return error;
}
export function providerFailureDiagnostic(error){return {...(failures.get(error)??unknownDiagnostic)};}

// Never repeat a create request after an uncertain response. The controller
// persists its launch name first and reconciles by that exact name instead.
export class Providers {
  constructor(env, fetcher = (...args) => fetch(...args)) { this.env = env; this.fetcher = fetcher; }
  async request(provider, path, method = 'GET', body) {
    assert(provider === 'runpod','only Runpod is supported');
    const base = 'https://api.runpod.io/v2', token = this.env.RUNPOD_API_KEY;
    assert(['GET','POST','DELETE'].includes(method),'unsupported provider operation');
    if(!token)throw providerFailure('credentials-unavailable',method,'not-dispatched');
    let options;
    try{options={method,redirect:'manual',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(POLICY.requestMs)};}
    catch{throw providerFailure('request-preparation',method,'not-dispatched');}
    let response;
    try{response=await this.fetcher(`${base}${path}`,options);}
    catch{throw providerFailure('transport',method,'possibly-dispatched');}
    let status,ok;
    try{status=response.status;ok=response.ok;}
    catch{throw providerFailure('response-status',method,'response-received');}
    if(!Number.isInteger(status)||status<100||status>599||typeof ok!=='boolean')throw providerFailure('response-status',method,'response-received');
    if(status===404&&method!=='POST')return null;
    // Do not consume error bodies or copy response headers into diagnostics.
    if(!ok)throw providerFailure('http',method,'response-received',status);
    // A queued-create record is not a Pod. Queued placement is not requested
    // or supported here; an unexpected accepted response stays uncertain.
    const expected=method==='POST'?201:method==='DELETE'?204:200;
    if(status!==expected)throw providerFailure('unexpected-status',method,'response-received',status);
    if(status===204)return {};
    try{return await response.json();}
    catch{throw providerFailure('response-json',method,'response-received',status);}
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
    const resource=await this.request('runpod', '/pods', 'POST', {
      name, image:host.image, gpu:{id:host.gpu,count:1,minRamPerGpu:host.minRamGb,minVcpuCountPerGpu:host.minVcpu,minCudaVersion:host.minCudaVersion},
      dataCenterIds:[host.dataCenterId], disk:host.diskGb, cloud:'SECURE', env:workerEnv,
      entrypoint:['node','tools/hosted-compute/worker.mjs'],cmd:[],ports:[],
    });
    if(typeof resource?.id!=='string'||!resource.id||resource.name!==name)throw providerFailure('response-identity','POST','response-received',201);
    return resource;
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
