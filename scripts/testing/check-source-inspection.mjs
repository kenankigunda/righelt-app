import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkPolicy} from './source-inspection.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const policy=JSON.parse(readFileSync(path.join(root,'scripts/testing/source-inspection-allowlist.json'),'utf8'));
const problems=checkPolicy(root,policy);
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}
else console.log('Source inspection policy passed');
