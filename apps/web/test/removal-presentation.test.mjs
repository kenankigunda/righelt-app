import test from 'node:test';
import assert from 'node:assert/strict';
import {commitRemovalOnset,createConfirmedRemovalPresentation} from '../shell/removal-presentation.js';

const piece=id=>({id,owner:'P1',kind:'unit',position:{row:3,col:id==='A'?4:5}});
const record=(id,cause='operation')=>({eventId:`${cause}:${id}`,pieceId:id,piece:piece(id),position:piece(id).position,reason:'loss_of_supply'});
const game=(records=[],pending=[])=>({id:'g',gameplayRevision:records.length,moves:[{clientCommandId:'operation',destroyedPieces:records}],pendingMoves:pending,board:{state:{pieces:['A','B'].filter(id=>!records.some(r=>r.pieceId===id)).map(piece),outcome:{status:'ongoing'}}}});
const fixture=()=>{let scope='account1:g',visible=true,time=0;const events=[];const owner=createConfirmedRemovalPresentation({getScope:()=>scope,eligible:()=>visible,present:effects=>events.push({kind:'visual',time,ids:effects.map(r=>r.pieceId)}),pending:effects=>events.push({kind:'pending',time,ids:effects.map(r=>r.pieceId)}),clear:()=>events.push({kind:'clear',time}),consume:()=>events.push({kind:'consume',time}),cue:()=>events.push({kind:'cue',time}),cancelSound:()=>events.push({kind:'cancel',time})});return{owner,events,time:value=>time=value,scope:value=>scope=value,visible:value=>visible=value};};

test('delayed authoritative confirmation starts visual and cue in one commit, never the pending projection',()=>{
 const f=fixture();f.owner.update(game());f.time(10);f.owner.update(game(),{view:game([],[{destroyedPieces:[record('A')]}])});assert.equal(f.events.filter(e=>e.kind==='visual'||e.kind==='cue').length,0);assert.deepEqual(f.events.at(-2).ids,['A']);
 f.time(527);f.owner.update(game([record('A')]));assert.deepEqual(f.events.filter(e=>e.kind==='visual'||e.kind==='cue'),[{kind:'visual',time:527,ids:['A']},{kind:'cue',time:527}]);f.time(900);f.owner.update(game([record('A')]));assert.equal(f.events.filter(e=>e.kind==='cue').length,1);
});

test('rejection restores pending state quietly; a distinct confirmed cause can start later once',()=>{
 const f=fixture();f.owner.update(game());f.owner.update(game(),{view:game([],[{destroyedPieces:[record('A')]}])});f.owner.update(game(),{reset:true});assert.equal(f.events.filter(e=>e.kind==='cue').length,0);f.owner.update(game([record('B','end-turn')]));assert.equal(f.events.filter(e=>e.kind==='cue').length,1);
});

for(const boundary of ['hidden','History','frozen','scope','reset','disposal'])test('no late crack or catch-up across '+boundary,()=>{
 const f=fixture();f.owner.update(game());const confirmed=game([record('A')]);
 if(boundary==='hidden')f.visible(false);if(boundary==='scope')f.scope('account2:g');if(boundary==='disposal')f.owner.dispose();
 f.owner.update(confirmed,{view:boundary==='History'?{...confirmed,inHistoryMode:true}:confirmed,frozen:boundary==='frozen',reset:boundary==='reset'});assert.equal(f.events.filter(e=>e.kind==='cue').length,0);
 f.visible(true);f.owner.update(confirmed);assert.equal(f.events.filter(e=>e.kind==='cue').length,0);
});

test('old baseline is silent and batch visual identities preserve records without authority writes',()=>{const f=fixture(),initial=game([record('A')]),before=structuredClone(initial);f.owner.update(initial);assert.equal(f.events.filter(e=>e.kind==='cue').length,0);f.owner.update(game([record('A'),record('B','end-turn')]));assert.deepEqual(f.events.find(e=>e.kind==='visual').ids,['B']);assert.deepEqual(initial,before);});

test('history_mode_changed reset stays silent without erasing rendered static removal markers',()=>{const f=fixture(),confirmed=game([record('A')]);f.owner.update(game());const clears=f.events.filter(event=>event.kind==='clear').length;f.events.push({kind:'history-marker'});f.owner.update(confirmed,{view:{...confirmed,inHistoryMode:true},reset:true});assert.equal(f.events.filter(event=>event.kind==='clear').length,clears);assert.equal(f.events.filter(event=>event.kind==='history-marker').length,1);assert.deepEqual(f.events.filter(event=>event.kind==='pending').at(-1).ids,[]);assert.equal(f.events.filter(event=>event.kind==='cue').length,0);});

test('frozen or stale History still clears rendered removal markers',()=>{
 for(const boundary of ['frozen','stale']){let current=true,markers=0;const owner=createConfirmedRemovalPresentation({getScope:()=> 'account:g',eligible:()=>true,isCurrent:()=>current,present(){},pending(){},clear(){markers=0;},consume(){},cue(){assert.fail('History stays silent');},cancelSound(){}});owner.update(game());markers=2;if(boundary==='stale')current=false;owner.update(game([record('A')]),{view:{...game([record('A')]),inHistoryMode:true},reset:true,frozen:boundary==='frozen'});assert.equal(markers,0,boundary);owner.dispose();}
});

test('shared onset never awaits audio and stale ownership stays quiet',()=>{const events=[];assert.equal(commitRemovalOnset({visual:()=>events.push('visual'),cue:()=>false}),true);assert.deepEqual(events,['visual']);assert.equal(commitRemovalOnset({isCurrent:()=>false,visual:()=>assert.fail(),cue:()=>assert.fail()}),false);});

test('revision or owner replacement during visual commit suppresses and clears the stale cue',()=>{
 for(const boundary of ['revision','scope']){let scope='account:g',current=true,cues=0,consumed=0,clears=0;const owner=createConfirmedRemovalPresentation({getScope:()=>scope,eligible:()=>true,isCurrent:()=>current,present(){if(boundary==='revision')current=false;else scope='new-account:g';},pending(){},clear(){clears++;},cancelSound(){},cue(){cues++;},consume(){consumed++;}});owner.update(game());const before=consumed;owner.update(game([record('A')]));assert.equal(cues,0);assert.equal(consumed,before+1);assert(clears>0);current=true;owner.update(game([record('A')]));assert.equal(cues,0);owner.dispose();}
});
