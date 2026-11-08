import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const ORIGINAL_ADAPTER_SHA256='cda1eb6c712c0b2a3ef8794bd6d3271b6d9d7904b751579f344b50e37d97d5bc';
export function deriveAdapter(original,recorderURL){
 if(hash(original)!==ORIGINAL_ADAPTER_SHA256)throw Error('Exact original bdf adapter required');
 const edits=[];let source=original;
 function change(before,after,count=1){if(source.split(before).length-1!==count)throw Error('Adapter diagnostic source anchor mismatch');source=source.split(before).join(after);edits.push({before,after,count});}
 change('import http from "node:http";',`import http from "node:http";\nimport {createTransportObservation,inertTransportObservation} from ${JSON.stringify(recorderURL)};`);
 change('export async function createWorkerConnectionOrigin(input) {','export async function createWorkerConnectionOrigin(input, diagnosticOwner=undefined) {');
 change('export async function createWorkerConnectionOrigin(input, diagnosticOwner=undefined) {\n  const target = destination(input);','export async function createWorkerConnectionOrigin(input, diagnosticOwner=undefined) {\n  const target = destination(input);\n  const observation=createTransportObservation(diagnosticOwner,target)??inertTransportObservation;');
 change('  const server = http.createServer((request, response) => {','  const server = http.createServer((request, response) => {\n    const observed=observation.request(request,response);');
 change('    const outgoing = http.request(options(request), incoming => {','    const outgoing = http.request(options(request), incoming => {\n      observation.response(observed,incoming);');
 change('    outgoing.on("socket", track);','    observation.outgoing(observed,outgoing);\n    outgoing.on("socket", track);',2);
 change('  server.on("connection", track);','  observation.server(server);\n  server.on("connection", track);');
 change('  server.on("upgrade", (request, client, head) => {','  server.on("upgrade", (request, client, head) => {\n    const observed=observation.request(request,client,true);');
 change('    outgoing.on("upgrade", (incoming, backend, backendHead) => {','    outgoing.on("upgrade", (incoming, backend, backendHead) => {\n      observation.response(observed,incoming,true,backend);');
 change('    outgoing.on("response", incoming => {','    outgoing.on("response", incoming => {\n      observation.response(observed,incoming);');
 change('  const retire = () => closing ??= new Promise(resolve => server.close(resolve));','  const retire = () => { observation.retire(); return closing ??= new Promise(resolve => server.close(resolve)); };');
 change('    async close() {\n      const done = retire();','    async close() {\n      observation.close();\n      const done = retire();');
 change('const connection = await createWorkerConnectionOrigin(target);','const connection = await createWorkerConnectionOrigin(target, owner);');
 let inverse=source;
 for(const edit of [...edits].reverse()){if(inverse.split(edit.after).length-1!==edit.count)throw Error('Diagnostic inverse anchor mismatch');inverse=inverse.split(edit.after).join(edit.before);}
 if(inverse!==original)throw Error('Adapter diagnostic inverse failed');
 return{source,originalSHA256:hash(original),derivedSHA256:hash(source),inverseExact:true,edits};
}
