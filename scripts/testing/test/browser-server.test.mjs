import test from "node:test";
import assert from "node:assert/strict";
import {createBrowserServer} from "../browser-server.mjs";

test("missing browser assets return 404 without terminating subsequent fixture requests", async t => {
  const server=createBrowserServer();
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const missing=await fetch(`${origin}/apps/web/missing-browser-asset.js`);
  assert.equal(missing.status,404);
  await missing.text();
  const fixture=await fetch(`${origin}/browser-integration/support/recovery.html`);
  assert.equal(fixture.status,200);
  assert.match(await fixture.text(),/Recovery alerts/);
  const module=await fetch(`${origin}/apps/web/shell/game-alert.js`);
  assert.equal(module.status,200);
  assert.match(await module.text(),/renderGameAlertCard/);
  assert.equal(server.listening,true);
});
