import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,createInitialState} from '../generated/packages/game-engine/src/index.js';
import {destructionRecords} from '../generated/packages/game-engine/src/removals.js';
import {createDestructionSoundTracker} from '../shell/destruction-sound.js';
test('actual no-retreat commander push records drive one sound and confirmed repeat stays silent',()=>{
 const piece=(id,owner,row,col,kind='unit')=>({id,owner,position:{row,col},kind,supplied:true,commanded:true});
 const state={...createInitialState(),pieces:[piece('C1','P1',3,6,'commander'),piece('C2','P2',4,2,'commander'),piece('A1','P1',4,1),piece('A2','P1',3,1),piece('B1','P1',3,2),piece('B2','P2',5,2),piece('B3','P1',4,3)]};
 const events=[], tracker=createDestructionSoundTracker();tracker.update({id:'real',moves:[],board:{state}},{baseline:true});
 const next=applyAction(state,{type:'push',actorId:'A1',from:{row:4,col:1},to:{row:4,col:2}},{onRemoval:event=>events.push(event)}).state;
 assert.equal(events.find(event=>event.piece.id==='C2')?.reason,'no_retreat');
 const confirmed={id:'real',board:{state:next},moves:[{clientCommandId:'actual-push',destroyedPieces:destructionRecords(events,'actual-push')}]};
 assert.equal(tracker.update(confirmed,{commandId:'actual-push'}),1);assert.equal(tracker.update(confirmed,{commandId:'actual-push'}),0);
});
