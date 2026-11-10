import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {prGateLanes,catalogDigest} from '../testing/catalog.mjs';
import {runSuite} from '../testing/run.mjs';
import {sourceIdentity,verifyFull,EVIDENCE_PROFILES} from '../testing/receipts.mjs';

export async function runPRGate({cwd=process.cwd(),out=path.join('test-results','pr-gate',String(Date.now())),executeSuite=runSuite,identity=sourceIdentity(cwd)}={}){
 if(!identity.baseRevision)throw Error('PR gate requires an explicit source base revision');
 const lanes=prGateLanes(),receipts=[];
 for(const lane of lanes){
  const receipt=await executeSuite(lane,{cwd,out,profile:EVIDENCE_PROFILES.PR_GATE,attempt:1,priorReceiptDigest:null});receipts.push(receipt);
  if(receipt.status!=='passed')break;
 }
 const result=verifyFull(receipts,identity,{lanes,catalog:catalogDigest(),profile:EVIDENCE_PROFILES.PR_GATE,allowLegacy:false});
 await mkdir(path.resolve(cwd,out),{recursive:true});await writeFile(path.resolve(cwd,out,'pr-gate.json'),JSON.stringify(result,null,2)+'\n');
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 process.env.RIGHELT_TEST_BASE_REVISION??='origin/main';
 const result=await runPRGate();console.log(JSON.stringify(result,null,2));if(result.status!=='passed')process.exitCode=1;
}
