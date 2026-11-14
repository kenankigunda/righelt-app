import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD_MESSAGE_PRIORITY,isMeaningfulHistoryMessage,resolveBoardMessageOwner} from '../board/message-priority.js';

const prompt=text=>({text});
const context=text=>({text,purpose:'selected-history'});

test('semantic Board context suppresses a weaker generic instruction',()=>{
 const semantic=context('You won in 29 moves.');
 const result=resolveBoardMessageOwner({semantic,generic:prompt('Choose a move in History')});
 assert.equal(result.owner,BOARD_MESSAGE_PRIORITY.SEMANTIC);
 assert.equal(result.prompt,null);
 assert.equal(result.context,semantic);
});

test('required and blocking prompts remain stronger than explanatory context',()=>{
 const explanation=context('Rush to restore supply for piece at (7, 1)');
 const required=prompt('Select a rush to restore supply');
 assert.deepEqual(resolveBoardMessageOwner({required,context:explanation}),{
  owner:BOARD_MESSAGE_PRIORITY.REQUIRED_ACTION,prompt:required,context:null,
 });
 const blocking=prompt('Connection failed. Retry to keep playing or view details.');
 assert.deepEqual(resolveBoardMessageOwner({blocking,required,semantic:explanation,generic:prompt('Select a piece')}),{
  owner:BOARD_MESSAGE_PRIORITY.BLOCKING,prompt:blocking,context:null,
 });
});

test('generic instructions remain when no stronger state explains the Board',()=>{
 const generic=prompt('Choose a move in History');
 assert.deepEqual(resolveBoardMessageOwner({generic}),{
  owner:BOARD_MESSAGE_PRIORITY.GENERIC_INSTRUCTION,prompt:generic,context:null,
 });
 assert.deepEqual(resolveBoardMessageOwner(),{owner:null,prompt:null,context:null});
});

test('History placeholders are not promoted over actionable empty-state guidance',()=>{
 for(const text of ['History','Turn overview','Historical move details unavailable','Historical turn details unavailable'])assert.equal(isMeaningfulHistoryMessage({text,actorName:'Guest'}),false);
 assert.equal(isMeaningfulHistoryMessage({text:'Recorded move',coordinates:[{row:1,col:2}]}),true);
 assert.equal(isMeaningfulHistoryMessage({text:'You won in 29 moves.'}),true);
});
