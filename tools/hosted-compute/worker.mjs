import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client, InfrastructureError } from './client.mjs';
import { POLICY, assert, canonical, encode, safeRunPath, sha256 } from './policy.mjs';

import { executionIdentity, verifyResult } from './result.mjs';
import {probeRuntime,verifyRuntime,runtimeEnvironment} from './runtime.mjs';

const exec = promisify(execFile);
// Uploads have bounded request timeouts. Renew at the ordinary heartbeat
// cadence rather than saving the whole controller ledger once per file.
export function snapshotLeaseRenewal(heartbeat, clock = Date.now) {
  let renewedAt = -Infinity;
  return async () => {
    if (clock() - renewedAt < POLICY.heartbeatMs) return;
    await heartbeat(); renewedAt = clock();
  };
}
export async function containedFile(root, relative, { createParents = false } = {}) {
  assert(safeRunPath(relative), 'unsafe run path');
  let parent = root;
  for (const part of relative.split('/').slice(0, -1)) {
    parent = path.join(parent, part);
    if (createParents) {
      try { await fs.lstat(parent); } catch (e) { if (e.code !== 'ENOENT') throw e; await fs.mkdir(parent, { mode: 0o700 }); }
    }
    const st = await fs.lstat(parent); assert(st.isDirectory() && !st.isSymbolicLink(), 'run path contains a symlink');
  }
  const target = path.join(root, relative);
  try { const st = await fs.lstat(target); assert(st.isFile() && !st.isSymbolicLink(), 'artifact is not a regular file'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}
async function walk(root, relative) {
  const list = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = `${relative}/${entry.name}`;
    assert(!entry.isSymbolicLink(), 'symlink in checkpoint tree');
    if (entry.isDirectory()) list.push(...await walk(root, name));
    else if (entry.isFile() && !entry.name.endsWith('.lock') && !entry.name.endsWith('.tmp')) list.push(name);
  }
  return list.sort();
}
export async function publishSnapshot(client, root, runDir, sourceRoot = root, requireFresh = true, renew = async () => {}) {
  const latestPath = await containedFile(root, `${runDir}/latest.json`);
  let before;
  try { before = await fs.readFile(latestPath); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const latest = JSON.parse(before), checkpoint = path.relative(sourceRoot, latest.checkpoint);
  assert(safeRunPath(checkpoint) && checkpoint.startsWith(runDir + '/'), 'checkpoint outside campaign run');
  const cp = await fs.readFile(await containedFile(root, checkpoint));
  assert(await sha256(cp) === latest.sha256, 'checkpoint payload changed');
  const files = [];
  const capturedAt = requireFresh ? Math.min(Date.now(), (await fs.stat(latestPath)).mtimeMs) : Date.now();
  if (Date.now() - capturedAt >= POLICY.checkpointMs) return null;
  for (const relative of await walk(root, runDir)) {
    await renew();
    const target = await containedFile(root, relative), bytes = await fs.readFile(target);
    assert(bytes.length <= POLICY.maxObjectBytes, 'split oversized artifacts before hosted execution');
    const a = await client.upload(bytes); files.push({ ...a, path: relative });
  }
  assert(before.equals(await fs.readFile(latestPath)), 'checkpoint changed during publication');
  const snapshot = { id: randomUUID(), capturedAt: Math.floor(capturedAt), files };
  await client.json('snapshot', snapshot); return snapshot;
}
async function hydrate(client, root, files) {
  for (const a of files) {
    const target = await containedFile(root, a.path, { createParents: true });
    const bytes = await client.download(a);
    await fs.writeFile(target, bytes, { mode: 0o600 });
  }
}
export async function runWorker({ env = process.env, root = process.cwd(), client, clock = Date.now, cleanup, snapshotter, runtimeProbe=probeRuntime } = {}) {
  root = await fs.realpath(root);
  client ??= new Client({ url: env.COMPUTE_URL, id: env.COMPUTE_ID, token: env.COMPUTE_WORKER_TOKEN, generation: Number(env.COMPUTE_GENERATION) });
  const work = await client.json('work'), { manifest, phase } = work;
  assert(await sha256(encode(canonical(manifest))) === work.manifestSha256, 'campaign manifest changed');
  const imageIdentity = JSON.parse(await fs.readFile(path.join(root, '.compute-source.json'), 'utf8'));
  assert(imageIdentity.sourceRevision === manifest.sourceRevision && imageIdentity.dependencySha256 === manifest.dependencySha256, 'container/source provenance mismatch');
  let runtime;
  if(phase.device==='cuda'){
    try{runtime=await verifyRuntime(await runtimeProbe(root,env),imageIdentity,manifest);}
    catch{
      await client.json('finish',{kind:'correctness',outputs:{},files:[]});
      return {kind:'correctness',exitCode:null,reason:'unqualified CUDA runtime before input hydration'};
    }
  }
  await hydrate(client, root, manifest.inputs);
  if (work.snapshot) await hydrate(client, root, work.snapshot.files);
  if(runtime)await fs.writeFile(await containedFile(root,`${phase.runDir}/runtime-${work.generation}.json`,{createParents:true}),canonical(runtime)+'\n',{flag:'wx',mode:0o600});
  // Completed durable phase evidence is reusable, with its original identity.
  // Do not rerun immutable jobs or relabel it as work from this generation.
  if (work.snapshot?.phaseIndex === work.phaseIndex && phase.outputs.every(name => work.snapshot.files.some(f => f.path === phase.outputPaths[name]))) {
    await client.json('heartbeat', { restoredSnapshotId: work.snapshot.id });
    const outputs = {};
    try {
      for (const name of phase.outputs) {
        const a = work.snapshot.files.find(f => f.path === phase.outputPaths[name]);
        const raw = await fs.readFile(await containedFile(root, a.path));
        assert(await sha256(raw) === a.sha256, 'restored receipt changed');
        await verifyResult(JSON.parse(raw), { manifest, manifestSha256: work.manifestSha256, phase, generation: work.generation, snapshot: work.snapshot, expect: phase.expect[name], rawSha256: a.sha256, read: async record => fs.readFile(await containedFile(root, record.path)) });
        outputs[name] = a;
      }
    } catch (error) {
      await client.json('finish', { kind: 'correctness', outputs: {}, files: work.snapshot.files });
      return { kind: 'correctness', exitCode: null, reason: error.message };
    }
    await client.json('finish', { kind: 'complete', outputs, files: work.snapshot.files });
    return { kind: 'complete', exitCode: 0, recoveredCompletedPhase: true };
  }
  const logRelative = `${phase.runDir}/hosted-${work.generation}.log`;
  const logPath = await containedFile(root, logRelative, { createParents: true });
  const output = createWriteStream(logPath, { flags: 'ax', mode: 0o600 });
  const recipe = manifest.inputs.find(a => a.sha256 === manifest.recipeSha256);
  assert(recipe, 'approved recipe artifact missing');
  const contextPath = await containedFile(root, `${phase.runDir}/execution-context.json`, { createParents: true });
  const ready = await client.json('heartbeat', { restoredSnapshotId: work.snapshot?.id });
  await fs.writeFile(contextPath, JSON.stringify({ phaseDeadline:ready.phaseDeadline,phaseSeconds:phase.seconds,execution: executionIdentity(manifest, work.manifestSha256, phase, work.generation), completedWorkIds: phase.workIds, inputObjects:manifest.inputs, recoveryFiles: work.snapshot?.phaseIndex === work.phaseIndex ? work.snapshot.files : [] }), { mode: 0o600 });
  const executionRecipe = manifest.inputs.find(a => a.sha256 === manifest.executionRecipeSha256);
  assert(executionRecipe, 'execution recipe artifact missing');
  const failurePath = `${phase.runDir}/hosted-infrastructure-${work.generation}.json`;
  let lease = ready.leaseExpires;
  const argv = work.resume || work.snapshot?.phaseIndex === work.phaseIndex ? phase.resumeArgv : phase.argv;
  const child = spawn(argv[0], argv.slice(1), { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...runtimeEnvironment(env), LANG: 'C.UTF-8', PYTHONPATH: 'tools/ai-trainer',
    RIGHELT_TRAINING_DEVICE: phase.device, RIGHELT_HOSTED: '1',
    ...(manifest.portableClosureSha256 ? {RIGHELT_PORTABLE_CLOSURE_PATH:path.join(root,manifest.inputs.find(a=>a.sha256===manifest.portableClosureSha256).path),RIGHELT_PORTABLE_CLOSURE_SHA256:manifest.portableClosureSha256,RIGHELT_PORTABLE_ROOT:root}:{}),
    RIGHELT_EXPECTED_RECIPE_PATH: path.join(root, recipe.path), RIGHELT_EXPECTED_RECIPE_SHA256: manifest.recipeSha256,
    RIGHELT_EXECUTION_CONTEXT: contextPath,
    RIGHELT_EXECUTION_RECIPE_PATH: path.join(root, executionRecipe.path), RIGHELT_EXECUTION_RECIPE_SHA256: manifest.executionRecipeSha256,
    RIGHELT_HOSTED_FAILURE_FILE: path.join(root, failurePath),
    COMPUTE_URL: env.COMPUTE_URL, COMPUTE_ID: env.COMPUTE_ID, COMPUTE_GENERATION: env.COMPUTE_GENERATION,
    COMPUTE_WORKER_TOKEN: env.COMPUTE_WORKER_TOKEN,
  } });
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
  let done = false, exitCode = null, failure = null;
  const exited = new Promise(resolve => {
    child.once('error', () => { failure = 'infrastructure'; done = true; resolve(); });
    child.once('exit', code => { exitCode = code; done = true; resolve(); });
  });
  let watchdog;
  const stop = async () => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    // Trainer children create their own sessions. Their ownership ledger, rather
    // than the immediate child group, establishes authority for final cleanup.
    if (cleanup) { await cleanup(); return; }
    await exec('tools/ai-trainer/.venv/bin/python', ['-m', 'righelt_training.hosted_cleanup', '--directory', phase.runDir], {
      cwd: root, env: { ...env, PYTHONPATH: 'tools/ai-trainer' }, timeout: 15000,
    });
  };
  const onSignal = () => { failure = 'infrastructure'; done = true; };
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  // This timer remains independent of upload/heartbeat requests.
  watchdog = setInterval(() => { if (clock() >= lease) { failure = 'infrastructure'; done = true; void stop().catch(() => {}); } }, 1000);
  const coherentSnapshot = async () => {
    if (phase.kind === 'training') {
      try { if (Date.now() - (await fs.stat(await containedFile(root, `${phase.runDir}/latest.json`))).mtimeMs >= POLICY.checkpointMs) return null; }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    }
    if (snapshotter) return snapshotter(client, root, phase.runDir);
    const args = ['-m', 'righelt_training.hosted_snapshot', '--root', root, '--directory', phase.runDir];
    if (!done) args.push('--pid', String(child.pid), '--parent', String(process.pid));
    const { stdout } = await exec('tools/ai-trainer/.venv/bin/python', args, { cwd: root, env: { ...env, PYTHONPATH: 'tools/ai-trainer' }, timeout: 30000 });
    const snapshotRoot = JSON.parse(stdout).directory;
    const renew = snapshotLeaseRenewal(async () => {
      lease = (await client.json('heartbeat', { restoredSnapshotId: work.snapshot?.id })).leaseExpires;
    }, clock);
    try { return await publishSnapshot(client, snapshotRoot, phase.runDir, root, phase.kind === 'training', renew); }
    finally { await fs.rm(snapshotRoot, { recursive: true }); }
  };
  const publishLog = async () => {
    const file = await fs.open(logPath, 'r');
    try {
      const size = (await file.stat()).size, bytes = new Uint8Array(Math.min(size, 64 * 1024));
      await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
      const log = await client.upload(bytes); await client.json('progress', { log });
    } finally { await file.close(); }
  };
  let lastLog = 0, lastSnapshot = clock();
  try {
    while (!done) {
      const delay = new Promise(resolve => setTimeout(resolve, POLICY.heartbeatMs).unref());
      await Promise.race([exited, delay]);
      if (done) break;
      try {
        lease = (await client.json('heartbeat', { restoredSnapshotId: work.snapshot?.id })).leaseExpires;
        if (clock() - lastLog >= POLICY.snapshotEveryMs) { await publishLog(); lastLog = clock(); }
        if (clock() - lastSnapshot >= POLICY.snapshotEveryMs) {
          if (await coherentSnapshot()) lastSnapshot = clock();
        }
      } catch (error) { failure = error instanceof InfrastructureError ? 'infrastructure' : 'correctness'; break; }
    }
  } finally {
    clearInterval(watchdog); process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal);
    await stop(); await new Promise((resolve, reject) => { output.once('error', reject); output.end(resolve); });
  }
  const outputs = {}, files = []; let reason;
  try { if (JSON.parse(await fs.readFile(await containedFile(root, failurePath))).kind === 'infrastructure') failure = 'infrastructure'; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!failure && exitCode === 0) {
    try {
      for (const name of phase.outputs) {
        const raw = await fs.readFile(await containedFile(root, phase.outputPaths[name]));
        const evidence = JSON.parse(raw);
        await verifyResult(evidence, { manifest, manifestSha256: work.manifestSha256, phase, generation: work.generation, snapshot: work.snapshot, expect: phase.expect[name], rawSha256: await sha256(raw), read: async a => fs.readFile(await containedFile(root, a.path)) });
        for (const [key, expected] of Object.entries(phase.expect[name])) assert(canonical(evidence[key]) === canonical(expected), 'phase evidence failed');
        outputs[name] = await client.upload(raw);
      }
      // Keep the completed run bundle even when no latest pointer was written.
      for (const relative of await walk(root, phase.runDir)) {
        await client.json('heartbeat', {});
        files.push({ ...await client.upload(await fs.readFile(await containedFile(root, relative))), path: relative });
      }
      const finalSnapshot = await coherentSnapshot();
      if (phase.kind === 'training') assert(finalSnapshot, 'training completed without a fresh recoverable checkpoint');
    } catch (error) { failure = error instanceof InfrastructureError ? 'infrastructure' : 'correctness'; reason = error.message; }
  }
  try {
    await publishLog();
    if (failure || exitCode !== 0) {
      for (const relative of await walk(root, phase.runDir)) {
        await client.json('heartbeat', { restoredSnapshotId: work.snapshot?.id });
        files.push({ ...await client.upload(await fs.readFile(await containedFile(root, relative))), path: relative });
      }
    }
  } catch { /* Original failure classification survives a failed evidence upload. */ }
  await client.json('finish', { kind: failure ?? (exitCode === 0 ? 'complete' : 'correctness'), outputs, files });
  return { exitCode, reason, kind: failure ?? (exitCode === 0 ? 'complete' : 'correctness') };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorker().catch(() => { process.stderr.write('Hosted worker stopped. Inspect campaign status and retained evidence.\n'); process.exitCode = 1; });
}
