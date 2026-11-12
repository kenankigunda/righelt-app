import test from 'node:test';
import assert from 'node:assert/strict';
import {boardPromptSizingModels} from '../board/prompt-models.js';
import {renderBoardMessageSlot} from '../shell/board-message-layout.js';
import {validateFontEnvelope} from '../../../browser-integration/support/font-pattern-budget.mjs';

// Independent public finite-prompt contract. Keep the approved 68-row corpus
// provenance; PR193 adds eleven models, giving 79 per font. This expectation is
// authored from the accepted prompt/CTA/coordinate/actor states, never harvested
// from the implementation. Compare semantic multisets so reordering is harmless.
const expectedModels=[
 'Select a piece','Select a move','Select another piece','Select another move',
 'Select a rush','Select a rush to restore supply','Select a follow',
 'Choose a move in History','Review the game in History','Following the push',
 'Watch replay','Next','Preparing replay','Replay unavailable',
 {text:'Select a piece or',action:{id:'pass',label:'Pass'}},
 {text:'Select a move for piece at (9, 9)',coordinates:[{row:9,col:9}]},
 {text:'Select another move for piece at (9, 9)',coordinates:[{row:9,col:9}]},
 {text:'Select a retreat for piece at (9, 9)',coordinates:[{row:9,col:9}]},
 {text:'Supply and command lines for piece at (9, 9)',coordinates:[{row:9,col:9}]},
 {text:'Opponent’s supply and command lines for piece at (9, 9)',coordinates:[{row:9,col:9}]},
 {text:'Select a rush or',action:{id:'end-turn',label:'End turn'}},
 {text:'Select a rush to restore supply',badge:'Obligatory',actions:[{id:'retry-rush-guidance',label:'Try again'}]},
 {text:'Select a rush',actions:[{id:'end-turn',label:'End turn'},{id:'retry-rush-guidance',label:'Try again'}]},
 {text:'Preparing replay',action:{id:'replay-cancel',label:'Cancel replay'}},
 {text:'Replay unavailable',actions:[{id:'replay-computer',label:'Try again'},{id:'replay-dismiss',label:'Dismiss'}]},
 {text:'Watch replay',action:{id:'replay-stop',label:'Stop replay'}},
 {text:'Next',actions:[{id:'replay-next',label:'Next'},{id:'replay-stop',label:'Stop replay'}]},
 {text:'Confirm',confirmation:{text:'continue rush on',point:{row:9,col:9}}},
 {text:'Confirm',confirmation:{text:'continue push on',point:{row:9,col:9}}},
 {text:'Confirm',confirmation:{text:'move commander to',point:{row:9,col:9}}},
 {text:'Confirm',confirmation:{text:'project new piece to',point:{row:9,col:9}}},
 {text:'Confirm',confirmation:{text:'rush piece to',point:{row:9,col:9}}},
 {text:'Confirm',confirmation:{text:'push piece onto',point:{row:9,col:9}}},
 {text:'Confirm',confirmation:{text:'follow piece to',point:{row:9,col:9}}},
 {text:'Confirm',confirmation:{text:'retreat piece to',point:{row:9,col:9}}},
 {text:'Confirm',confirmation:{text:'move to',point:{row:9,col:9}}},
 'Select a retreat','Opponent’s supply and command lines','Supply and command lines',
 'Command lines','Supply lines','No command connection','No supply connection',
 'No connection','Waiting for the game','Waiting for your opponent',
 'Loading play','Play could not finish loading',
 'Computer needs a hand','Computer needs help','Computer is making their move',
 'Computer is thinking','Computer is saving their move','Computer is paused','Waiting for Computer',
 'Babs needs a hand','Babs needs help','Babs is making their move',
 'Babs is thinking','Babs is saving their move','Babs is paused','Waiting for Babs',
 'Horus needs a hand','Horus needs help','Horus is making their move',
 'Horus is thinking','Horus is saving their move','Horus is paused','Waiting for Horus',
 'Tau needs a hand','Tau needs help','Tau is making their move',
 'Tau is thinking','Tau is saving their move','Tau is paused','Waiting for Tau',
 {text:'MMMMMMMMMMMMMMMM to play',actorName:'MMMMMMMMMMMMMMMM'},
 {text:'MMMMMMMMMMMMMMMM is making their move',actorName:'MMMMMMMMMMMMMMMM'},
 {text:'MMMMMMMMMMMMMMMM needs help',actorName:'MMMMMMMMMMMMMMMM',action:{id:'retry-confirmed-playback',label:'Retry'}},
].map(value=>typeof value==='string'?{text:value}:value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const signatures=models=>models.map(model=>JSON.stringify(canonical(model))).sort();

test('finite sizing models preserve every independent prompt, action, coordinate, badge and actor state',()=>{
 assert.equal(expectedModels.length,79,'The explicitly reviewed contract contains 79 semantic rows');
 assert.deepEqual(signatures(boardPromptSizingModels()),signatures(expectedModels));
});

test('the real two-font sizing output passes the complete inventory and unchanged per-pattern caps',()=>{
 const html=renderBoardMessageSlot();
 const rows=[...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].flatMap(([,opening])=>{
  const font=opening.match(/data-sizing-font="([^"]+)"/),variant=opening.match(/data-sizing-variant="([^"]+)"/);
  return font&&variant?[{font:font[1],variant:variant[1],pattern:opening.match(/data-prompt-pattern="([^"]+)"/)?.[1]??null,height:20,lineHeight:24,minHeight:0}]:[];
 });
 // These synthetic dimensions exercise the pure oracle only. Native geometry,
 // fonts, input and material paint remain separate unchanged browser evidence.
 const result=validateFontEnvelope({width:366.8125,outerPadding:0,rows},{width:366.8125,rows});
 assert.deepEqual(result.violations,[]);
 assert.equal(result.budget.rows.length,158);
});
