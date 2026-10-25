import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {archiveConfig,archiveDeploymentConfig,archiveSettings} from './storage-archive-config.mjs';
const source=readFileSync(new URL('../apps/api/wrangler.toml',import.meta.url),'utf8');
const game='game-'+'a'.repeat(32);
test('archive modes select safe schedules, guards and a single canary',()=>{
 for(const [mode,crons,archives,guards] of [['disabled',[],false,false],['canary',['* * * * *'],true,true],['active',['0 */6 * * *'],true,true],['drain',['0 */6 * * *'],false,true]]){
  const settings=archiveSettings(mode,mode==='canary'?game:'');assert.deepEqual(settings.crons,crons);assert.equal(settings.archives,archives);assert.equal(settings.guards,guards);
  const result=archiveConfig(source,'righelt-archives',{mode,canaryGameId:mode==='canary'?game:''});
  assert.equal((result.match(/\[\[r2_buckets\]\]/g)||[]).length,1);assert.equal((result.match(/\[triggers\]/g)||[]).length,1);
  assert.match(result,/database_id = "4ce7cf1e-627e-427d-99c8-438f34d51aeb"/);
 }
 assert.throws(()=>archiveSettings('unknown'),/mode/);assert.throws(()=>archiveSettings('canary'),/Canary/);assert.throws(()=>archiveSettings('active',game),/Canary/);
 assert.throws(()=>archiveConfig(source,'wrong-bucket'),/reconciliation/);
});
test('deployment rejects changed resources and unsafe rollback after activation',()=>{
 assert.match(archiveDeploymentConfig({},source),/STORAGE_ARCHIVE_MODE = "disabled"/);
 for(const text of [source.replace('righelt-archives','other-bucket'),source.replace('righelt-db-prod','wrong-db'),source.replace('4ce7cf1e','12345678')])assert.throws(()=>archiveDeploymentConfig({},text),/resources/);
 assert.throws(()=>archiveDeploymentConfig({RIGHELT_STORAGE_ARCHIVE_ACTIVATED:'true'},source),/Activated/);
 assert.match(archiveDeploymentConfig({RIGHELT_STORAGE_ARCHIVE_ACTIVATED:'true',RIGHELT_STORAGE_ARCHIVE_MODE:'drain'},source),/STORAGE_BUDGET_ENABLED = "true"/);
});

test('deployment pins generation, revision and migration target',async()=>{
 const {validateStorageDeployment}=await import('./deploy-account-services.mjs');
 const env={DEPLOY_SHA:'a'.repeat(40),RIGHELT_STORAGE_GENERATION:'reset-986736d3-c72e-4539-9edc-6597847f64e7',RIGHELT_STORAGE_COMPRESSION:'true'};
 validateStorageDeployment(env,source);
 for(const change of [{DEPLOY_SHA:''},{RIGHELT_STORAGE_GENERATION:'reset-other'},{CLOUDFLARE_D1_DB_NAME:'old-db'},{RIGHELT_STORAGE_COMPRESSION:'invalid'}])assert.throws(()=>validateStorageDeployment({...env,...change},source));
});

test('large-state writers require a prior reader revision and compression',async()=>{
 const {validateStorageDeployment}=await import('./deploy-account-services.mjs');
 const env={DEPLOY_SHA:'a'.repeat(40),RIGHELT_STORAGE_GENERATION:'reset-986736d3-c72e-4539-9edc-6597847f64e7',RIGHELT_STORAGE_COMPRESSION:'true',RIGHELT_STORAGE_LARGE_STATES_ENABLED:'true',RIGHELT_STORAGE_LARGE_STATES_READER_SHA:'b'.repeat(40)};
 validateStorageDeployment(env,source);
 for(const change of [{RIGHELT_STORAGE_LARGE_STATES_READER_SHA:''},{RIGHELT_STORAGE_COMPRESSION:'false'},{RIGHELT_STORAGE_LARGE_STATES_ENABLED:'invalid'}])assert.throws(()=>validateStorageDeployment({...env,...change},source));
});

test('metadata writers require a prior reader revision and compression',async()=>{
 const {validateStorageDeployment}=await import('./deploy-account-services.mjs');
 const env={DEPLOY_SHA:'a'.repeat(40),RIGHELT_STORAGE_GENERATION:'reset-986736d3-c72e-4539-9edc-6597847f64e7',RIGHELT_STORAGE_COMPRESSION:'true',RIGHELT_STORAGE_METADATA_WRITES_ENABLED:'true',RIGHELT_STORAGE_METADATA_READER_SHA:'b'.repeat(40)};
 validateStorageDeployment(env,source);
 for(const change of [{RIGHELT_STORAGE_METADATA_READER_SHA:''},{RIGHELT_STORAGE_COMPRESSION:'false'},{RIGHELT_STORAGE_METADATA_WRITES_ENABLED:'invalid'}])assert.throws(()=>validateStorageDeployment({...env,...change},source));
});


test('writer canary requires a valid game and an enabled reader-verified writer',async()=>{
 const {validateStorageDeployment}=await import('./deploy-account-services.mjs');
 const env={DEPLOY_SHA:'a'.repeat(40),RIGHELT_STORAGE_GENERATION:'reset-986736d3-c72e-4539-9edc-6597847f64e7',RIGHELT_STORAGE_COMPRESSION:'true',RIGHELT_STORAGE_METADATA_WRITES_ENABLED:'true',RIGHELT_STORAGE_METADATA_READER_SHA:'b'.repeat(40),RIGHELT_STORAGE_WRITER_CANARY_GAME_ID:game};
 validateStorageDeployment(env,source);
 assert.throws(()=>validateStorageDeployment({...env,RIGHELT_STORAGE_WRITER_CANARY_GAME_ID:'wrong'},source),/canary/);
 assert.throws(()=>validateStorageDeployment({...env,RIGHELT_STORAGE_METADATA_WRITES_ENABLED:'false'},source),/enabled writer/);
 assert.throws(()=>validateStorageDeployment({...env,RIGHELT_STORAGE_METADATA_READER_SHA:''},source),/verified reader/);
 const workflow=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
 assert.equal(workflow.split('RIGHELT_STORAGE_WRITER_CANARY_GAME_ID:').length-1,2,'preflight and actual deployment receive the same scope');
 const deploy=readFileSync(new URL('./deploy-account-services.mjs',import.meta.url),'utf8');
 assert.ok(deploy.includes('STORAGE_WRITER_CANARY_GAME_ID:${process.env.RIGHELT_STORAGE_WRITER_CANARY_GAME_ID || ""}'));
});
