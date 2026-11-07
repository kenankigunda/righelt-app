import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {measureGeckoSemanticSample} from '../../../browser-integration/support/gecko-semantic-sample.mjs';
import {CALIBRATION} from '../../../browser-integration/support/gecko-case-domain-witness.mjs';
const retained=JSON.parse(readFileSync(new URL('./fixtures/semantic-gecko-edge.json',import.meta.url),'utf8')).changed;
const profile=JSON.parse(readFileSync(new URL('../../../browser-integration/support/gecko-source-profile.json',import.meta.url),'utf8'));
const qualifiedProfile={...profile,version:'148.0.2'};

// A DOM API model supplies fixed registered probe readings, not a second math implementation.
function fixture(){
 const events=[],state={},geometry=structuredClone(retained),doc={};
 const css={display:'block',boxSizing:'border-box',getPropertyValue:k=>({display:'block',position:'static',transform:'none','offset-path':'none',translate:'none',rotate:'none',scale:'none',zoom:'1',filter:'none',perspective:'none','writing-mode':'horizontal-tb','column-count':'auto','column-width':'auto'}[k]??'0px'),marginTop:'0px',marginBottom:'0px',paddingTop:'0px',paddingBottom:'0px',borderTopWidth:'0px',borderBottomWidth:'0px'};
 const win={devicePixelRatio:1,getComputedStyle:n=>n.css,scrollX:0,scrollY:0,innerWidth:390,innerHeight:740,visualViewport:{scale:1,offsetTop:0,offsetLeft:0}};
 doc.defaultView=win;
 const layoutHeights={card:geometry.cardLayoutHeight,board:geometry.boardLayoutHeight,slot:geometry.slotLayoutHeight};
 const make=(kind)=>({kind,css:{...css,height:layoutHeights[kind]??'0px'},localName:'div',namespaceURI:'http://www.w3.org/1999/xhtml',isConnected:true,ownerDocument:doc,scrollTop:0,scrollLeft:0,parentElement:null,offsetHeight:geometry[kind]?.offsetHeight??0,getAnimations:()=>[],getClientRects:()=>[{}],getBoundingClientRect(){events.push('rect:'+kind);const raw=geometry[kind]??geometry.card;return {...raw,toJSON:()=>({...raw})};}});
 state.main=make('card');state.slot=make('slot');state.wrap=make('wrap');state.board=make('board');
 const original={...state};state.main.querySelector=s=>s==='#board'?state.board:state.slot;
 state.slot.parentElement=state.main;state.wrap.parentElement=state.main;state.board.parentElement=state.wrap;state.slot.nextElementSibling=state.wrap;
 state.wrap.firstElementChild=state.board;
 state.wrap.classList={contains:s=>s==='board-wrap'};state.wrap.contains=n=>n===state.board;
 doc.querySelector=s=>s==='main'?state.main:null;
 doc.activeElement={};doc.documentElement={scrollWidth:390,scrollHeight:740};
 let host,probeReads=0,hostRemovals=0;
 doc.createElement=()=>{
  const node={style:{cssText:''},isConnected:false,setAttribute(){},append(child){child.isConnected=true;},remove(){this.isConnected=false;if(this===host)hostRemovals++;},getBoundingClientRect(){events.push('probe');const input=CALIBRATION[probeReads++];assert(input);return {top:input.top,height:input.extent,bottom:input.top+input.extent};}};
  host??=node;return node;
 };
 doc.body={append(node){node.isConnected=true;}};
 win.owner=async raw=>{events.push('owner:start');assert.deepEqual(raw,retained);await Promise.resolve();events.push('owner:saved');};
 return {doc,win,state,original,geometry,events,make,counts:()=>({probeReads,hostRemovals}),measure:()=>measureGeckoSemanticSample(original.main,{profile:qualifiedProfile,rawCaptureBinding:'owner'})};
}

test('real measurement API persists original raw before fresh reads and actual calibration',async()=>{
 const f=fixture(),result=await f.measure();
 assert.equal(result.edgeWitness.qualified,true);assert.equal(result.edgeWitness.appUnitEdges.board,15799);
 assert.deepEqual(f.events.slice(0,3),['rect:card','rect:board','rect:slot']);
 const saved=f.events.indexOf('owner:saved'),firstProbe=f.events.indexOf('probe');
 assert(saved>f.events.indexOf('owner:start'));assert(firstProbe>saved);
 assert.deepEqual(f.events.slice(saved+1,saved+4),['rect:card','rect:board','rect:slot']);
 assert.deepEqual(f.counts(),{probeReads:44,hostRemovals:1});assert.deepEqual(result.edgeWitness.identity.after,result.edgeWitness.identity.before);
});
test('identical-geometry replacement of main, slot, wrap or board during raw save cannot qualify',async()=>{
 for(const key of ['main','slot','wrap','board']){
  const f=fixture();f.win.owner=async()=>{const replacement=f.make(key==='main'?'card':key);if(key==='wrap'){f.state.wrap=replacement;f.original.board.parentElement=replacement;}else f.state[key]=replacement;};
  const result=await f.measure();assert.equal(result.edgeWitness.reason,'sample-node-identity',key);assert.equal(result.edgeWitness.qualified,false);assert.equal(f.counts().probeReads,0);
 }
});
test('raw write failure preserves original numeric sample and never starts witness calibration',async()=>{
 const f=fixture();f.win.owner=async()=>{throw new TypeError('write failed');};const result=await f.measure();
 assert.equal(result.edgeWitness.reason,'raw-owner-error');assert.equal(result.edgeWitness.errorName,'TypeError');assert.deepEqual(result.board,retained.board);assert.equal(f.counts().probeReads,0);assert.deepEqual(f.events,['rect:card','rect:board','rect:slot']);
});
test('missing raw owner fails incomplete without pretending a sample was persisted',async()=>{
 const f=fixture();delete f.win.owner;const result=await f.measure();assert.equal(result.edgeWitness.reason,'raw-owner-missing');assert.equal(result.edgeWitness.incomplete,true);assert.equal(f.counts().probeReads,0);
});
test('same node references must remain connected and in their original document after raw save',async()=>{
 for(const mutate of [f=>f.original.slot.isConnected=false,f=>f.original.board.ownerDocument={}]){
  const f=fixture();f.win.owner=async()=>mutate(f);const result=await f.measure();assert.equal(result.edgeWitness.reason,'sample-node-identity');assert.equal(f.counts().probeReads,0);
 }
});
test('same-reference geometry changes after awaited raw persistence fail before witness',async()=>{
 const f=fixture();f.win.owner=async()=>{f.geometry.board.top+=1/64;f.geometry.board.y+=1/64;f.geometry.board.bottom+=1/64;};const result=await f.measure();
 assert.equal(result.edgeWitness.reason,'sample-changed-after-raw-persistence');assert.deepEqual(result.board,retained.board);assert.notDeepEqual(result.edgeWitness.observed.board,retained.board);assert.equal(f.counts().probeReads,0);
});
