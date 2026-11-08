import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { realpath, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolve the actual application SDK chain, without a transitive root alias.
// This known SDK defect is not proof of the cause of the Righelt CI failures.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rootRequire = createRequire(path.join(root, 'package.json'));
const wranglerPackage = await realpath(rootRequire.resolve('wrangler/package.json'));
const sdkRequire = createRequire(wranglerPackage);
const miniflarePackage = sdkRequire.resolve('miniflare/package.json');
assert.equal(JSON.parse(await readFile(wranglerPackage, 'utf8')).version, '4.67.0');
assert.equal(JSON.parse(await readFile(miniflarePackage, 'utf8')).version, '4.20260219.0');
const { Miniflare } = sdkRequire('miniflare');

test('actual Miniflare loopback preserves the same socket beyond Node idle timeout', {
  timeout: 20_000,
}, async (t) => {
  const defaults = http.createServer();
  const keepAliveTimeout = defaults.keepAliveTimeout;
  const keepAliveTimeoutBuffer = defaults.keepAliveTimeoutBuffer;
  defaults.close();
  assert.equal(keepAliveTimeout, 5_000);
  assert.equal(keepAliveTimeoutBuffer, 1_000);
  const idleMs = keepAliveTimeout + keepAliveTimeoutBuffer + 1_000;
  t.diagnostic(JSON.stringify({node: process.version, keepAliveTimeout, keepAliveTimeoutBuffer, idleMs}));
  let mf;
  let socket;
  // Own errors even between the two request listeners. They still fail the test.
  let socketError;
  try {
    mf = new Miniflare({
      port: 0,
      liveReload: true,
      modules: true,
      script: 'export default { fetch() { return new Response("<p>loopback</p>", {headers: {"Content-Type": "text/html;charset=utf-8"}}); } }',
    });
    const main = await mf.ready;
    const initial = await mf.dispatchFetch('http://localhost');
    assert.equal(initial.status, 200);
    // This is the actual SDK live-reload endpoint, not a second synthetic server.
    const script = await initial.text();
    const matches = [...script.matchAll(/\/\/ Miniflare Live Reload[\s\S]+?url\.port = (\d+)/g)];
    assert.equal(matches.length, 1, 'one actual loopback listener must be exposed');
    const port = Number(matches[0][1]);
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
    t.diagnostic(JSON.stringify({
      ownerPid: process.pid, ownerParentPid: process.ppid,
      mainPort: Number(new URL(main).port), loopbackPort: port,
      node: process.version, keepAliveTimeout, keepAliveTimeoutBuffer, idleMs,
    }));

    socket = net.connect(port, '127.0.0.1');
    socket.on('error', (error) => { socketError = error; });
    await once(socket, 'connect', { signal: AbortSignal.timeout(3_000) });
    // Raw TCP avoids an HTTP Agent applying its own advertised idle timeout.
    const read = () => new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const finish = (error, status) => {
        clearTimeout(deadline);
        socket.off('data', data); socket.off('close', closed); socket.off('error', failed);
        if (error) reject(error); else resolve(status);
      };
      const failed = (error) => finish(error);
      const closed = () => finish(new Error('loopback closed before a complete response'));
      const data = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 4096) return failed(new Error('unexpected loopback response size'));
        const boundary = buffer.indexOf('\r\n\r\n');
        if (boundary < 0) return;
        const header = buffer.subarray(0, boundary).toString('latin1');
        const status = /^HTTP\/1\.1 (\d{3}) /.exec(header);
        if (!status) return failed(new Error('invalid loopback HTTP response'));
        const length = /\r\ncontent-length: (\d+)(?:\r\n|$)/i.exec(header);
        const chunked = /\r\ntransfer-encoding: chunked(?:\r\n|$)/i.test(header);
        const body = buffer.subarray(boundary + 4);
        if (length) {
          const expected = Number(length[1]);
          if (body.length < expected) return;
          if (body.length !== expected) return failed(new Error('extra loopback response bytes'));
        } else if (chunked) {
          let cursor = 0;
          for (;;) {
            const end = body.indexOf('\r\n', cursor);
            if (end < 0) return;
            const token = body.subarray(cursor, end).toString('ascii');
            if (!/^[0-9a-f]+$/i.test(token)) return failed(new Error('invalid loopback chunk'));
            const count = Number.parseInt(token, 16);
            cursor = end + 2;
            if (body.length < cursor + count + 2) return;
            if (body.subarray(cursor + count, cursor + count + 2).toString() !== '\r\n')
              return failed(new Error('invalid loopback chunk terminator'));
            cursor += count + 2;
            if (count === 0) {
              if (cursor !== body.length) return failed(new Error('extra loopback chunk bytes'));
              break;
            }
          }
        } else return failed(new Error('loopback response lacks persistent framing'));
        finish(null, Number(status[1]));
      };
      const deadline = setTimeout(() => failed(new Error('loopback response timeout')), 3_000);
      socket.on('data', data); socket.once('close', closed); socket.once('error', failed);
      socket.write('GET /unknown HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
    });

    const first = await read();
    assert.equal(first, 404);
    assert.ok(!socket.destroyed);
    // The external defect is Node's 5s default; this is a real idle boundary,
    // not a gameplay/test-case deadline change or injected connection failure.
    // Include the 1s close buffer used by current Node22, without a pool/client timer.
    await delay(idleMs);
    assert.equal(socketError, undefined);
    assert.equal(socket.destroyed, false, 'original loopback socket closed during idle');
    const second = await read();
    assert.equal(second, 404);
    // Both writes used this single unreplaced net.Socket; reconnect is impossible.
  } finally {
    socket?.destroy();
    await mf?.dispose();
  }
});
