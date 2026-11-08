import assert from 'node:assert/strict';
import path from 'node:path';
export function additiveReporterCLI(original,{candidate,junitFile,observer}){
 assert(Array.isArray(original)&&original.length===4,'Original CI reporters changed');
 assert.deepEqual(original.slice(0,2),[['github'],['line']]);
 assert.deepEqual(original[2],['junit',{outputFile:junitFile}]);
 assert.deepEqual(original[3],['./scripts/testing/browser-reporter.mjs']);
 const names=['github','line','junit',path.join(candidate,'scripts/testing/browser-reporter.mjs'),observer];
 assert(names.every(n=>typeof n==='string'&&!n.includes(',')));
 return '--reporter='+names.join(',');
}
