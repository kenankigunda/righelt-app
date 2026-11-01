import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedResultHeading,capturedResultHeading} from '../result-heading.mjs';

test('source-selected contracts assert exact winner and loser perspective for either side', () => {
  for (const [contract, win, loss] of [['legacy', 'Win', 'Loss'], ['perspective-v1', 'You won', 'Your opponent won']]) {
    for (const [outcome, winner, loser] of [['p1_win', 'p1', 'p2'], ['p2_win', 'p2', 'p1']]) {
      assert.equal(expectedResultHeading({contract, outcome, viewerSide: winner}), win);
      assert.equal(expectedResultHeading({contract, outcome, viewerSide: loser}), loss);
    }
  }
});

test('draws and neutral observers retain their exact contracts independently of player perspective', () => {
  for (const contract of ['legacy', 'perspective-v1']) {
    for (const viewerSide of [null, 'p1', 'p2']) assert.equal(expectedResultHeading({contract, outcome: 'draw', viewerSide}), 'Draw');
    assert.equal(expectedResultHeading({contract, outcome: 'p1_win'}), 'Player 1 wins');
    assert.equal(expectedResultHeading({contract, outcome: 'p2_win'}), 'Player 2 wins');
  }
});

test('unknown contracts, nonterminal states and invalid sides fail instead of weakening assertions', () => {
  for (const options of [{contract: 'future-v2', outcome: 'p1_win'}, {outcome: 'ongoing'}, {outcome: 'p1_win', viewerSide: 'Player 1'}]) {
    assert.throws(() => expectedResultHeading(options));
  }
});


test('named observer results require the captured name and retain exact seated and both-side perspective', () => {
  for(const [outcome,side] of [['p1_win','p1'],['p2_win','p2']]) {
    for(const winnerName of ['Guest 1','Guest 2','Horus','名字 <&> שלום']) {
      assert.equal(expectedResultHeading({contract:'perspective-v2',outcome,winnerName}),`${winnerName} won`);
    }
    assert.equal(expectedResultHeading({contract:'perspective-v2',outcome,viewerSide:side}),'You won');
    assert.equal(expectedResultHeading({contract:'perspective-v2',outcome,viewerSide:side==='p1'?'p2':'p1'}),'Your opponent won');
    assert.equal(expectedResultHeading({contract:'perspective-v2',outcome,controlsBothSides:true}),'You won');
    for(const winnerName of [undefined,null,'','  '])assert.throws(()=>expectedResultHeading({contract:'perspective-v2',outcome,winnerName}));
  }
  assert.equal(expectedResultHeading({contract:'perspective-v2',outcome:'draw'}),'Draw');
  assert.throws(()=>expectedResultHeading({contract:'perspective-v1',outcome:'p1_win',controlsBothSides:true}));
});

test('named result v3 preserves exact canonical names, nonvisual colors and actual self-play winner seats',()=>{
 for(const [outcome,winner,color] of [['p1_win','p1','Red'],['p2_win','p2','Blue']]) {
  assert.equal(expectedResultHeading({contract:'named-perspective-v3',outcome,viewerSide:winner}),`${color}: You won`);
  for(const winnerName of ['Guest 1','Horus','Red <&> שלום']) {
   assert.equal(expectedResultHeading({contract:'named-perspective-v3',outcome,winnerName}),`${color}: ${winnerName} won`);
   assert.equal(expectedResultHeading({contract:'named-perspective-v3',outcome,winnerName,selfPlay:true}),`${winnerName} won as ${color}`);
   assert.equal(expectedResultHeading({contract:'named-perspective-v3',outcome,winnerName,viewerSide:winner==='p1'?'p2':'p1'}),`${color}: ${winnerName} won`);
  }
  assert.equal(expectedResultHeading({contract:'named-perspective-v3',outcome,controlsBothSides:true,selfPlay:true}),`You won as ${color}`);
  assert.throws(()=>expectedResultHeading({contract:'named-perspective-v3',outcome}));
  assert.throws(()=>expectedResultHeading({contract:'named-perspective-v3',outcome,controlsBothSides:true}));
 }
 assert.equal(expectedResultHeading({contract:'named-perspective-v3',outcome:'draw'}),'Draw');
});


test('acknowledged result context keeps human identities and computer profiles distinct',()=>{
 const game={player1:{identityId:'a'},player2:{identityId:'b'},board:{state:{outcome:{status:'p1_win'}}}};
 const options={contract:'named-perspective-v3',viewerSide:'p2'};
 assert.equal(capturedResultHeading(game,options).winnerName,'Guest 1');
 assert.equal(capturedResultHeading({...game,player1:null},options).winnerName,'Guest');
 const named={...game,player1:{identityId:'a',profile:{displayName:'Blue <&> שלום'}},player2:{identityId:'a',profile:{displayName:'Blue <&> שלום'}},selfPlayMode:true};
 assert.deepEqual(capturedResultHeading(named,{...options,controlsBothSides:true}),{...options,outcome:'p1_win',controlsBothSides:true,selfPlay:true,winnerName:'Blue <&> שלום'});
 const computer={...named,computer:{seats:{p1:'babs',p2:null},manual:true}};
 const captured=capturedResultHeading(computer,options);
 assert.equal(captured.winnerName,'Babs');assert.equal(captured.selfPlay,false);
 assert.equal(expectedResultHeading(captured),'Red: Babs won');
 assert.throws(()=>capturedResultHeading({...game,computer:{seats:{p1:'unknown'}}},options));
 assert.throws(()=>capturedResultHeading({...game,board:{state:{outcome:{status:'ongoing'}}}},options));
});
