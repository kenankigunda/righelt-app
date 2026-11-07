import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { digest, digestBuffer, sealReceipt, sourceIdentity } from "../receipts.mjs";

// Independent oracle, limited to small ordinary Buffers so the old allocation
// path fits. No custom serializer is active when this oracle is used for bytes.
const legacyDigest = value =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const patterned = length => {
  const value = Buffer.alloc(length);
  for (let i = 0; i < length; i++) value[i] = i % 256;
  return value;
};

test("trusted Buffer hash matches legacy empty, single-byte and all-256 encodings", () => {
  assert.equal(digestBuffer(Buffer.alloc(0)), legacyDigest(Buffer.alloc(0)));
  for (let byte = 0; byte < 256; byte++) {
    const value = Buffer.from([byte]);
    assert.equal(digestBuffer(value), legacyDigest(value), `byte ${byte}`);
  }
  const all = patterned(256);
  assert.equal(digestBuffer(all), legacyDigest(all));
  assert.notEqual(digestBuffer(all), crypto.createHash("sha256").update(all).digest("hex"));
});

test("trusted Buffer hash preserves separators at chunk boundaries and neighbors", () => {
  // External chunk-size contract; do not import an implementation constant.
  for (const length of [16383, 16384, 16385, 32767, 32768, 32769]) {
    const value = patterned(length);
    assert.equal(digestBuffer(value), legacyDigest(value), `length ${length}`);
  }
  const backing = patterned(32773);
  const view = backing.subarray(3, 32772);
  assert.equal(digestBuffer(view), legacyDigest(view), "nonzero-offset view");
});

test("seeded random Buffers match the independent legacy JSON oracle", () => {
  let seed = 0x6d2b79f5;
  for (const length of [0, 1, 2, 7, 31, 257, 4093, 16381, 16387, 65551]) {
    const value = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      value[i] = seed >>> 24;
    }
    assert.equal(digestBuffer(value), legacyDigest(value), `length ${length}`);
  }
});

test("explicit helper ignores a throwing own toJSON while generic digest honors it", () => {
  const value = Buffer.from([0, 128, 255]);
  const expected = legacyDigest(value);
  const failure = new Error("custom serialization must not run in trusted helper");
  let calls = 0;
  value.toJSON = () => { calls++; throw failure; };
  assert.equal(digestBuffer(value), expected);
  assert.equal(calls, 0);
  assert.throws(() => digest(value), error => error === failure);
  assert.equal(calls, 1);
});

test("trusted helper bounds workspace without full JSON, arrays or byte copies", t => {
  const value = Buffer.alloc(1024 * 1024, 255);
  let toJSONCalls = 0;
  value.toJSON = () => { toJSONCalls++; throw Error("Buffer.toJSON invoked"); };
  // Independent bounded decimal oracle; no input-sized number array/string.
  const expectedHash = crypto.createHash("sha256");
  expectedHash.update('{"type":"Buffer","data":[255');
  const block = ",255".repeat(1024);
  for (let remaining = value.length - 1; remaining > 0;) {
    const count = Math.min(remaining, 1024);
    expectedHash.update(count === 1024 ? block : ",255".repeat(count));
    remaining -= count;
  }
  const expected = expectedHash.update("]}").digest("hex");
  const createHash = crypto.createHash;
  const sizes = [];
  t.mock.method(crypto, "createHash", (...args) => {
    const hash = createHash(...args), update = hash.update;
    hash.update = function (data, ...rest) {
      assert.equal(typeof data, "string");
      assert.ok(data.length <= 65536, `oversized update ${data.length}`);
      sizes.push(data.length);
      return update.call(this, data, ...rest);
    };
    return hash;
  });
  syncBuiltinESMExports();
  const forbidden = () => { throw Error("full serialization/allocation attempted"); };
  t.mock.method(JSON, "stringify", forbidden);
  for (const method of ["alloc", "allocUnsafe", "allocUnsafeSlow", "from", "concat"])
    t.mock.method(Buffer, method, forbidden);
  t.mock.method(Array, "from", forbidden);
  try {
    assert.equal(digestBuffer(value), expected);
    assert.equal(toJSONCalls, 0);
    assert.equal(sizes.length, 66); // prefix + 64 payloads + suffix
    assert.equal(sizes.reduce((sum, length) => sum + length, 0), 4 * value.length + 26);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("explicit trusted contract rejects non-Buffer inputs", () => {
  for (const value of [null, undefined, "log", [1, 2], { type: "Buffer", data: [1] }, new Uint8Array([1]), new DataView(new ArrayBuffer(1))])
    assert.throws(() => digestBuffer(value), TypeError);
});

test("generic digest keeps ordinary JSON values, nested Buffers and errors", () => {
  for (const value of [
    null, false, 42, NaN, Infinity, "primary log\n\"quoted\"",
    [1, undefined, "two"], { nested: { b: 2, a: [true, null] } },
    new Uint8Array([0, 128, 255]), new Uint16Array([256, 65535]),
    { nested: Buffer.from([1, 255]) },
    { toJSON(key) { return { key, custom: "object" }; } },
  ]) assert.equal(digest(value), legacyDigest(value));
  const circular = {}; circular.self = circular;
  for (const value of [undefined, () => {}, Symbol("not JSON"), 1n, circular]) {
    assert.throws(() => legacyDigest(value), TypeError);
    assert.throws(() => digest(value), TypeError);
  }
});

test("generic own Buffer serializer retains receiver, key, getter count and result", () => {
  const value = Buffer.from([5]);
  const expectedBytes = legacyDigest(value);
  let reads = 0, calls = 0;
  Object.defineProperty(value, "toJSON", { get() {
    reads++;
    return function (key) { calls++; assert.equal(this, value); return { key, custom: 5 }; };
  } });
  assert.equal(digest(value), legacyDigest({ key: "", custom: 5 }));
  assert.equal(reads, 1); assert.equal(calls, 1);
  assert.equal(digestBuffer(value), expectedBytes);
  assert.equal(reads, 1); assert.equal(calls, 1);
  for (const override of [undefined, null, false, "literal"]) {
    const input = Buffer.from([2, 255]); input.toJSON = override;
    assert.equal(digest(input), legacyDigest(input));
  }
});

test("generic pre-import prototype custom serializers are preserved in fresh processes", () => {
  const moduleURL = new URL("../receipts.mjs", import.meta.url).href;
  for (const mode of ["function", "getter"]) {
    const script = `
      import assert from 'node:assert/strict';
      import {createHash} from 'node:crypto';
      const input=Buffer.from([0,255]);
      const standard=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const custom=createHash('sha256').update(JSON.stringify({custom:true})).digest('hex');
      let calls=0,reads=0;
      const serializer=function(key){calls++;assert.equal(this,input);assert.equal(key,'');return {custom:true};};
      Object.defineProperty(Buffer.prototype,'toJSON',${JSON.stringify(mode)}==='getter'
        ? {configurable:true,get(){reads++;return serializer;}}
        : {configurable:true,writable:true,value:serializer});
      const {digest,digestBuffer}=await import(${JSON.stringify(moduleURL)});
      assert.equal(calls,0);assert.equal(reads,0);
      assert.equal(digest(input),custom);assert.equal(calls,1);
      assert.equal(reads,${mode === "getter" ? 1 : 0});
      assert.equal(digestBuffer(input),standard);assert.equal(calls,1);
      assert.equal(reads,${mode === "getter" ? 1 : 0});
      process.stdout.write('ok');
    `;
    assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }), "ok");
  }
});

test("subclass serializers and length shadows affect generic JSON only", () => {
  class CustomBuffer extends Buffer {
    toJSON(key) { return { key, subclass: [...this] }; }
  }
  const input = Buffer.from([3, 200]);
  const expected = legacyDigest(input);
  Object.setPrototypeOf(input, CustomBuffer.prototype);
  assert.equal(digest(input), legacyDigest(input));
  assert.equal(digestBuffer(input), expected);
  Object.defineProperty(input, "length", { value: 1 });
  assert.equal(digest(input), legacyDigest(input));
  assert.equal(digestBuffer(input), expected, "native byte length ignores the shadow");
});

test("generic proxy serialization retains its observable property reads", () => {
  const reads = [];
  const value = new Proxy({ a: 1, nested: [2, 3] }, {
    get(target, key, receiver) { reads.push(["get", String(key)]); return Reflect.get(target, key, receiver); },
    getPrototypeOf(target) { reads.push(["prototype"]); return Reflect.getPrototypeOf(target); },
    ownKeys(target) { reads.push(["keys"]); return Reflect.ownKeys(target); },
  });
  const expected = legacyDigest(value), expectedReads = reads.slice();
  reads.length = 0;
  assert.equal(digest(value), expected);
  assert.deepEqual(reads, expectedReads);
});

test("receipt integrity and trusted log hashes keep legacy standard identities", () => {
  const raw = Buffer.from("primary log\n");
  const receipt = {
    version: 1, revision: "exact-revision", testedTree: "exact-tree",
    sourceFingerprint: "fingerprint", logHash: digestBuffer(raw),
    runtime: { node: "22.23.4", pnpm: "9.15.9" },
    dependencies: { lockHash: "source-lock", installedLockHash: "installed-lock" },
    status: "passed", exitCode: 0,
  };
  assert.equal(receipt.logHash, legacyDigest(raw));
  assert.deepEqual(sealReceipt(receipt), { ...receipt, integrity: legacyDigest(receipt) });
});

test("generic sourceIdentity retains legacy file and aggregate fingerprints", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "righelt-buffer-digest-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git("init", "-q"); git("config", "user.name", "Receipt test");
    git("config", "user.email", "receipt@example.invalid");
    const raw = patterned(257);
    await writeFile(path.join(cwd, "source.bin"), raw);
    git("add", "source.bin"); git("commit", "-qm", "fixture");
    const identity = sourceIdentity(cwd);
    assert.equal(identity.sourceFingerprint, legacyDigest([["source.bin", legacyDigest(raw)]]));
    assert.equal(identity.revision, git("rev-parse", "HEAD"));
    assert.equal(identity.testedTree, git("rev-parse", "HEAD^{tree}"));
    assert.equal(identity.sourceClean, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
