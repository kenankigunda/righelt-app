import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { importCatalogCI } from "../../validation/suite-ci-evidence.mjs";
import { laneKey, suiteKind } from "../catalog.mjs";
import { sourceIdentity, sealReceipt, digest } from "../receipts.mjs";
const historical=JSON.parse(await readFile(new URL("../ci-layout-profiles.json",import.meta.url),"utf8")).profiles.find(p=>p.id==="guest-2-v1");
const fullLanes=()=>historical.lanes,catalogDigest=()=>historical.catalog;
test("explicit CI artifact credit verifies full inventory, primary logs and canonical commands", async () => {
  const cwd = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "righelt-ci-")),
  );
  try {
    const git = (...args) => execFileSync("git", args, { cwd });
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(path.join(cwd, "source"), "current");
    await mkdir(path.join(cwd,"scripts/testing"),{recursive:true});
    await writeFile(path.join(cwd,"scripts/testing/catalog.mjs"),await readFile(new URL("./fixtures/ci-legacy-catalog.txt",import.meta.url)));
    await mkdir(path.join(cwd,".github/workflows"),{recursive:true});
    await writeFile(path.join(cwd,".github/workflows/ci.yml"),await readFile(new URL("./fixtures/ci-legacy-34.json",import.meta.url)));
    git("add", ".");
    git("commit", "-qm", "base");
    const identity = sourceIdentity(cwd),
      runtime = { node: "22", pnpm: "9.15.9" },
      dependencies = { lockHash: "a", installedLockHash: "b" },
      raw = Buffer.from("primary log\n");
    const receipts = fullLanes().map((l) =>
      sealReceipt({
        version: 1,
        catalog: catalogDigest(),
        lane: laneKey(l),
        suite: l.suite,
        kind: suiteKind(l.suite),
        stateMode: ["e2e", "auth-e2e", "auth-controls", "responsive"].includes(
          l.suite,
        )
          ? "real-stack"
          : "controlled",
        ...identity,
        runtime,
        dependencies,
        status: "passed",
        exitCode: 0,
        incomplete: false,
        dirtyDuringRun: false,
        inventory: { expected: ["test"], missing: [] },
        observations: { total: 1, passed: 1 },
        logHash: digest(raw),
      }),
    );
    const run = {
      id: 1,
      head_sha: identity.revision,
      run_attempt: 2,
      conclusion: "success",
    };
    const artifacts = receipts.map((r, id) => ({
      id,
      name: `suite-lane-${id}-2`,
      expired: false,
      created_at: new Date(1000 + id).toISOString(),
      workflow_run: { id: 1, head_sha: run.head_sha },
    }));
    const getId = (argv) => Number(/suite-(\d+)\.zip/.exec(argv.join(" "))[1]);
    const api = async () => ({ total_count: artifacts.length, artifacts });
    const call = async (argv) =>
      argv[1] === "-Z1"
        ? "suites/lane/1.receipt.json"
        : JSON.stringify(receipts[getId(argv)]);
    let corrupt = false;
    const execute = async (argv, { log }) => {
      await writeFile(
        log,
        argv[0] === "unzip"
          ? corrupt
            ? Buffer.from("changed")
            : raw
          : Buffer.from("immutable archive"),
      );
      return { output: "", code: 0 };
    };
    const outDir = path.join(cwd, "out");
    await mkdir(outDir);
    // Keep evidence outside the source fingerprint; sourceIdentity is captured before writes.
    const external = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "righelt-ci-artifacts-")),
    );
    try {
      const expected = {
        Unit: { argv: ["pnpm", "test:unit"], runtime, dependencies },
      };
      const options = {
        repository: "owner/repo",
        run,
        cwd,
        outDir: external,
        expected,
        api,
        call,
        execute,
      };
      // Remove untracked output directory before verifying the exact candidate.
      await rm(outDir, { recursive: true });
      const good = await importCatalogCI(options);
      assert.ok(good.receipts.Unit);
      assert.equal(good.receipts.Unit.evidence.length, 3);
      assert.ok(good.receipts.Unit.evidence.some(e => e.lane.startsWith("computer-unit:")));
      const computerLane = artifacts.findIndex((_, i) => receipts[i].suite === "computer-integration");
      const omitted = artifacts.splice(computerLane, 1)[0];
      await assert.rejects(importCatalogCI(options), /Full current-attempt CI inventory unavailable/);
      artifacts.splice(computerLane, 0, omitted);
      const wrong = await importCatalogCI({
        ...options,
        expected: { Unit: { ...expected.Unit, argv: ["pnpm", "other"] } },
      });
      assert.ok(wrong.rejected.Unit);
      assert.equal(wrong.receipts.Unit, undefined);
      corrupt = true;
      await assert.rejects(importCatalogCI(options), /Primary suite log/);
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('archive cache reuses only bytes and revalidates real ZIP proof on every hit',async t=>{
  const {copyFile,stat} = await import('node:fs/promises');
  const {createHash} = await import('node:crypto');
  const rawHash = b => createHash('sha256').update(b).digest('hex');
  const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(),'ci-cache-source-')));
  const storage = await realpath(await mkdtemp(path.join(os.tmpdir(),'ci-cache-zips-')));
  t.after(()=>rm(cwd,{recursive:true,force:true}));t.after(()=>rm(storage,{recursive:true,force:true}));
  const git=(...a)=>execFileSync('git',a,{cwd,stdio:'pipe'});
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  await writeFile(path.join(cwd,'source'),'same source');await mkdir(path.join(cwd,'scripts/testing'),{recursive:true});await writeFile(path.join(cwd,'scripts/testing/catalog.mjs'),await readFile(new URL('./fixtures/ci-legacy-catalog.txt',import.meta.url)));await mkdir(path.join(cwd,'.github/workflows'),{recursive:true});await writeFile(path.join(cwd,'.github/workflows/ci.yml'),await readFile(new URL('./fixtures/ci-legacy-34.json',import.meta.url)));git('add','.');git('commit','-qm','base');
  const identity=sourceIdentity(cwd),runtime={node:'22.23.4',pnpm:'9.15.9'},dependencies={lockHash:'tracked',installedLockHash:'installed'};
  const run={id:41,run_attempt:2,head_sha:identity.revision,conclusion:'success'};
  const expected={Unit:{argv:['pnpm','test:unit'],runtime,dependencies}};
  const variants=[null,'seal','tree','checkout','catalog','runtime','dependencies','incomplete','exit','logHash'];
  for(const variant of variants) {
    const laneDir=path.join(storage,variant??'valid');await mkdir(laneDir);
    const artifactCache=path.join(laneDir,'cache'),outDir=path.join(laneDir,'out');await mkdir(outDir,{mode:0o700});
    let artifacts=[],downloads=0;const zipFiles=new Map();
    for(const [index,lane] of fullLanes().entries()) {
      const id=index+1,dir=path.join(laneDir,`build-${id}`),member=`suites/lane-${id}/1.receipt.json`;
      await mkdir(path.join(dir,`suites/lane-${id}`),{recursive:true});
      // Crosses the stream boundary with repeated 0xff bytes, not a UTF-8 text log.
      const raw=index===0?Buffer.alloc(2*1024*1024,0xff):Buffer.from('primary\n');
      let receipt={version:1,catalog:catalogDigest(),lane:laneKey(lane),suite:lane.suite,kind:suiteKind(lane.suite),stateMode:['e2e','auth-e2e','auth-controls','responsive'].includes(lane.suite)?'real-stack':'controlled',...identity,runtime,dependencies,status:'passed',exitCode:0,incomplete:false,dirtyDuringRun:false,inventory:{expected:['test'],missing:[]},observations:{total:1,passed:1},logHash:digest(raw)};
      if(index===0) {
        if(variant==='tree')receipt.testedTree='0'.repeat(40);
        if(variant==='checkout')receipt.revision='0'.repeat(40);
        if(variant==='catalog')receipt.catalog='wrong';
        if(variant==='runtime')receipt.runtime={...runtime,node:'26'};
        if(variant==='dependencies')receipt.dependencies={...dependencies,installedLockHash:'wrong'};
        if(variant==='incomplete')receipt.incomplete=true;
        if(variant==='exit')receipt.exitCode=1;
        if(variant==='logHash')receipt.logHash='0'.repeat(64);
      }
      receipt=sealReceipt(receipt);if(index===0&&variant==='seal')receipt.integrity='tampered';
      await writeFile(path.join(dir,member),JSON.stringify(receipt));await writeFile(path.join(dir,`suites/lane-${id}/output.log`),raw);
      const zip=path.join(laneDir,`${id}.zip`);execFileSync('zip',['-q',zip,member,`suites/lane-${id}/output.log`],{cwd:dir});zipFiles.set(id,zip);
      const archive=await readFile(zip);
      artifacts.push({id,name:`suite-lane-${id}-2`,expired:false,created_at:new Date(1000+id).toISOString(),workflow_run:{id:run.id,head_sha:run.head_sha},size_in_bytes:(await stat(zip)).size,digest:`sha256:${rawHash(archive)}`});
    }
    const call=async argv=>execFileSync(argv[0],argv.slice(1),{encoding:'utf8',maxBuffer:1024*1024});
    const execute=async(argv,{log})=>{
      if(argv[0]==='gh') {downloads++;const id=Number(/artifacts\/(\d+)\/zip/.exec(argv[2])[1]);await writeFile(log,await readFile(zipFiles.get(id)));}
      else {const fd=(await import('node:fs')).openSync(log,'w');try{execFileSync(argv[0],argv.slice(1),{stdio:['ignore',fd,'pipe']});}finally{(await import('node:fs')).closeSync(fd);}}
      return {code:0,output:''};
    };
    const options={repository:'owner/repo',run,cwd,outDir,expected,artifactCache,api:async()=>({total_count:artifacts.length,artifacts}),call,execute};
    if(variant) {
      await assert.rejects(importCatalogCI(options));const cold=downloads;
      await assert.rejects(importCatalogCI(options));assert.equal(downloads,cold,`invalid ${variant} seal/proof is rejected on cached bytes without another download`);
    } else {
      const first=await importCatalogCI(options),cold=downloads;assert.ok(first.receipts.Unit);assert.equal(cold,fullLanes().length);
      const second=await importCatalogCI(options);assert.ok(second.receipts.Unit);assert.equal(downloads,cold);
      assert.equal(Date.parse(second.receipts.Unit.expiresAt)-Date.parse(second.receipts.Unit.importedAt),86400000);
      assert.ok(second.receipts.Unit.evidence.every(e=>e.logHash&&e.archiveHash));
      const baseline=artifacts;
      for(const mutate of [a=>a.slice(1),a=>a.map((v,i)=>i===0?{...v,expired:true}:v),a=>[...a,{...a[0]}],a=>a.map((v,i)=>i===0?{...v,name:'suite-lane-1-3'}:v),a=>a.map((v,i)=>i===0?{...v,digest:null}:v)]) {
        artifacts=mutate(baseline);await assert.rejects(importCatalogCI(options));assert.equal(downloads,cold);
      }
      artifacts=baseline;
      const mismatch=await importCatalogCI({...options,expected:{Unit:{...expected.Unit,dependencies:{...dependencies,lockHash:'new'}}}});
      assert.ok(mismatch.rejected.Unit);assert.equal(mismatch.receipts.Unit,undefined);assert.equal(downloads,cold);
      // Deterministic F1 interleaving: replace the writable cache entry after
      // its verified consumption copy exists, immediately before first unzip.
      const {artifactCacheKey}=await import('../../validation/ci-artifact-cache.mjs');
      let replaced=false;
      const childProcess=(await import('node:child_process')).default;
      const fsSync=await import('node:fs');const originalSpawn=childProcess.spawn;
      t.mock.method(childProcess,'spawn',(command,args,spawnOptions)=>{
        if(!replaced&&command==='unzip') {
          replaced=true;assert.equal(args[1],'/dev/fd/3');
          assert.equal(typeof spawnOptions.stdio[3],'number');
          const final=path.join(artifactCache,`${artifactCacheKey({repository:'owner/repo',run,artifact:artifacts[0]})}.zip`);
          const trusted=fsSync.readFileSync(final);fsSync.unlinkSync(final);fsSync.writeFileSync(final,trusted,{mode:0o600});
        }
        return originalSpawn(command,args,spawnOptions);
      });
      try {await assert.rejects(importCatalogCI(options),/cache_archive_changed/);}
      finally {t.mock.restoreAll();}
      assert.equal(replaced,true);assert.equal(downloads,cold,'replacement must not trigger network fallback');
    }
  }
});
