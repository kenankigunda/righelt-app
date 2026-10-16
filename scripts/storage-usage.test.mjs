import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectStorageUsage} from './storage-usage.mjs';
test('usage refresh refuses missing provider size and requires exclusive R2 attestation',async()=>{
 const run=()=>JSON.stringify([{meta:{size_after:400000000},results:[{archive_bytes:0,class_a:0,class_b:0}]}]);
 assert.deepEqual((await inspectStorageUsage({},run)).warnings,['d1_capacity']);
 await assert.rejects(inspectStorageUsage({apply:true},run),/exclusive/);
 await assert.rejects(inspectStorageUsage({},()=>JSON.stringify([{meta:{},results:[]}])),/unavailable/);
 let writes=0;
 await inspectStorageUsage({apply:true,exclusive:true},args=>{if(args.at(-1).startsWith('UPDATE'))writes++;return run();});assert.equal(writes,1);
});
