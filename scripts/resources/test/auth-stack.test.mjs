import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processTable, live } from '../system.mjs';
import { cleanupRecord } from '../registry.mjs';
import { stopAuthStackCommand } from '../../auth-stack-process.mjs';

const helper = new URL('../../auth-stack-process.mjs', import.meta.url).href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(50); }
  throw Error('Account stack cleanup did not finish');
}

test('account stack registers one-shot and service guardians before branching', async () => {
  const source = await readFile(new URL('../../e2e-auth-stack.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(stopping\) throw/);
  assert.match(source, /children\.add\(child\);\s*child\.on\("close", \(\) => children\.delete\(child\)\);\s*if \(service\)/);
  assert.match(source, /await Promise\.all\(\[\.\.\.children\]\.map\(stopAuthStackCommand\)\)/);
});

test('failed guardian cannot be reported as successful cleanup', async () => {
  assert.equal(await stopAuthStackCommand({exitCode:1,signalCode:null}), false);
  assert.equal(await stopAuthStackCommand({exitCode:null,signalCode:'SIGKILL'}), false);
});

for (const mode of ['stop', 'one-shot-stop', 'launcher-death', 'command-exit']) {
  test(`account command guardian cleans descendants after ${mode}`, {skip: process.platform === 'win32', timeout: 25_000}, async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'righelt-auth-guardian-'));
    const registry = path.join(dir, 'registry');
    const bin = path.join(dir, 'bin');
    await mkdir(bin);
    const pidsFile = path.join(dir, 'pids.json');
    // The command's descendant ignores TERM. Cleanup must include escalation,
    // even when its immediate parent exits first.
    await writeFile(path.join(bin, 'pnpm'), `#!/usr/bin/env node
const {spawn}=require('node:child_process');
const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
require('node:fs').writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.pid,c.pid]));
${mode === 'command-exit' ? 'setTimeout(()=>process.exit(0),250);' : 'setInterval(()=>{},1000);'}
`, {mode: 0o755});
    const launcher = path.join(dir, 'launcher.mjs');
    await writeFile(launcher, `import {spawnAuthStackCommand,stopAuthStackCommand} from ${JSON.stringify(helper)};
import {writeFileSync} from 'node:fs';
const child=spawnAuthStackCommand([], {cwd:${JSON.stringify(dir)},service:${mode !== 'one-shot-stop'}});
${mode.endsWith('stop') ? `process.on('SIGUSR1',async()=>{writeFileSync(${JSON.stringify(path.join(dir,'stopped'))},String(await stopAuthStackCommand(child)));process.exit(0);});` : ''}
${mode === 'command-exit' ? "child.once('close',code=>process.exit(code));" : 'setInterval(()=>{},1000);'}
`);
    const proc = spawn(process.execPath, [launcher], {env: {...process.env, PATH: `${bin}:${process.env.PATH}`, RIGHELT_RESOURCE_RUN:'', RIGHELT_RESOURCE_KEEP:'', RIGHELT_RESOURCE_REGISTRY:registry}, stdio:['ignore','pipe','pipe']});
    let output = '';
    proc.stdout.on('data', chunk => output += chunk);
    proc.stderr.on('data', chunk => output += chunk);
    const done = new Promise(resolve => proc.once('close', resolve));
    t.after(async () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
      for (const name of await readdir(registry).catch(()=>[])) {
        if (name.endsWith('.json')) await cleanupRecord(JSON.parse(await readFile(path.join(registry,name),'utf8')));
      }
      await rm(dir, {recursive:true,force:true});
    });
    const ids = await until(async () => { try { return JSON.parse(await readFile(pidsFile,'utf8')); } catch { return false; } });
    if (mode.endsWith('stop')) proc.kill('SIGUSR1');
    if (mode === 'launcher-death') proc.kill('SIGKILL');
    const code = await done;
    if (mode !== 'launcher-death') assert.equal(code, 0, output);
    await until(async () => !(await processTable()).some(row => ids.includes(row.pid) && live(row)));
    if (mode.endsWith('stop')) assert.equal(await readFile(path.join(dir,'stopped'),'utf8'), 'true');
    const receipts = await Promise.all((await readdir(registry)).filter(name=>name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join(registry,name),'utf8'))));
    await until(async () => (await Promise.all(receipts.map(async receipt => JSON.parse(await readFile(path.join(registry,`${receipt.id}.json`),'utf8'))))).every(receipt=>receipt.cleanup === 'verified'));
  });
}
