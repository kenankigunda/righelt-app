// Pure schema plus explicit metadata admission. No app, browser or model imports.
import assert from 'node:assert/strict';
import {readFile, realpath, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export const ROOT = '01a1700a-2523-71b3-963d-048e1eb4dd9b';
export const OLD = Object.freeze({sourceRevision:'026ac52cb35dbe104f9d5324b3bd1a4245d50dab',tree:'eae2fdbca3955c914508a3840852607c02b331fe',modelId:'initial-1554',assetSha256:'748fcc5e7346900ead62a241002c50ca1012ef8857c73c3eb71e308b955d0490'});
export const sha = value => createHash('sha256').update(value).digest('hex');
const digest = (value,length=64) => typeof value==='string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value) && !/^0+$/.test(value);
export const containsPath = (root,file) => {const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const absolute = value => typeof value==='string' && path.isAbsolute(value);
const keys = (value,expected) => assert.deepEqual(Object.keys(value??{}).sort(),[...expected].sort());
const reference = value => {keys(value,['path','sha256']);assert.ok(absolute(value.path)&&digest(value.sha256),'Exact immutable reference required');};
export function validateManifest(m) {
 keys(m,['version','kind','old','prospective','origin','output','authorization','trainingClosure','numericProof','numericModel','roundStatePath','guardian','dependencies','playwrightEntry','browserExecutable','phaseDeadline']);
 assert.equal(m.version,1);assert.equal(m.kind,'local-computer-cross-version-retention-v1');
 for(const key of ['old','prospective']) {
  const v=m[key];keys(v,['checkout','sourceRevision','tree','modelId','assetPath','assetSha256']);
  assert.ok(absolute(v.checkout)&&absolute(v.assetPath));assert.ok(digest(v.sourceRevision,40)&&digest(v.tree,40));
  assert.match(v.modelId,/^[a-z0-9][a-z0-9_-]{1,127}$/);assert.ok(!/^(tbd|todo|placeholder|changeme|new-model|candidate)$/i.test(v.modelId));
  assert.ok(digest(v.assetSha256));assert.ok(containsPath(v.checkout,v.assetPath),'Asset must be contained in its source checkout');
 }
 for(const [key,value] of Object.entries(OLD))assert.equal(m.old[key],value,`Old ${key} must be actual026/1554`);
 assert.notEqual(m.old.checkout,m.prospective.checkout);assert.notEqual(m.old.modelId,m.prospective.modelId);assert.notEqual(m.old.assetSha256,m.prospective.assetSha256);
 assert.equal(m.origin,'https://127.0.0.1:9988');assert.ok(absolute(m.output)&&absolute(m.roundStatePath));
 for(const key of ['authorization','trainingClosure','numericProof','numericModel','dependencies','playwrightEntry','browserExecutable'])reference(m[key]);
 keys(m.guardian,['checkout','sourceRevision']);assert.ok(absolute(m.guardian.checkout)&&digest(m.guardian.sourceRevision,40));
 assert.ok(Number.isFinite(Date.parse(m.phaseDeadline)) && /(?:Z|\+00:00)$/.test(m.phaseDeadline));
 for(const v of [m.old,m.prospective])assert.ok(m.output!==v.checkout&&!containsPath(v.checkout,m.output)&&!containsPath(m.output,v.checkout),'Private proof and product checkouts must be disjoint');
 return m;
}
export function assertNumericApp(numeric,prospective) {
 assert.ok(numeric.app&&typeof numeric.app==='object','Numeric proof lacks its actual app source');
 for(const key of ['checkout','sourceRevision','tree'])assert.equal(numeric.app[key],prospective[key],`Numeric proof app mismatch: ${key}`);
}
export async function readRef(ref) {reference(ref);assert.equal((await lstat(ref.path)).isSymbolicLink(),false);const bytes=await readFile(ref.path);assert.equal(sha(bytes),ref.sha256,'Immutable reference changed');return JSON.parse(bytes);}
export function verifySource(v) {
 const git=(...args)=>execFileSync('git',args,{cwd:v.checkout,encoding:'utf8',timeout:3000}).trim();
 assert.equal(git('rev-parse','HEAD'),v.sourceRevision);assert.equal(git('rev-parse','HEAD^{tree}'),v.tree);assert.equal(git('status','--porcelain'),'','Source must remain clean');
}
export async function admitManifest(file,expectedSha,{now=Date.now()}={}) {
 assert.ok(absolute(file)&&digest(expectedSha));const raw=await readFile(file);assert.equal(sha(raw),expectedSha);const m=validateManifest(JSON.parse(raw));
 for(const v of [m.old,m.prospective]){assert.equal(await realpath(v.checkout),v.checkout);verifySource(v);assert.equal(sha(await readFile(v.assetPath)),v.assetSha256);}
 const authorization=await readRef(m.authorization),closure=await readRef(m.trainingClosure),numeric=await readRef(m.numericProof);
 assert.equal(authorization.kind,'root-computer-retention-authorization-v1');assert.equal(authorization.issuer,ROOT);assert.equal(authorization.active,true);
 for(const key of ['old','prospective','origin','output','trainingClosure','numericProof','numericModel','roundStatePath','phaseDeadline','guardian','dependencies','playwrightEntry','browserExecutable'])assert.deepEqual(authorization[key],m[key],`Root authorization differs: ${key}`);
 assert.ok(Date.parse(authorization.recordedAt)<=now&&now<Date.parse(authorization.expiresAt)&&Date.parse(m.phaseDeadline)<=Date.parse(authorization.expiresAt));
 assert.equal(closure.recordedBy,ROOT);assert.equal(closure.kind,'followup-training-closed-v1');assert.equal(closure.noFurtherTraining,true);assert.equal(closure.cleanupVerified,true);
 const state=JSON.parse(await readFile(m.roundStatePath,'utf8')).followupTraining;assert.deepEqual(state.trainingClosure,m.trainingClosure,'Actual root closure must be recorded');
 assert.ok(now>=Date.parse(closure.recordedAt)&&now<Date.parse(m.phaseDeadline)&&Date.parse(m.phaseDeadline)<=Date.parse(closure.deadline));
 assertNumericApp(numeric,m.prospective);assert.equal(numeric.kind,'followup-current-app-correctness-result-v1');assert.equal(numeric.numericPassed,true);assert.equal(numeric.complete,true);assert.equal(numeric.phase,'numeric');assert.deepEqual(numeric.candidate,closure.checkpoint);assert.deepEqual(numeric.trainingClosure,m.trainingClosure);
 assert.equal(m.numericModel.sha256,m.prospective.assetSha256);assert.equal(sha(await readFile(m.numericModel.path)),m.numericModel.sha256);
 const relative=path.relative(path.dirname(m.numericProof.path),m.numericModel.path);assert.ok(containsPath(path.dirname(m.numericProof.path),m.numericModel.path),'Selected ONNX must be the numeric proof artifact');
 assert.equal(numeric.artifacts[relative],m.prospective.assetSha256);
 verifySource({...m.guardian,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:m.guardian.checkout,encoding:'utf8'}).trim()});
 return {manifest:m,manifestSha256:expectedSha,authorization,closure};
}
