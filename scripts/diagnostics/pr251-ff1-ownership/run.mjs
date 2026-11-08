import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {additiveReporterCLI} from './reporter-selection.mjs';
import {resolveCandidatePlaywright} from './candidate-playwright.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),expected=JSON.parse(fs.readFileSync(path.join(here,'expected-inventory.json'),'utf8'));
const candidate=path.resolve(process.env.RIGHELT_DIAGNOSTIC_CANDIDATE??''),tools=path.resolve(process.env.RIGHELT_DIAGNOSTIC_TOOLS??''),out=path.resolve(process.env.RIGHELT_DIAGNOSTIC_OUT??'');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const git=(args,cwd=candidate)=>execFileSync('git',args,{cwd,encoding:'utf8',timeout:10000}).trim();
requireValue(process.platform==='linux'&&process.arch==='x64'&&process.version==='v22.23.4','Exact original Linux runtime required');
requireValue(process.env.CI&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted','Original Firefox CI audio environment required');
requireValue(candidate!==tools&&out!==candidate&&!out.startsWith(candidate+path.sep)&&process.env.RIGHELT_DIAGNOSTIC_GRANT,'Separate exact candidate/tools/output/grant required');
const freeze=json(path.join(here,'source-freeze.json')),grant=json(process.env.RIGHELT_DIAGNOSTIC_GRANT);
requireValue(grant.execute===true&&grant.diagnosticOnly===true&&grant.fullOriginalFF1Shard===true,'No reviewed diagnostic grant');
requireValue(grant.sourceFreezeSHA256===hash(fs.readFileSync(path.join(here,'source-freeze.json'))),'Diagnostic freeze changed');
for(const[file,digest]of Object.entries(freeze.files))requireValue(hash(fs.readFileSync(path.resolve(here,file)))===digest,'Diagnostic source changed:'+file);
requireValue(git(['rev-parse','HEAD'])===expected.productHead&&git(['status','--porcelain'])==='','Original clean2f2 candidate required');
requireValue(git(['rev-parse','HEAD'],tools)==='0c7b51b64c26604f1e08939e827cb4a934aa4f93'&&git(['status','--porcelain'],tools)==='','Released0c tools required');
requireValue(execFileSync('pnpm',['--version'],{cwd:candidate,encoding:'utf8'}).trim()==='9.15.9','Original pnpm required');
requireValue(!fs.existsSync(out),'Fresh diagnostic output required');fs.mkdirSync(out,{mode:0o700});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const {sourceIdentity,digest}=await import(pathToFileURL(path.join(candidate,'scripts/testing/receipts.mjs')));
for(const[file,digestValue]of Object.entries(freeze.candidateFiles))requireValue(hash(fs.readFileSync(path.join(candidate,file)))===digestValue,'Candidate source closure changed:'+file);
const before=sourceIdentity(candidate);write('source-before.json',before);
requireValue(before.sourceFingerprint===expected.sourceFingerprint&&before.testedTree===expected.productTree&&before.sourceClean,'Original source fingerprint required');
const own=resolveCandidatePlaywright(candidate),firefox=own.original.firefox,executable=firefox.executablePath();
const rawLock=fs.readFileSync(path.join(candidate,'pnpm-lock.yaml')),installed=fs.readFileSync(path.join(candidate,'node_modules/.pnpm/lock.yaml'));
requireValue(digest(rawLock)==='341b60501f75b87b0e84d393c0a09828e9a0ca6e964acdd9fc959352920d5436'&&digest(installed)==='c915e9421b37eb675521395a7eef58fd3faeb8fe8ff754d79bffe7daa7c5f1ed','Original dependency receipt contract required');
write('runtime.json',{node:process.version,pnpm:'9.15.9',playwright:'1.59.1',platform:process.platform,arch:process.arch,release:os.release(),image:{ImageOS:process.env.ImageOS??null,ImageVersion:process.env.ImageVersion??null},dependencyProvenance:own.provenance,
 lock:{rawByteSHA256:hash(rawLock),receiptBufferDigest:digest(rawLock)},installedLock:{rawByteSHA256:hash(installed),receiptBufferDigest:digest(installed)},
 firefox:{executable,sha256:hash(fs.readFileSync(executable)),launch:'Original config/default engine, no browser launch or preference override by observer'},nodeOptions:{present:Object.hasOwn(process.env,'NODE_OPTIONS'),value:process.env.NODE_OPTIONS??null,changed:false,historicalOriginalValue:'Not asserted from workflow-source absence'}});
const lane={suite:'e2e',project:'firefox',shard:1,shards:2},dir=path.join(candidate,'test-results/suites/e2e-firefox-1-2');
const junitFile=path.join(dir,'results.xml'),observations=path.join(dir,'observations.json');
const envFields={CI:process.env.CI,RIGHELT_TEST_OBSERVATIONS:process.env.RIGHELT_TEST_OBSERVATIONS,PLAYWRIGHT_JUNIT_OUTPUT_FILE:process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE};
Object.assign(process.env,{CI:process.env.CI,RIGHELT_TEST_OBSERVATIONS:observations,PLAYWRIGHT_JUNIT_OUTPUT_FILE:junitFile});
const config=(await import(pathToFileURL(path.join(candidate,'playwright.config.mjs')))).default;
for(const[key,value]of Object.entries(envFields)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
requireValue(config.workers===1&&config.fullyParallel===false&&config.timeout===60000&&config.expect.timeout===10000&&(config.retries??0)===0&&(config.repeatEach??1)===1,'Original budgets/selection config changed');
const filter=additiveReporterCLI(config.reporter,{candidate,junitFile,observer:path.join(here,'inline-ownership-reporter.mjs')});
process.env.RIGHELT_INLINE_OWNERSHIP_OUT=path.join(out,'inline-attachments');
write('method.json',{lane,originalRunSuite:path.join(candidate,'scripts/testing/run.mjs'),originalWrapper:path.join(candidate,'scripts/playwright-e2e.mjs'),originalConfig:path.join(candidate,'playwright.config.mjs'),originalReporters:config.reporter,
 soleNativeArgumentAddition:filter,bodyTimeout:60000,expectTimeout:10000,workers:1,retries:0,trace:config.use.trace,screenshot:config.use.screenshot,
 noFixtureImportHook:true,noNodeOptionsHook:true,noAppMutation:true,noPageActionAdded:true,diagnosticOnly:true});
let receipt=null,primary=null;const secondary=[];
try{
 const {runSuite}=await import(pathToFileURL(path.join(candidate,'scripts/testing/run.mjs')));
 receipt=await runSuite(lane,{cwd:candidate,filters:[filter]});write('original-suite-receipt-copy.json',receipt);
}catch(error){primary={message:error.message,stack:error.stack};}
finally{
 const after=sourceIdentity(candidate);write('source-after.json',after);
 if(after.sourceFingerprint!==before.sourceFingerprint||!after.sourceClean)secondary.push('Source changed');
 try{fs.cpSync(path.join(candidate,'test-results'),path.join(out,'original-test-results'),{recursive:true,errorOnExist:true,force:false});}catch(error){secondary.push('Original output copy:'+error.message);}
}
let observer=null;
try{observer=json(path.join(out,'inline-attachments/manifest.json'));}catch(error){secondary.push('Observer manifest missing:'+error.message);}
const nativePassed=receipt?.status==='passed'&&receipt.exitCode===0&&!receipt.incomplete;
const captureComplete=Boolean(observer?.observerComplete&&observer.globalErrors.length===0),keyboardProved=observer?.keyboardProved===true;
write('diagnostic-result.json',{diagnosticOnly:true,primary,secondary,nativePassed,captureComplete,keyboardProved,originalNativeStatus:receipt?.status??null,
 accepted:false,reason:'No official CI/import credit. Required real keyboard evidence must be positively present; original conditional bypass is not repaired by extra actions.'});
// Preserve original post-shard storage execution eligibility independently of observer success.
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'native_passed='+String(nativePassed)+'\n');
if(primary||secondary.length||!nativePassed||!captureComplete||!keyboardProved)process.exitCode=1;
