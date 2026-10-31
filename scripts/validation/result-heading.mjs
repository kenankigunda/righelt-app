import assert from 'node:assert/strict';
import {RESULT_HEADING_CONTRACTS} from './result-heading-contract.mjs';
import {expect} from '@playwright/test';

// Choose the exact accessible heading contract before the journey. A failed heading assertion
// never switches to another contract or accepts both old and new copy.
export function expectedResultHeading({contract = 'legacy', outcome, viewerSide = null, winnerName, controlsBothSides = false, selfPlay = false}) {
  assert.ok(contract === 'legacy' || RESULT_HEADING_CONTRACTS.includes(contract), 'Unsupported result heading contract');
  assert.ok(['p1_win', 'p2_win', 'draw'].includes(outcome), 'Expected a terminal outcome');
  assert.ok([null, 'p1', 'p2'].includes(viewerSide), 'Expected a player side or neutral observer');
  assert.equal(typeof controlsBothSides, 'boolean', 'Expected explicit both-side ownership');
  assert.ok(!controlsBothSides || ['perspective-v2','named-perspective-v3'].includes(contract), 'Both-side ownership requires the named result contract');
  assert.equal(typeof selfPlay, 'boolean', 'Expected explicit self-play context');
  if (contract === 'named-perspective-v3') assert.ok(!controlsBothSides || selfPlay, 'Both-side ownership requires captured human self-play');
  if (outcome === 'draw') return 'Draw';
  const winner = outcome.slice(0, 2);
  if (contract === 'named-perspective-v3') {
    const color=winner==='p1'?'Red':'Blue';
    const own=controlsBothSides || viewerSide===winner;
    if(!own)assert.ok(typeof winnerName==='string' && winnerName.trim().length>0, 'Named result requires the captured winner name');
    const actor=own?'You':winnerName;
    return selfPlay ? `${actor} won as ${color}` : `${color}: ${actor} won`;
  }
  if (controlsBothSides) return 'You won';
  if (viewerSide === null && contract === 'perspective-v2') {
    assert.ok(typeof winnerName === 'string' && winnerName.trim().length > 0, 'Named observer result requires the captured winner name');
    return `${winnerName} won`;
  }
  if (viewerSide === null) return `Player ${winner === 'p1' ? '1' : '2'} wins`;
  const won = viewerSide === winner;
  return contract !== 'legacy' ? won ? 'You won' : 'Your opponent won' : won ? 'Win' : 'Loss';
}

// Independently derive the expected identity from acknowledged API data, never candidate JS.
export function capturedResultHeading(game,{contract,viewerSide=null,controlsBothSides=false}={}) {
  const outcome=game?.board?.state?.outcome?.status;
  assert.ok(['p1_win','p2_win','draw'].includes(outcome),'Expected an acknowledged terminal game');
  const winner=outcome==='draw'?null:outcome.slice(0,2);
  const person=side=>game[side==='p1'?'player1':'player2'];
  const profile=side=>person(side)?.computerProfile || game.computer?.seats?.[side];
  const computerNames={babs:'Babs',tau:'Tau',horus:'Horus'};
  const name=side=>{
    if(profile(side)){assert.ok(computerNames[profile(side)],'Unrecognized captured computer profile');return computerNames[profile(side)];}
    const named=person(side)?.profile;
    const pair=['p1','p2'].every(owner=>Boolean(person(owner))&&!profile(owner)&&!person(owner)?.profile?.displayName&&!person(owner)?.profile?.username);
    return named?.displayName || named?.username || (pair?`Guest ${side==='p1'?1:2}`:'Guest');
  };
  const selfPlay=Boolean(game.selfPlayMode && game.player1?.identityId && game.player1.identityId===game.player2?.identityId && !profile('p1')&&!profile('p2'));
  return {contract,outcome,viewerSide,controlsBothSides,selfPlay,...(winner?{winnerName:name(winner)}:{})};
}

export async function assertResultHeading(result, options, assertionOptions) {
  await expect(result.getByRole('heading', {name: expectedResultHeading(options), exact: true})).toBeVisible(assertionOptions);
}
