import path from 'node:path';
import {STORAGE_TESTS} from './storage-evidence.mjs';
import {FAILURE_KINDS} from './receipts.mjs';

const kind='storage-lane-isolation-v1';
const storageFile='e2e/workflows/storage-lifecycle.spec.mjs';

// This checks discovered intent, before a webServer or destructive test starts.
// An HTTP storage_reset response by itself is deliberately not a classifier.
export function storageLaneIsolation(lane,discovery,{cwd=process.cwd()}={}) {
 if(!['storage-lifecycle','e2e'].includes(lane.suite))return null;
 const errors=[],tests=Array.isArray(discovery?.tests)?discovery.tests:[];
 const ids=tests.map(test=>test?.id),declared=discovery?.inventory;
 if(!Array.isArray(discovery?.tests)||!tests.length||discovery.total!==tests.length||tests.some(test=>typeof test?.id!=='string'||!test.id||typeof test.file!=='string'||typeof test.name!=='string')||new Set(ids).size!==ids.length||!Array.isArray(declared)||JSON.stringify(declared)!==JSON.stringify(ids))errors.push('Malformed or ambiguous discovery inventory');
 const actual=tests.map(test=>({id:test?.id,file:test?.file,name:test?.name}));
 const expectedFile=path.resolve(cwd,storageFile);
 const expected=lane.suite==='storage-lifecycle'
  ?STORAGE_TESTS.map(title=>` > ${lane.project} > workflows/storage-lifecycle.spec.mjs > ${title}`)
  :['No storage-lifecycle cases in general E2E'];
 let missing=[];
 if(lane.suite==='storage-lifecycle') {
  if(!['chromium','firefox','webkit'].includes(lane.project))errors.push('Storage lane requires one known browser project');
  missing=expected.filter(name=>!actual.some(test=>test.name===name&&test.file===expectedFile));
  if(tests.length!==STORAGE_TESTS.length||actual.some(test=>test.file!==expectedFile||!expected.includes(test.name))||missing.length)errors.push('Dedicated storage lane must contain exactly its two original cases');
 }else if(actual.some(test=>typeof test.file==='string'&&path.basename(test.file)==='storage-lifecycle.spec.mjs'))errors.push('General E2E must not contain destructive storage cases');
 if(!errors.length)return null;
 return {kind,category:'infrastructure-inventory-isolation',suite:lane.suite,project:lane.project??null,stackStarted:false,expected,actual,missing,errors};
}

export function isolationFailureLabel(receipt) {
 return receipt.failureKind===FAILURE_KINDS.INVENTORY&&receipt.status==='failed'&&receipt.isolation?.kind===kind&&receipt.isolation.stackStarted===false
  ?'infrastructure inventory isolation':null;
}
