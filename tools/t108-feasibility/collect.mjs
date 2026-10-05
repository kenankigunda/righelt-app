import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
// OAuth stays in memory. Only synthetic-resource metrics are written.
const [runPath, output] = process.argv.slice(2);
if (!runPath || !output) throw new Error('Usage: node collect.mjs RUN.json OUTPUT.json');
const run = JSON.parse(await readFile(runPath, 'utf8'));
const {token} = JSON.parse(execFileSync('npx', ['wrangler@latest','auth','token','--json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const account = '8e4ab8325d9b60266b6d5c997beffca2';
const headers = {authorization:`Bearer ${token}`, 'content-type':'application/json'};
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/durable_objects/namespaces`, {headers});
const body = await response.json();
if (!response.ok || !body.success) throw new Error('Namespace read failed');
const resources = body.result.filter(n => ['righelt-t108-hash-engine','righelt-t108-hash-feasibility'].includes(n.script));
if (resources.length !== 2) throw new Error('Expected two isolated namespaces');
// Periodic samples can be emitted after the request window; retain the exact
// filter and collection time rather than claiming an exact per-request peak.
const start = new Date(Date.parse(run.startedAt)-60000).toISOString();
const end = new Date().toISOString();
const filter = `datetime_geq:"${start}",datetime_leq:"${end}",namespaceId_in:${JSON.stringify(resources.map(n=>n.id))}`;
const query = `{viewer{accounts(filter:{accountTag:"${account}"}){
  invocations:durableObjectsInvocationsAdaptiveGroups(limit:100,filter:{${filter}}){dimensions{namespaceId status} sum{requests errors} quantiles{cpuTimeP95}}
  periodic:durableObjectsPeriodicGroups(limit:100,filter:{${filter}}){dimensions{namespaceId} sum{duration exceededCpuErrors exceededMemoryErrors fatalInternalErrors} quantiles{memoryUsageBytesP999}}
}}}`;
const metricsResponse = await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers,body:JSON.stringify({query})});
const metrics = await metricsResponse.json();
await writeFile(output,JSON.stringify({runId:run.runId,retrievedAt:end,resources,query,metrics},null,2)+'\n');
console.log(JSON.stringify(metrics));
if (!metricsResponse.ok || metrics.errors?.length) process.exitCode=1;
