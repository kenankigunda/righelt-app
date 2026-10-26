import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectBrowserParityModel} from '../../computer-browser-parity-options.mjs';
const legacy=Object.freeze({id:'initial-1554',sha256:'7'.repeat(64),checkpoint:'4'.repeat(64),bytes:411327,url:'/computer/models/initial-1554.onnx',experimental:true});
const current=Object.freeze({id:'attention-closed',sha256:'a'.repeat(64),checkpoint:'b'.repeat(64),bytes:922100,url:'/computer/models/attention-closed.onnx',experimental:false});
const models=Object.freeze({[legacy.id]:legacy,[current.id]:current});
const select=argv=>selectBrowserParityModel(argv,{current,models});
test('default uses the actual CURRENT descriptor after promotion, without swapping the registry',()=>{assert.equal(select([]),current);assert.equal(models[legacy.id],legacy);assert.equal(select(['--corpus','states.json']),current);});
test('explicit retained model returns its complete published descriptor rather than current defaults',()=>{const selected=select(['--model-id','initial-1554']);assert.equal(selected,legacy);assert.notEqual(selected.sha256,current.sha256);assert.notEqual(selected.url,current.url);});
test('explicit current selection is also supported',()=>assert.equal(select(['--model-id','attention-closed']),current));
for(const id of ['unpublished-model','__proto__','prototype','constructor','toString','','../initial-1554',' initial-1554','initial-1554/other','initial-1554?x','INITIAL-1554'])test(`rejects unregistered or malformed ID ${JSON.stringify(id)}`,()=>assert.throws(()=>select(['--model-id',id])));
test('missing or duplicate selection never silently uses CURRENT',()=>{for(const argv of [['--model-id'],['--model-id','--out','proof.json'],['--model-id','initial-1554','--model-id','attention-closed'],['--model-id=initial-1554']])assert.throws(()=>select(argv));});
test('inherited registry entries are not published models',()=>assert.throws(()=>selectBrowserParityModel(['--model-id',legacy.id],{current,models:Object.create({[legacy.id]:legacy})}),/Unknown published model/));
test('own constructor entry cannot authorize a prototype ID',()=>assert.throws(()=>selectBrowserParityModel(['--model-id','constructor'],{current,models:{constructor:{...legacy,id:'constructor'}}}),/Invalid --model-id/));
for(const [label,change]of [
 ['mismatched ID',{id:'other'}],['external URL',{url:'https://example.invalid/model.onnx'}],['parent traversal',{url:'/computer/models/../model.onnx'}],['query URL',{url:'/computer/models/model.onnx?override=1'}],['missing hash',{sha256:undefined}],['invalid bytes',{bytes:0}],['invalid checkpoint',{checkpoint:'bad'}],
])test(`rejects selected descriptor with ${label}`,()=>assert.throws(()=>selectBrowserParityModel(['--model-id',legacy.id],{current,models:{[legacy.id]:{...legacy,...change}}}),/Invalid published model descriptor/));
test('inherited descriptor fields cannot be supplied through prototype pollution',()=>assert.throws(()=>selectBrowserParityModel(['--model-id',legacy.id],{current,models:{[legacy.id]:Object.create(legacy)}}),/Invalid published model descriptor/));
test('the actual proof binds asset, reference, runtime, metadata and report to the selected model',async()=>{
 const source=await readFile(new URL('../../verify-computer-browser-parity.mjs',import.meta.url),'utf8');
 assert.match(source,/selectBrowserParityModel\(process\.argv\.slice\(2\), \{current: CURRENT_COMPUTER_MODEL, models: COMPUTER_MODELS\}\)/);
 assert.doesNotMatch(source,/CURRENT_COMPUTER_MODEL\.(?:id|url|sha256)/);
 assert.match(source,/readFile\(path\.join\(root, model\.url\)\)/);
 assert.match(source,/reference\.modelSha256 !== model\.sha256/);
 assert.match(source,/modelId: model\.id/);
 assert.match(source,/\}, model\.id\)/);
 assert.match(source,/sha: model\.sha256/);
});
