import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { derive, evaluate } from './core.mjs';

export function gatewayOrigin(url) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.hostname !== 'righelt-t108-gateway.kenankigunda.workers.dev' || base.port || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Only the approved isolated gateway origin is allowed');
  return base;
}

export async function runProbe(dispatch, runtime) {
  const report = { schemaVersion: 1, runId: randomUUID(), runtime, startedAt: new Date().toISOString(), vectors: [], sequential: [], burst: [] };
  const expected = Object.fromEntries(['ascii','unicode','long'].map(f => [f, derive(f).toString('hex')]));
  async function operation(fixture) {
    const started = performance.now();
    try {
      const response = await dispatch('/probe', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fixture}) });
      const body = await response.json();
      return { fixture, status:response.status, elapsedMs:performance.now()-started, correct:body.hash === expected[fixture], incorrectRejected:body.incorrectRejected === true, retryAfter:response.headers.get('Retry-After'), workerWallMs:body.elapsedWallMs ?? null };
    } catch (error) { return { fixture, status:0, elapsedMs:performance.now()-started, correct:false, error:error.name }; }
  }
  // The first invocation is recorded separately; provider evidence must establish
  // whether it was actually a cold start rather than assuming it from ordering.
  for (const fixture of ['ascii','unicode','long']) report.vectors.push(await operation(fixture));
  for (let i=0;i<100;i++) report.sequential.push(await operation('ascii'));
  report.burst = await Promise.all(Array.from({length:20}, () => operation('ascii')));
  report.finishedAt = new Date().toISOString();
  return report;
}

export async function main() {
  const [url, output, providerPath] = process.argv.slice(2);
  if (!url || !output || !url.startsWith('https://')) throw new Error('Usage: node runner.mjs https://isolated-gateway OUTPUT.json [PROVIDER.json]');
  if (!process.env.T108_PROBE_TOKEN) throw new Error('T108_PROBE_TOKEN required for isolated gateway');
  const base = gatewayOrigin(url);
  const report = await runProbe((path, init) => fetch(new URL(path, base), { ...init, redirect:'error', signal:AbortSignal.timeout(30000), headers:{...init.headers, Authorization:`Bearer ${process.env.T108_PROBE_TOKEN}`} }), 'deployed');
  const provider = providerPath ? JSON.parse(await readFile(providerPath,'utf8')) : undefined;
  report.gate = evaluate(report, provider);
  await writeFile(output, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({runId:report.runId,gate:report.gate}));
  if (!report.gate.passed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
