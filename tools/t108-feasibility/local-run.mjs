import { writeFile } from 'node:fs/promises';
import { localRuntime } from './local-runtime.mjs';
import { runProbe } from './runner.mjs';
import { evaluate } from './core.mjs';
const output=process.argv[2];
if(!output) throw new Error('Usage: node local-run.mjs OUTPUT.json');
const mf=await localRuntime();
try {
  const report=await runProbe((path,init)=>mf.dispatchFetch(`https://probe.invalid${path}`,init),'local');
  report.gate=evaluate(report);
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({runId:report.runId,sequentialSuccess:report.sequential.filter(r=>r.status===200&&r.correct).length,burstStatuses:report.burst.map(r=>r.status),gate:report.gate}));
  // Successful harness exercise is distinct from the deliberately failing gate.
  if(report.sequential.some(r=>r.status!==200||!r.correct) || report.vectors.some(r=>!r.correct||!r.incorrectRejected) || !report.burst.some(r=>r.status===429)) process.exitCode=1;
} finally {await mf.dispose();}
