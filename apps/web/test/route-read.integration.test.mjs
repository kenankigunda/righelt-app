import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRouteHydration} from '../shell/route-hydration.js';
import {parseRouteFromHash} from '../shell/routes.js';

const source = readFileSync(new URL('../shell/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const captureRouteRead =');
const end = source.indexOf('const retryAccountContinuation =', start);
assert.ok(start > 0 && end > start);
const script = new vm.Script(`${source.slice(start, end)};({captureRouteRead,syncRouteDataAndLiveChannels})`);

test('an authority microtask before hashchange cannot share a home read under an invitation URL', async () => {
  const calls = [], owner = {
    resolveInvite: async token => { calls.push(['invite', token]); return {gameId:'invited-game'}; },
    loadGame: async id => { calls.push(['game', id]); },
  };
  const context = vm.createContext({
    account:{snapshot:()=>({generation:2})}, window:{location:{hash:'#/invite/cold-invite'}},
    transport:owner, currentRoute:parseRouteFromHash('#/'), resolvedInvite:null,
    getVisibleHomeSectionKeys:()=>[], getHomeSection:()=>{}, getHomeSectionVisiblePageSize:()=>0, getHomeSectionColumnCount:()=>1,
    hydrateRoute:createRouteHydration(), parseRouteFromHash,
    syncHomeSections:async()=>{calls.push(['home']);}, syncLiveChannels:()=>{},
  });
  const api = script.runInContext(context);
  // Location has changed but the browser has not delivered hashchange yet.
  const authorityRead = api.syncRouteDataAndLiveChannels();
  context.currentRoute = parseRouteFromHash(context.window.location.hash);
  const hashchangeRead = api.syncRouteDataAndLiveChannels();
  assert.equal(authorityRead, hashchangeRead, 'the same actual URL still shares one read');
  await authorityRead;
  assert.deepEqual(calls, [['invite','cold-invite'],['game','invited-game']]);
  assert.equal(context.resolvedInvite.gameId, 'invited-game');
});

test('captured game routes follow the URL rather than a previous invitation route', () => {
  const context = vm.createContext({account:{snapshot:()=>({generation:3})}, window:{location:{hash:'#/game/current-game?panel=history'}},
    transport:{}, currentRoute:parseRouteFromHash('#/invite/previous'), getVisibleHomeSectionKeys:()=>[],
    hydrateRoute:createRouteHydration(), parseRouteFromHash});
  const read = script.runInContext(context).captureRouteRead();
  assert.equal(read.route.name,'game'); assert.equal(read.route.gameId,'current-game');
  assert.equal(read.hash,'#/game/current-game?panel=history');
});
