import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {transformBoardAdmissionModule} from './board-admission-diagnostics.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function transformClientSettlement(source,alreadyTransformed,recipe){
 if(hash(source)!==recipe.rawSourceSha256)throw Error('Settlement raw source mismatch');
 return transformBoardAdmissionModule(alreadyTransformed,recipe);
}
// Serialized into the owned document. Weak maps associate callback, root and store
// identities; frozen snapshots expose primitive fields, never models or callable/store references.
export function installClientSettlementRecorder({namespace}){
 const epochs=new WeakMap(),bindings=new WeakMap(),boundHosts=new WeakMap(),categories=Object.create(null);let serial=0,sequence=0,latest=null,failures=0;
 const fail=category=>{failures=Math.min(1000000,failures+1);categories[category]=Math.min(1000000,(categories[category]??0)+1);latest=null;};
 const token=value=>{if(!value||!['object','function'].includes(typeof value))throw Error('Invalid settlement owner');if(!epochs.has(value))epochs.set(value,++serial);return epochs.get(value);};
 const keys=['scopeGameId','viewGameId','currentGameId','mountedGameId','appliedEventSeq','gameplayRevision','hostEligible','pendingCommandCount','syncStatus','rulesChecking','storageBlocked','unsavedCommand','confirmationOverdue','recovering','upgradeRequired','sharedMutationsBlocked','gameplayMutationsBlocked','inHistoryMode','positionOnly'];
 const bind=(host,root)=>{try{if(typeof host!=='function')return fail('host-invalid');bindings.set(host,root);if(root&&['object','function'].includes(typeof root))boundHosts.set(root,host);}catch{fail('binding-internal');}};
 const capture=(transport,host,values,ownerTransport=transport)=>{try{
  if(typeof host!=='function'||!bindings.has(host))return fail('host-unbound');
  const root=bindings.get(host);
  const current=document.getElementById('shell-board');
  if(!root)return fail('root-missing');
  if(root.isConnected!==true)return fail('root-disconnected');
  if(current!==root)return fail('root-mismatch');
  if(boundHosts.get(root)!==host)return fail('host-stale');
  if(transport!==ownerTransport)return fail('store-mismatch');
  if(!transport||!['object','function'].includes(typeof transport))return fail('owner-invalid');
  const row={namespace,timeOrigin:performance.timeOrigin,sequence:++sequence,transportEpoch:token(transport),rootEpoch:token(root)};
  const descriptors=Object.getOwnPropertyDescriptors(values);
  if(Reflect.ownKeys(descriptors).some(key=>!keys.includes(key)))return fail('field-unexpected');
  for(const key of keys){const d=descriptors[key];if(!d||!Object.hasOwn(d,'value')||!(d.value===null||['string','number','boolean'].includes(typeof d.value)))return fail('field-unknown');row[key]=d.value;}
  latest=Object.freeze(row);
 }catch{fail('capture-internal');}};
 const snapshot=()=>{const root=document.getElementById('shell-board');return Object.freeze({namespace,timeOrigin:performance.timeOrigin,currentRootEpoch:root?.isConnected?epochs.get(root)??null:null,failures,categories:Object.freeze({...categories}),latest});};
 Object.defineProperty(globalThis,'__retreatClientSettlement',{value:Object.freeze({bind,capture,snapshot,invalidate(){fail('argument-evaluation');}}),writable:false,configurable:false});
}
export function settlementMatches(packet,scope,expectedSeq){
 if(!Number.isSafeInteger(expectedSeq)||expectedSeq<0||!packet||packet.failures!==0)return false;
 const r=packet.latest;if(!r)return false;
 for(const key of ['namespace','timeOrigin','transportEpoch','rootEpoch'])if(r[key]!==scope[key])return false;
 if(packet.namespace!==scope.namespace||packet.timeOrigin!==scope.timeOrigin||packet.currentRootEpoch!==scope.rootEpoch)return false;
 if(!['scopeGameId','viewGameId','currentGameId','mountedGameId'].every(key=>r[key]===scope.gameId))return false;
 if(!Number.isSafeInteger(r.appliedEventSeq)||r.appliedEventSeq<expectedSeq||!Number.isSafeInteger(r.gameplayRevision))return false;
 if(r.hostEligible!==true||r.pendingCommandCount!==0||r.syncStatus!=='ready')return false;
 return ['rulesChecking','storageBlocked','unsavedCommand','confirmationOverdue','recovering','upgradeRequired','sharedMutationsBlocked','gameplayMutationsBlocked','inHistoryMode','positionOnly'].every(key=>r[key]===false);
}
// Compile only this module's trusted matcher source in Node. Playwright receives
// a real self-contained function (isFunction:true), with scope/sequence as data;
// the browser executes no new eval/Function and never treats a function as ready.
const settlementWaitPredicate=Function(`return ({scope,expectedSeq}) => (${settlementMatches.toString()})(globalThis.__retreatClientSettlement?.snapshot(),scope,expectedSeq);`)();
export async function installClientSettlementObserver(page,info){
 const namespace=randomUUID(),recipes=JSON.parse(await readFile(new URL('./client-settlement-transformation.json',import.meta.url),'utf8'));
 const transforms=[];
 await page.addInitScript(installClientSettlementRecorder,{namespace});
 const snapshot=()=>page.evaluate(()=>globalThis.__retreatClientSettlement?.snapshot()??null);
 return {
  transform(pathname,raw,body){const recipe=recipes[pathname];if(!recipe)return body;const output=transformClientSettlement(raw,body,recipe);transforms.push({pathname,raw:hash(raw),input:hash(body),output:hash(output)});return output;},
  async scope(gameId){const p=await snapshot(),r=p?.latest;if(!r||p.failures||p.namespace!==namespace||r.scopeGameId!==gameId||r.currentGameId!==gameId)throw Error('Owned client settlement scope unavailable');return Object.freeze({namespace,timeOrigin:r.timeOrigin,transportEpoch:r.transportEpoch,rootEpoch:r.rootEpoch,gameId});},
  async wait(scope,expectedSeq,deadline){
   const remaining=deadline-performance.now();if(!(remaining>0))throw Error('Original unsafe receipt allowance exhausted');
   await page.waitForFunction(settlementWaitPredicate,{scope,expectedSeq},{timeout:remaining});
  },
  async persist(){const packet=await snapshot();const result={namespace,transforms,packet};await writeFile(info.outputPath('client-settlement-observation.json'),JSON.stringify(result,null,2));if(new Set(transforms.map(row=>row.pathname)).size!==2||packet?.failures||!packet?.latest)throw Error('Client settlement observer incomplete');},
 };
}
