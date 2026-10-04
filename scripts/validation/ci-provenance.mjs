import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {command,saveJSON} from './io.mjs';
import {evidenceKey} from './reuse.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function collectCIProvenance({cwd=process.cwd(),env=process.env,execute=command}={}){
 const run=async argv=>(await execute(argv,{cwd})).output.trim();
 const checkout=await run(['git','rev-parse','HEAD']),testedTree=await run(['git','rev-parse','HEAD^{tree}']);
 const files=(await run(['git','ls-files'])).split('\n').filter(file=>/(^|\/)(package\.json|\.npmrc|\.?pnpmfile\.cjs)$/.test(file)||/^(pnpm-workspace\.yaml|playwright[^/]*\.mjs)$/.test(file));
 const hashes={};for(const file of files)hashes[file]=digest(await readFile(path.join(cwd,file)));
 const lockHash=digest(await readFile(path.join(cwd,'pnpm-lock.yaml')));
 const installedLockHash=digest(await readFile(path.join(cwd,'node_modules/.pnpm/lock.yaml')));
 const require=createRequire(path.join(cwd,'package.json'));let playwrightVersion=null,browserManifestHash=null;
 let playwrightPackage;try{playwrightPackage=require.resolve('@playwright/test/package.json');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
 if(playwrightPackage){playwrightVersion=JSON.parse(await readFile(playwrightPackage,'utf8')).version;const playwright=require.resolve('playwright/package.json',{paths:[path.dirname(playwrightPackage)]});const core=require.resolve('playwright-core/package.json',{paths:[path.dirname(playwright)]});browserManifestHash=digest(await readFile(path.join(path.dirname(core),'browsers.json')));}
 const result={version:1,repository:env.GITHUB_REPOSITORY,runId:Number(env.GITHUB_RUN_ID),attempt:Number(env.GITHUB_RUN_ATTEMPT),job:env.GITHUB_JOB,checkout,testedTree,dependencies:{lockHash,installedLockHash,manifestHash:evidenceKey(hashes)},runtime:{node:process.version,pnpm:await run(['pnpm','--version']),platform:process.platform,arch:process.arch,playwrightVersion,browserManifestHash}};
 if(!result.repository||!Number.isSafeInteger(result.runId)||!Number.isSafeInteger(result.attempt)||!result.job)throw Error('CI provenance requires GitHub run identity');
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const index=process.argv.indexOf('--out');if(index<0||!process.argv[index+1])throw Error('--out is required');
 await saveJSON(process.argv[index+1],await collectCIProvenance());
}
