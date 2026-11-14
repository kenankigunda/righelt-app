import {expect} from '@playwright/test';

const fixtureMarkup = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/shell/shell.css">
  <link rel="stylesheet" href="/shell/refresh.css">
  <link rel="stylesheet" href="/shell/board-ux.css">
</head>
<body>
  <main id="app" class="app-root" data-shell-layout-mode="wide">
    <section class="game-shell"><article class="board-panel game-panel">
      <h1 id="turn">Red to play</h1>
      <div id="prompt" class="board-message" aria-live="polite"></div>
      <div class="board-wrap" data-testid="game-board-wrap">
        <div id="board" class="board" data-testid="game-board" role="region" aria-label="Game Board"></div>
        <svg id="lines" class="overlay-lines" aria-hidden="true"></svg>
      </div>
    </article></section>
  </main>
</body></html>`;

export async function mountT142NativeBoard(page) {
  // Establish the served origin without starting the application shell, which
  // would otherwise race this support-only DOM with its own route renderer.
  await page.goto('/deploy-meta.json');
  await page.setContent(fixtureMarkup, {waitUntil:'load'});
  await page.evaluate(async()=>{
    const [{createBoardRuntime},{createEngineBoardAdapter},{createShellBoardHost},{mutationSurfacePresentation},{createForegroundRecoveryWait},{createRecoveryPresentation},engine] = await Promise.all([
      import('/board/runtime/board-runtime.js'),
      import('/board-adapters/engine-board-adapter.js'),
      import('/board/hosts/shell-host.js'),
      import('/board/surface-pulse.js'),
      import('/shell/foreground-recovery.js'),
      import('/shell/recovery-presentation.js'),
      import('/generated/packages/game-engine/src/index.js'),
    ]);
    let state=engine.createInitialState(),legalActions=engine.listLegalActions(state),authority=true,now=1_000,episode=1,incidentStartedAt=null,staleEpisodeId=null,actionType='pass';
    const commands=[];
    const presentationDocument={hidden:false},currentRoute={name:'game',gameId:'fixture-game'};
    const game={id:'fixture-game',currentSnapshot:state,legalActions,sharedMutationsBlocked:false,gameplayMutationsBlocked:false,recovering:false,syncStatus:'ready',recoveryEpisodeId:null};
    const syncGame=(nextState=state)=>{state=nextState;legalActions=engine.listLegalActions(state);game.currentSnapshot=state;game.legalActions=legalActions;};
    const admit=action=>{
      if(!authority)throw Object.assign(new Error('fixture_authority_blocked'),{code:'authority_blocked'});
      const result=engine.applyAction(state,action);commands.push({id:`fixture-command-${commands.length+1}`,type:action.type});syncGame(result.state);
      return {accepted:true,state,legalActions,outcome:result.outcome,clientCommandId:commands.at(-1).id};
    };
    const transport={
      getGameViewModel:()=>game,
      applyGameAction:({action})=>admit(action),
      endTurn:()=>admit({type:'end_turn'}),
      ensureRecoveryIncident:()=>null,
    };
    const foregroundRecoveryWait=createForegroundRecoveryWait({clock:()=>now,setTimer:()=>0,clearTimer(){}});
    const recoveryPresentation=createRecoveryPresentation(()=>({
      foregroundRecoveryWait,viewingScope:()=> 'fixture-owner',currentRoute,document:presentationDocument,
      getCurrentViewedGameId:()=> 'fixture-game',computerSession:null,quietComputerRenewal:()=>false,transport,
    }));
    const host=createShellBoardHost({
      transport,gameId:'fixture-game',
      canInteract:()=>authority,
      canPresentActions:()=>true,
      canSelect:()=>true,
      getMutationSurface:()=>mutationSurfacePresentation(game,recoveryPresentation.options(game)),
      rulesExecutor:{asynchronous:false,cancelAll(){},previews(_kind,{legalActions:actions,pieceId}){
        const piece=state.pieces.find(candidate=>candidate.id===pieceId);
        const selected=actions.filter(action=>action.actorId===pieceId||action.from&&piece&&piece.position.row===action.from.row&&piece.position.col===action.from.col);
        return {ok:true,state,actions:selected,previewActions:selected};
      }},
    });
    const runtime=createBoardRuntime({boardAdapter:createEngineBoardAdapter(),host,controls:{
      getActionType:()=>actionType,setActionType:value=>{actionType=value;},getSupportsHover:()=>false,
      getForceClickTargetSelection:()=>true,getAllowFreeSelection:()=>false,
      onResult:result=>{window.__t142LastResult=result;},
    },rushGuidanceClient:{cancel(){},destroy(){},analyze:async()=>({actions:[]})}});
    runtime.bindElements({boardEl:document.getElementById('board'),overlayLinesEl:document.getElementById('lines'),boardPreviewLabelEl:document.getElementById('prompt'),boardTurnIndicatorEl:document.getElementById('turn')});
    await runtime.initialize();
    const move=legalActions.find(action=>action.from&&action.to&&action.type==='move')??legalActions.find(action=>action.from&&action.to);
    if(!move)throw new Error('fixture_move_missing');
    window.__t142={
      async selectMove(){await runtime.setSelectionFromAction(move);return structuredClone(move);},
      action:structuredClone(move),
      setIncident(elapsedMs,{nextEpisode=false}={}){
        authority=false;if(nextEpisode){staleEpisodeId=game.recoveryEpisodeId;episode+=1;}
        Object.assign(game,{sharedMutationsBlocked:true,gameplayMutationsBlocked:true,recovering:true,syncStatus:'recovering',recoveryEpisodeId:`fixture-episode-${episode}`});
        incidentStartedAt=now;recoveryPresentation.options(game);now+=elapsedMs;
        runtime.refreshStatus();
      },
      advanceIncident(elapsedMs){now=incidentStartedAt+elapsedMs;runtime.refreshStatus();},
      setHidden(value,advanceMs=0){presentationDocument.hidden=Boolean(value);now+=advanceMs;runtime.refreshStatus();if(!value)incidentStartedAt=now;},
      supersede(elapsedMs=0){staleEpisodeId=game.recoveryEpisodeId;episode+=1;game.recoveryEpisodeId=`fixture-episode-${episode}`;incidentStartedAt=now;recoveryPresentation.options(game);now+=elapsedMs;runtime.refreshStatus();},
      staleRefresh(advanceMs=0){now+=advanceMs;const stale={...game,recoveryEpisodeId:staleEpisodeId};const staleSurface=mutationSurfacePresentation(stale,recoveryPresentation.options(stale));runtime.refreshStatus();incidentStartedAt=now;return staleSurface;},
      rerender(){runtime.refreshVisuals();runtime.refreshStatus();},
      recover(){authority=true;incidentStartedAt=null;Object.assign(game,{sharedMutationsBlocked:false,gameplayMutationsBlocked:false,recovering:false,syncStatus:'ready',recoveryEpisodeId:null});runtime.refreshStatus();},
      retire(){episode+=1;authority=true;incidentStartedAt=null;Object.assign(game,{sharedMutationsBlocked:false,gameplayMutationsBlocked:false,recovering:false,syncStatus:'ready',recoveryEpisodeId:null});runtime.refreshStatus();},
      commandSnapshot:()=>structuredClone(commands),
      incidentSnapshot:()=>({authority,now,episode,currentEpisodeId:game.recoveryEpisodeId,selection:runtime.getSelection(),surface:mutationSurfacePresentation(game,recoveryPresentation.options(game))}),
      destroy:()=>runtime.destroy(),
    };
  });
  await expect(page.getByTestId('game-board')).toBeVisible();
  return {
    prompt:page.locator('#prompt'),
    board:page.getByTestId('game-board'),
    pass:page.locator('[data-board-preview-action="pass"]'),
    async selectMove(){const action=await page.evaluate(()=>window.__t142.selectMove());const target=page.locator(`.cell[data-row="${action.to.row}"][data-col="${action.to.col}"]`);await expect(target).toHaveClass(/\btarget\b/);return {action,target,source:page.locator(`.cell[data-row="${action.from.row}"][data-col="${action.from.col}"]`)};},
    setIncident:(elapsed,options)=>page.evaluate(([value,next])=>window.__t142.setIncident(value,next),[elapsed,options]),
    advanceIncident:elapsed=>page.evaluate(value=>window.__t142.advanceIncident(value),elapsed),
    setHidden:(value,advance=0)=>page.evaluate(([next,elapsed])=>window.__t142.setHidden(next,elapsed),[value,advance]),
    supersede:(elapsed=0)=>page.evaluate(value=>window.__t142.supersede(value),elapsed),
    staleRefresh:(elapsed=0)=>page.evaluate(value=>window.__t142.staleRefresh(value),elapsed),
    recover:()=>page.evaluate(()=>window.__t142.recover()),
    retire:()=>page.evaluate(()=>window.__t142.retire()),
    rerender:()=>page.evaluate(()=>window.__t142.rerender()),
    commands:()=>page.evaluate(()=>window.__t142.commandSnapshot()),
    incident:()=>page.evaluate(()=>window.__t142.incidentSnapshot()),
  };
}
