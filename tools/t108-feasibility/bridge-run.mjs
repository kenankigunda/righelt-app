import {writeFile} from 'node:fs/promises';
import {runProbe} from './runner.mjs';
import {evaluate} from './core.mjs';
const output=process.argv[2];
if (!output) throw new Error('Usage: node bridge-run.mjs OUTPUT.json');
// Start bridge-wrangler.toml first. Its only service binding is remote=true.
const report=await runProbe((path,init)=>fetch('http://127.0.0.1:8798'+path,{...init,redirect:'error',signal:AbortSignal.timeout(30000)}),'deployed');
report.transport='Loopback Wrangler bridge with remote service binding to deployed private Workers';
report.gate=evaluate(report);
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({runId:report.runId,gate:report.gate}));
if (!report.gate.passed) process.exitCode=1;
