import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {COMPUTER_PROFILES} from '../../packages/shared-types/src/computer-play.ts';
export const publicEvaluationProfiles=()=>({schema:1,
  sourceSha256:createHash('sha256').update(readFileSync(new URL('../../packages/shared-types/src/computer-play.ts',import.meta.url))).digest('hex'),
  profiles:COMPUTER_PROFILES});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.stdout.write(JSON.stringify(publicEvaluationProfiles())+'\n');
