import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {initialize,resolve} from './test-import-hook.mjs';
const candidate=process.env.RIGHELT_DIAGNOSTIC_CANDIDATE;
if(!candidate||!path.isAbsolute(candidate))throw Error('Explicit diagnostic candidate required');
initialize({candidateRoot:pathToFileURL(path.join(candidate,'e2e')+path.sep).href,fixtureURL:new URL('./test-fixture.mjs',import.meta.url).href});
registerHooks({resolve});
