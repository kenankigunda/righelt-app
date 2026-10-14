import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveConfig} from './storage-archive-config.mjs';
test('archive activation requires a valid private bucket and preserves all current bindings',()=>{
 const source='STORAGE_ARCHIVES_ENABLED = "false"\nSTORAGE_BUDGET_ENABLED = "false"\nSTORAGE_EXCLUSIVE_R2 = "false"\ndatabase_id = "production-id"\n';
 assert.throws(()=>archiveConfig(source,'x"\nbad'),/bucket/);
 const result=archiveConfig(source,'righelt-archives');
 assert.match(result,/database_id = "production-id"/);assert.match(result,/STORAGE_BUDGET_ENABLED = "true"/);assert.match(result,/binding = "ARCHIVES"/);assert.match(result,/0 \* \* \* \*/);
 assert.throws(()=>archiveConfig(result,'righelt-archives'),/reconciliation/);
});
