import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {createIsolatedPage,importScenarioGame} from '../support/app.mjs';
import {createRushBlockerScenario,assertRushBlockerState} from '../support/rush-blocker-scenario.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {installGuidanceWorkerFault} from '../support/guidance-worker-fault.mjs';

const attachJSON=async(info,name,value)=>{
  const path=info.outputPath(`${name}.json`);
  await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await info.attach(name,{path,contentType:'application/json'});
};

const optionalScalar=(value,key)=>Object.hasOwn(value,key)&&['boolean','number','string'].includes(typeof value[key])
  ?{exposed:true,value:value[key]}:{exposed:false};
const authority=game=>({state:game.board.state,moves:game.moves,gameplayRevision:game.gameplayRevision,
  legalActions:game.legalActions,canRecordMove:game.canRecordMove,canEndTurn:game.canEndTurn,
  syncScalars:Object.fromEntries(['pendingCommandCount','unsavedCommand','rulesChecking','sharedMutationsBlocked',
    'gameplayMutationsBlocked','sharedReceipts','confirmationOverdue','canUndoLastMove'].map(key=>[key,optionalScalar(game,key)])),
  pendingMoveCount:Array.isArray(game.pendingMoves)?{exposed:true,value:game.pendingMoves.length}:{exposed:false}});
const closedKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const validIdentity=value=>typeof value==='string'&&value.length>0;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const readPublicRuntime=async page=>{
  const section=page.locator('[data-flyout="debug"] [data-debug-section="runtime"]');
  if(await section.getAttribute('open')===null)await section.locator('summary').click();
  const pre=section.locator('.debug-section-body > pre');await expect(pre).toBeVisible();
  const value=JSON.parse(await pre.textContent());
  expect(Number.isSafeInteger(value.pendingCommands)).toBe(true);expect(value.pendingCommands).toBe(0);
  const counters=Object.fromEntries(['httpConfirmFailed','wsConfirmedAfterHttpFail','confirmTimeoutRefresh','trueDesync'].map(key=>{
    expect(Number.isSafeInteger(value.sync?.[key])).toBe(true);return[key,value.sync[key]];
  }));
  // Existing public Debug JSON exposes the client queue count. Internal receipt
  // and admission objects stay private and are not invented as zero-valued data.
  return{pendingCommands:value.pendingCommands,revision:value.revision,counters};
};

test('guidance failure reaches local Details without changing legal play',async({browser,baseURL},info)=>{
  const {context,page}=await createIsolatedPage(browser);
  const mutationRequests=[],observationIssues=[];
  const recordIssue=value=>{if(observationIssues.length<8)observationIssues.push(value);};
  const observeRequest=request=>{
    if(!['POST','PUT','PATCH','DELETE'].includes(request.method()))return;
    const target=new URL(request.url());
    if(target.origin!==new URL(baseURL).origin)return;
    if(!/^\/api\/shell\/games(?:\/|$)/.test(target.pathname))return;
    const match=/^\/api\/shell\/games\/[^/]+\/(.+)$/.exec(target.pathname),endpoint=match?.[1]??'game-root';
    // Current transport sends all commands over HTTP. Source-bound socket
    // heartbeat/presence and inbound receipts are documented in the review.
    // Only exact source-verified read/presence envelopes may be ignored here.
    if(request.method()==='POST') {
      try {
        const value=request.postDataJSON();
        const base=value?.protocolVersion===2&&validIdentity(value.identityId);
        if(endpoint==='presence'&&closedKeys(value,['identityId','sessionId','status','lastEventSeq'])
          &&validIdentity(value.identityId)&&validIdentity(value.sessionId)&&['inactive','disconnecting'].includes(value.status)&&integer(value.lastEventSeq))return;
        if(endpoint==='legal'&&base&&closedKeys(value,['identityId','state','protocolVersion']))return;
        if(endpoint==='piece-moves'&&base&&closedKeys(value,['identityId','state','pieceId','protocolVersion'])&&validIdentity(value.pieceId))return;
        if(endpoint==='decision-history'&&base&&closedKeys(value,['identityId','cursor','protocolVersion']))return;
        if(endpoint==='decision-history'&&base&&closedKeys(value,['identityId','metadataOnly','cursor','historyRevision','mode','protocolVersion'])
          &&value.metadataOnly===true&&value.cursor===null&&integer(value.historyRevision)&&value.mode==='additional')return;
        if(endpoint==='decision-snapshot'&&base&&closedKeys(value,['identityId','decisionId','gameplayRevision','protocolVersion'])&&validIdentity(value.decisionId)&&integer(value.gameplayRevision))return;
        if(endpoint==='reconcile'&&base&&closedKeys(value,['protocolVersion','identityId','knownSnapshotEventSeq','commands'])
          &&integer(value.knownSnapshotEventSeq)&&Array.isArray(value.commands)&&value.commands.length===0)return;
      } catch {recordIssue('unreadable-game-envelope');}
    }
    if(mutationRequests.length<32)mutationRequests.push({method:request.method(),endpoint});
    else recordIssue('mutation-observer-cap');
  };
  page.on('request',observeRequest);
  await page.addInitScript(installGuidanceWorkerFault);
  let hasPrimary=false;
  try {
    const {scenario,state,reconnect}=createRushBlockerScenario();
    const {gameId}=await importScenarioGame(page,scenario,baseURL);
    const imported=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
    assertRushBlockerState(imported.board.state);
    expect(imported.board.state).toEqual(state);
    expect(imported.canRecordMove).toBe(true);
    expect(imported.canEndTurn).toBe(false);
    expect(imported.legalActions).toContainEqual(reconnect);
    const before=authority(imported);
    const preview=page.locator('#shell-board-preview-label');
    const required=page.locator('[data-alert-stack-card].is-active [data-board-context][aria-label="Required Board guidance"]');
    await expect(required).toContainText('Hints unavailable');
    await expect(preview.locator('.board-obligatory-pill')).toHaveText('Obligatory');
    await expect(preview.getByRole('button',{name:'Try again',exact:true})).toBeEnabled();

    await page.getByRole('button',{name:'Debug',exact:true}).click();
    const runtimeBefore=await readPublicRuntime(page);
    expect(runtimeBefore.revision).toBe(before.gameplayRevision);
    const issues=page.locator('[data-flyout="debug"] .recent-issue');
    const report=issues.filter({hasText:'rush_guidance'});
    await expect(report).toHaveCount(1);
    const incident=report.locator('.issue-diagnostic');
    const incidentId=await incident.getAttribute('data-incident-id');
    expect(incidentId).toBeTruthy();
    await report.getByRole('button',{name:'Details',exact:true}).click();
    const details=report.locator('.issue-details pre');
    await expect(details).toBeVisible();
    const text=await details.textContent();
    expect(text).toContain('rush_guidance');
    expect(text).toContain('analysis_request_failed');
    expect(text).toContain('rules_budget_exceeded');
    // This is the configured policy value, not a claim of actual timeout expiry.
    expect(text).toMatch(/"deadlineMs":\s*2000/);
    const stored=JSON.parse(text.slice(text.indexOf('{')));
    expect(Number.isFinite(stored.initial.elapsedMs)).toBe(true);
    expect(stored.initial.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(text).not.toContain('private-guidance-worker-marker');
    expect(text).not.toContain('raw-state-marker');
    expect(stored.initial).not.toHaveProperty('authoritativeState');
    expect(stored.initial).not.toHaveProperty('tentativeState');
    await page.screenshot({path:info.outputPath('guidance-diagnostic-details.png')});
    await page.getByRole('button',{name:'Debug',exact:true}).click();
    await expect(page.locator('[data-flyout="debug"]')).not.toBeVisible();

    await preview.getByRole('button',{name:'Try again',exact:true}).click();
    await expect(page.locator('.rush-guidance-source')).toHaveCount(2);
    await expect(required).not.toContainText('Hints unavailable');
    const actor=page.locator(`[data-testid="game-board"] .cell[data-row="${reconnect.from.row}"][data-col="${reconnect.from.col}"]`);
    await actor.click();
    await expect(actor).toHaveClass(/selected-piece/);
    const after=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
    expect(authority(after)).toEqual(before);
    expect(mutationRequests).toEqual([]);
    expect(observationIssues).toEqual([]);

    await page.getByRole('button',{name:'Debug',exact:true}).click();
    const runtimeAfter=await readPublicRuntime(page);
    expect(runtimeAfter).toEqual(runtimeBefore);
    const resolved=page.locator('[data-flyout="debug"] .recent-issue').filter({hasText:'rush_guidance'});
    await expect(resolved).toHaveCount(1);
    await expect(resolved).toContainText('Resolved');
    await expect(resolved.locator('.issue-diagnostic')).toHaveAttribute('data-incident-id',incidentId);
    const observation=await page.evaluate(()=>globalThis.__guidanceWorkerFault.snapshot());
    expect(observation.issues).toEqual([]);
    expect(observation.injected).toBe(1);
    expect(observation.records.filter(row=>row.kind==='injected')).toHaveLength(1);
    expect(observation.records.filter(row=>row.kind==='response')).toHaveLength(1);
    expect(observation.records.some(row=>row.kind==='delegated-guidance')).toBe(true);
    await attachJSON(info,'normalized-guidance-diagnostic-wiring',{observation,mutationRequests,incidentId,
      configuredDeadlineMs:2000,injectedFailureCode:'rules_budget_exceeded',realTimeoutExpiryProved:false,runtimeBefore,runtimeAfter,publicSyncScalars:before.syncScalars,
      actualAppSinkAndDetails:true,authorityUnchanged:true});
  } catch(error) {hasPrimary=true;throw error;}
  finally {
    const secondary=[];
    let cleanupFailed=false,cleanupFailure;
    const incomplete=(phase,error)=>{
      if(!cleanupFailed)cleanupFailure=error;
      cleanupFailed=true;
      const entry={phase,name:typeof error?.name==='string'?error.name:'Error',incomplete:true};
      secondary.push(entry);
      try{info.annotations.push({type:'guidance-cleanup-incomplete',description:`${phase}: ${entry.name}`});}catch{}
      try{console.error(JSON.stringify({kind:'guidance-worker-fixture-cleanup-incomplete',...entry,hasPrimary}));}catch{}
    };
    let observation={issues:['restore-not-recorded']};
    try {
      page.off('request',observeRequest);
      observation=await page.evaluate(()=>{const fixture=globalThis.__guidanceWorkerFault;fixture?.restore();return fixture?.snapshot()??{issues:['fixture-not-installed']};});
      expect(observation.issues).toEqual([]);
    } catch(error) {incomplete('worker-restore',error);}
    try {await context.close();}catch(error){incomplete('context-close',error);}
    try {
      await attachJSON(info,'guidance-worker-boundary-cleanup',{observation,mutationRequests,observationIssues,secondary,incomplete:cleanupFailed,hasPrimary});
    }catch(error){incomplete('proof-persistence',error);}
    if(cleanupFailed&&!hasPrimary)throw cleanupFailure;
  }
});
