import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {storageFixtureConfig} from './storage-fixture-config.mjs';
import {archiveConfig} from './storage-archive-config.mjs';
const source=readFileSync(new URL('../apps/api/wrangler.toml',import.meta.url),'utf8');
test('fixtures replace production archive resources and never inherit cron or canary state',()=>{
 const production=archiveConfig(source,'righelt-archives',{mode:'canary',canaryGameId:'game-'+'a'.repeat(32)});
 for(const archives of [false,true]){
  const fixture=storageFixtureConfig(production,{archives});
  assert.doesNotMatch(fixture,/righelt-archives|\[triggers\]|game-aaaa/);
  assert.equal((fixture.match(/\[\[r2_buckets\]\]/g)||[]).length,Number(archives));
  assert.match(fixture,new RegExp(`STORAGE_BUDGET_ENABLED = "${archives}"`));
  if(archives)assert.match(fixture,/bucket_name = "local-storage-e2e"/);
 }
});
