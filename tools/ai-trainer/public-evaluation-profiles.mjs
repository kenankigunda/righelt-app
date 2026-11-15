import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {COMPUTER_PROFILES} from '../../packages/shared-types/src/computer-play.ts';
import {SEARCH_POLICY_VERSION} from '../../packages/computer-player/src/index.ts';
export const publicEvaluationProfiles=()=>({schema:1,
  sourceSha256:createHash('sha256').update(readFileSync(new URL('../../packages/shared-types/src/computer-play.ts',import.meta.url))).digest('hex'),
  searchSourceSha256:createHash('sha256').update(readFileSync(new URL('../../packages/computer-player/src/search.ts',import.meta.url))).digest('hex'),
  searchPolicyVersion:SEARCH_POLICY_VERSION,
  profiles:COMPUTER_PROFILES});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.stdout.write(JSON.stringify(publicEvaluationProfiles())+'\n');
