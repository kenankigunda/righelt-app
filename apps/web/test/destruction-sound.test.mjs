import test from 'node:test';
import assert from 'node:assert/strict';
import {createDestructionSoundTracker,playStoneCrack} from '../shell/destruction-sound.js';
import {createGameSound} from '../shell/sound.js';
const record=(cause,id)=>({eventId:`${cause}:${id}`,pieceId:id});
const game=(ids,records=[],command='a')=>({id:'g',moves:[{clientCommandId:command,destroyedPieces:records}],board:{state:{pieces:ids.map(id=>({id})),outcome:{status:'ongoing'}}}});
test('one crack per causing batch across repeated receipts and delayed finalization; later action sounds',()=>{
 const tracker=createDestructionSoundTracker();assert.equal(tracker.update(game(['x','y','z']),{baseline:true}),0);
 assert.equal(tracker.update(game(['z'],[record('a','x'),record('a','y')])),1);
 assert.equal(tracker.update(game(['z'],[record('a','x'),record('a','y')])),0);
 assert.equal(tracker.update(game([], [record('a','x'),record('a','y'),record('a','z')])),0);
 assert.equal(tracker.update(game(['q'],[], 'project')),0);
 assert.equal(tracker.update(game([], [record('b','q')], 'b')),1);
});
test('identity fallback detects projection plus removal with unchanged net count; end-turn has its own identity',()=>{
 const tracker=createDestructionSoundTracker();tracker.update(game(['x','y']),{baseline:true});
 assert.equal(tracker.update(game(['y','projected']),{commandId:'project',sequence:2}),1);
 assert.equal(tracker.update(game(['y','projected']),{commandId:'project',sequence:3}),0);
 assert.equal(tracker.update(game(['projected'],[record('end-turn','y')]),{commandId:'end-turn'}),1);
});
test('hydration/history/replay baseline consumes records without catch-up; undone records never sound',()=>{
 const tracker=createDestructionSoundTracker();tracker.update(game(['x']),{baseline:true});
 const removed=game([], [record('a','x')]);assert.equal(tracker.update(removed,{baseline:true}),0);assert.equal(tracker.update(removed),0);
 const undone=game([], [record('b','y')]);undone.moves[0].undone=true;assert.equal(tracker.update(undone),0);
});
const audioFixture=()=>{
 const buffers=[],stops=[],oscillators=[];
 const node=()=>({connect(){},disconnect(){},frequency:{},Q:{},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},start(){},stop(t){stops.push(t)}});
 const audio={state:'running',currentTime:0,sampleRate:8000,destination:{},createBuffer:(_,length)=>{const data=new Float32Array(length);buffers.push(data);return {getChannelData:()=>data}},createBufferSource:node,createBiquadFilter:node,createGain:node,createOscillator:()=>{const n=node();oscillators.push(n);return n},suspend:()=>Promise.resolve()};
 return {audio,buffers,stops,oscillators};
};
test('stone fracture has a hard stop, nonzero dry decay and no pitched oscillator',()=>{
 const f=audioFixture();playStoneCrack(f.audio);assert.equal(f.buffers.length,1);assert.equal(f.buffers[0].length,1040);assert.deepEqual(f.stops,[.13]);assert.equal(f.oscillators.length,0);
 const energy=values=>values.reduce((sum,n)=>sum+n*n,0)/values.length;
 assert.ok(energy(f.buffers[0].slice(0,160))>energy(f.buffers[0].slice(-160))*100);
});
test('optimistic/rejected removal never cracks; confirmed local receipt cracks exactly once and preserves result cue',()=>{
 const f=audioFixture();const sound=createGameSound({createAudio:()=>f.audio,getIdentityId:()=> 'red'});sound.gesture();
 const event=(seq,g,reason='move_recorded')=>({game:g,eventSeq:seq,clientCommandId:'a',type:'event_appended',reason});
 sound.observe(event(1,game(['x','y'])),{silent:true});
 sound.local({type:'optimistic_enqueue',gameId:'g',clientCommandId:'a'},{currentSnapshot:game(['y']).board.state});
 assert.equal(f.buffers.filter(b=>b.length===1040).length,0);
 sound.observe(event(2,game(['x','y']),'action_rejected'));assert.equal(f.buffers.filter(b=>b.length===1040).length,0);
 const terminal=game(['y'],[record('a','x')]);terminal.player1={identityId:'red'};terminal.board.state.outcome={status:'p1_win'};
 sound.observe(event(3,terminal));sound.observe(event(4,terminal,'turn_ended'));
 assert.equal(f.buffers.filter(b=>b.length===1040).length,1);assert.equal(f.oscillators.filter(n=>[560,700,840].includes(n.frequency.value)).length,3);
});
test('mute, missing gesture and background consume destruction silently without later replay',()=>{
 for(const gate of ['mute','gesture','background','silent']){
  const f=audioFixture();let hidden=false;const sound=createGameSound({createAudio:()=>f.audio,hidden:()=>hidden});if(gate!=='gesture')sound.gesture();
  const event=(seq,g)=>({game:g,eventSeq:seq,type:'event_appended',reason:'move_recorded',clientCommandId:'a'});
  sound.observe(event(1,game(['x'])),{silent:true});if(gate==='mute')sound.toggle();if(gate==='background')hidden=true;
  sound.observe(event(2,game([],[record('a','x')])),{silent:gate==='silent'});hidden=false;
  sound.observe(event(3,game([],[record('a','x')])));assert.equal(f.buffers.filter(b=>b.length===1040).length,0,gate);
 }
});

test('legacy destruction records without piece IDs still make one batch, not a record plus fallback crack',()=>{
 const tracker=createDestructionSoundTracker();tracker.update(game(['x','y']),{baseline:true});
 assert.equal(tracker.update(game([], [{position:{row:1,col:1}},{position:{row:2,col:2}}]),{commandId:'a'}),1);
});
test('audio runtime construction failure stays separate from user mute and a later gesture can retry',()=>{
 const f=audioFixture();let attempts=0;const sound=createGameSound({createAudio:()=>{if(++attempts===1)throw Error('AudioContext unavailable');return f.audio}});
 assert.doesNotThrow(()=>sound.gesture());assert.equal(sound.enabled(),true);assert.equal(sound.play('destruction'),false);
 sound.gesture();assert.equal(sound.play('destruction'),true);assert.equal(sound.enabled(),true);assert.equal(attempts,2);
 sound.toggle();assert.equal(sound.enabled(),false);sound.gesture();assert.equal(attempts,2);assert.equal(sound.play('destruction'),false);
});
test('a rejected browser resume remains silent without changing the saved sound preference',async()=>{
 const f=audioFixture();f.audio.state='suspended';f.audio.resume=()=>Promise.reject(Error('gesture blocked'));
 const values=new Map();const sound=createGameSound({createAudio:()=>f.audio,storage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}});
 sound.gesture();await Promise.resolve();assert.equal(sound.play('destruction'),false);assert.equal(sound.enabled(),true);assert.equal(values.size,0);
});
