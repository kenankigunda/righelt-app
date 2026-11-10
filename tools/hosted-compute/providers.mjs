import { POLICY, assert } from './policy.mjs';

// Never repeat a create request after an uncertain response. The controller
// persists its launch name first and reconciles by that exact name instead.
export class Providers {
  constructor(env, fetcher = (...args) => fetch(...args)) { this.env = env; this.fetcher = fetcher; }
  async request(provider, path, method = 'GET', body) {
    const runpod = provider === 'runpod';
    const base = runpod ? 'https://api.runpod.io/v2' : 'https://api.hetzner.cloud/v1';
    const token = this.env[runpod ? 'RUNPOD_API_KEY' : 'HETZNER_API_TOKEN'];
    assert(token, 'provider credentials unavailable');
    const response = await this.fetcher(`${base}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(POLICY.requestMs),
    });
    if (response.status === 404 && method !== 'POST') return null;
    // Provider error bodies may contain bootstrap credentials. Never surface them.
    assert(response.ok, `provider ${method} failed (${response.status})`);
    if (response.status === 204) return {};
    return response.json();
  }
  async list(provider) {
    let path = provider === 'runpod' ? '/pods?limit=100' : '/servers?per_page=50';
    const all = [], visited = new Set();
    while (path) {
      assert(!visited.has(path) && visited.size < 100, 'provider pagination incomplete'); visited.add(path);
      const data = await this.request(provider, path);
      const records = data?.[provider === 'runpod' ? 'pods' : 'servers'];
      assert(Array.isArray(records), 'provider inventory unavailable'); all.push(...records);
      if (provider === 'runpod') {
        assert(data.pagination && typeof data.pagination.hasNextPage === 'boolean', 'provider pagination missing');
        assert(!data.pagination.hasNextPage || data.pagination.nextCursor, 'provider cursor missing');
        path = data.pagination.hasNextPage ? `/pods?limit=100&cursor=${encodeURIComponent(data.pagination.nextCursor)}` : null;
      } else {
        assert(data.meta?.pagination, 'provider pagination missing');
        path = data.meta.pagination.next_page ? `/servers?per_page=50&page=${data.meta.pagination.next_page}` : null;
      }
    }
    return all;
  }
  async find(provider, name) { return (await this.list(provider)).filter(r => r.name === name); }
  async create(host, name, workerEnv) {
    if (host.provider === 'runpod') {
      return this.request('runpod', '/pods', 'POST', {
        name, image: host.image, gpu: { id: host.gpu, count: 1, minRamPerGpu: host.minRamGb, minVcpuCountPerGpu: host.minVcpu },
        disk: host.diskGb, cloud: 'SECURE', env: workerEnv,
        entrypoint: ['node', 'tools/hosted-compute/worker.mjs'], cmd: [], ports: [],
      });
    }
    // Only generated identifiers and JSON strings reach this shell bootstrap.
    // No user command or secret is interpolated into executable shell text.
    assert(Object.values(workerEnv).every(v => typeof v === 'string' && !/[\r\n]/.test(v)), 'invalid bootstrap environment');
    const cloudInit = '#cloud-config\n' + JSON.stringify({
      packages: ['docker.io', 'python3'],
      write_files: [
        { path: '/root/compute-env.json', permissions: '0600', content: JSON.stringify(workerEnv) },
        { path: '/root/compute-env.py', permissions: '0600', content: "import json, os\nwith open('/root/compute.env', 'w') as f:\n    f.write('\\n'.join(k+'='+v for k,v in json.load(open('/root/compute-env.json')).items()))\nos.chmod('/root/compute.env', 0o600)\n" },
      ],
      runcmd: [ ['python3', '/root/compute-env.py'], ['docker', 'run', '--name', 'righelt-compute', '--network', 'host', '--env-file', '/root/compute.env', host.image, 'node', 'tools/hosted-compute/worker.mjs'] ],
    });
    const result = await this.request('hetzner', '/servers', 'POST', {
      name, server_type: host.serverType, location: host.location, image: 'ubuntu-24.04',
      labels: { 'righelt-compute': 'true' }, user_data: cloudInit,
      public_net: { enable_ipv4: true, enable_ipv6: true },
    });
    assert(result?.server?.id, 'provider create response missing identity');
    return result.server;
  }
  inspect(provider, id) { return this.request(provider, `/${provider === 'runpod' ? 'pods' : 'servers'}/${encodeURIComponent(id)}`); }
  async remove(provider, id, expectedName) {
    const raw = await this.inspect(provider, id);
    if (!raw) return;
    const record = provider === 'hetzner' ? raw.server : raw;
    assert(record?.name === expectedName, 'refusing cleanup of unrelated resource');
    await this.request(provider, `/${provider === 'runpod' ? 'pods' : 'servers'}/${encodeURIComponent(id)}`, 'DELETE');
    // Confirmation happens on the next reconciliation, including async deletes.
  }
}
