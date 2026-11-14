import test from 'node:test';
import assert from 'node:assert/strict';
import {playerEmblemSeed,renderPlayerEmblem} from '../shell/player-emblem.js';
test('player emblems use canonical usernames and never place input in markup',()=>{
 assert.equal(renderPlayerEmblem('Alice'),renderPlayerEmblem(' alice '));
 assert.notEqual(renderPlayerEmblem('Alice'),renderPlayerEmblem('Bob'));
 assert.notEqual(playerEmblemSeed('Alice'),playerEmblemSeed('Bob'));
 assert.doesNotMatch(renderPlayerEmblem('<script>alert(1)</script>'),/<script|alert/);
 assert.match(renderPlayerEmblem('Alice'),/aria-hidden="true"/);
 const emblem=renderPlayerEmblem('Alice');
 assert.match(emblem,/player-emblem-tile/);
 assert.ok(new Set([...emblem.matchAll(/fill="(#[0-9a-f]+)"/g)].map(match=>match[1])).size>1);
 assert.doesNotMatch(emblem,/currentColor|player-p1|player-p2/);
});
