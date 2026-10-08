import test from 'node:test';import assert from 'node:assert/strict';
import {invitationOptions} from '../shell/invitations.js';import {parseRouteFromHash,buildHashForRoute} from '../shell/routes.js';
test('open seat and viewing invitations keep separate tokens and player colors',()=>{
 const game={id:'a',player1:{identityId:'host'},player2:null,inviteToken:'player-token',inviteTokens:{viewer:'viewer-token'}};
 assert.deepEqual(invitationOptions(game).map(o=>[o.role,o.token]),[['blue','player-token'],['viewer','viewer-token']]);
 assert.equal(invitationOptions({...game,player1:null,player2:{}})[0].role,'red');
 assert.deepEqual(invitationOptions({...game,player2:{}}).map(o=>o.role),['viewer']);
});
test('invitation intent survives arrival without replacing token authorization',()=>{
 for(const role of ['red','blue','viewer'])assert.deepEqual(parseRouteFromHash(`#/invite/token?as=${role}`),{name:'invite',inviteToken:'token',inviteAs:role,debug:false,scenarios:false});
 assert.equal(parseRouteFromHash('#/invite/token?as=admin').inviteAs,undefined);
});

test('normalizing an invitation preserves recipient intent',()=>{for(const role of ['red','blue','viewer']){const parsed=parseRouteFromHash(`#/invite/token?as=${role}`);assert.deepEqual(parseRouteFromHash(buildHashForRoute(parsed)),parsed);}});
