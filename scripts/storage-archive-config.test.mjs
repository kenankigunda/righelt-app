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
