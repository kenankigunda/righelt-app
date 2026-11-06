import {test as base,expect} from '@playwright/test';
import {controlledHeightPublication} from './support/height-publication-test-fixture.mjs';
const test=base.extend({publicationOwner:controlledHeightPublication});
import {settledMessage,measureSemanticGeometry,assertSemanticGeometry} from './support/message-semantic-geometry.mjs';
import {readFileSync} from 'node:fs';
const state=JSON.parse(readFileSync('apps/web/scenarios/catalog.json','utf8')).scenarios.find(s=>s.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState;

async function open(page, {width=1200, hold=false}={}) {
  await page.setViewportSize({width,height:1000});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async({state,hold})=>{
    const {listLegalActions,analyzeRushSupplyGuidance}=await import('/apps/web/generated/packages/game-engine/src/index.js');
    const options=hold?{rushGuidanceClient:{
      analyze(snapshot){return new Promise((resolve,reject)=>{window.finishGuidance=()=>resolve(analyzeRushSupplyGuidance(snapshot));window.failGuidance=()=>reject(new Error('unavailable'));});},cancel(){},destroy(){},
    }}:{};
    await window.boardFixture.setup('rush',false,options);
    await window.boardFixture.configure(state,listLegalActions(state));
  },{state,hold});
}

for (const width of [390,1200]) test(`obligatory supply guidance preserves choices and fits at ${width}px`,async({page,publicationOwner},info)=>{
  await open(page,{width});
  const pill=page.locator('#preview .board-obligatory-pill');
  await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await expect(page.locator('.cell.selected-piece')).toHaveAttribute('data-row','6');
  await expect(page.locator('.cell.selected-piece')).toHaveAttribute('data-col','4');
  await expect(pill).toHaveCount(0);
  const target=page.locator('.rush-guidance-target');
  await expect(target).toHaveCount(1);await expect(target).toHaveAttribute('data-row','7');await expect(target).toHaveAttribute('data-col','5');
  await target.click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Restores required supply');
  await expect(pill).toHaveCount(0);
  await expect(page.locator('#preview .board-message-row')).toHaveCount(0);
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Restores required supply');
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right})).slice(0,10)}));
  expect(geometry.scroll,JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.width);
  await page.screenshot({path:info.outputPath(`obligatory-supply-${width}.png`)});
  // Selecting another legal actor reveals its destinations without claiming
  // those moves are necessary for supply restoration.
  await page.locator('.cell[data-row="4"][data-col="6"]').click();
  await expect(page.locator('.rush-guidance-other')).toHaveCount(1);
  await expect(page.locator('.rush-guidance-target')).toHaveCount(0);
  await expect(page.locator('.rush-guidance-other')).toHaveAttribute('aria-label',/Other legal rush/);
  const applied=await page.evaluate(()=>window.boardFixture.applied().length);
  await page.locator('.rush-guidance-other').click();
  await expect.poll(()=>page.evaluate(()=>window.boardFixture.applied().length)).toBe(applied+1);
});

test('background completion preserves manual selection and failure restores existing guidance',async({page,publicationOwner})=>{
  await open(page,{hold:true});
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Finding rushes that restore supply');
  const globalCopy=await page.locator('#preview').textContent();
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  expect(await page.locator('#preview .board-obligatory-pill').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(117, 69, 6)');
  await page.locator('.cell[data-row="4"][data-col="6"]').hover();
  await expect(page.locator('.cell.selected-piece')).toHaveCount(0);
  await expect(page.locator('#preview')).toHaveText(globalCopy);
  await page.locator('.cell[data-row="4"][data-col="6"]').click();
  await page.evaluate(()=>window.finishGuidance());
  await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await expect(page.locator('.cell.selected-piece')).toHaveAttribute('data-row','4');
  await expect(page.locator('.cell.selected-piece')).toHaveAttribute('data-col','6');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveCount(0);
  await open(page,{hold:true});await page.evaluate(()=>window.failGuidance());
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Rush to restore supply for piece at 7, 1');
  await expect(page.locator('[data-board-context] .board-context-body .board-preview-coordinate-chip')).toHaveText('7, 1');
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Hints unavailable');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await expect(page.locator('.continuation-pending')).toHaveCount(5);
  await page.evaluate(()=>{window.previousFinishGuidance=window.finishGuidance;});
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.finishGuidance!==window.previousFinishGuidance)).toBe(true);
  await page.evaluate(()=>window.finishGuidance());
  await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await expect(page.locator('.cell.selected-piece')).toHaveCount(1);
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveCount(0);
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
});

for (const [width,fontScale] of [[390,100],[390,200],[1200,100]]) test(`multiple useful sources and multi-step previews at ${width}px / ${fontScale}%`,async({page,publicationOwner},info)=>{
  await open(page,{width});
  await page.evaluate(async scale=>{document.documentElement.style.fontSize=`${scale}%`;await document.fonts.ready;},fontScale);
  await page.evaluate(async()=>{
    const piece=(id,owner,kind,row,col)=>({id,owner,kind,position:{row,col},supplied:true,commanded:true});
    const pieces=[piece('C1','P1','commander',2,8),piece('C2','P2','commander',9,0),piece('X','P1','unit',7,1),piece('Y','P1','unit',8,2),piece('A','P1','unit',4,5),piece('B','P1','unit',3,5),piece('C','P1','unit',4,7),...[[0,4],[9,4],[5,0],[5,9],[4,4],[5,8]].map(([r,c],i)=>piece(`E${i}`,'P2','unit',r,c))];
    const snapshot={boardSize:10,sideToMove:'P1',turnIndex:1,outcome:{status:'ongoing'},pieces,continuation:{type:'rush',owner:'P1',chainLength:1,frozenOwner:'P1',rushedPieceIds:['X'],rushChainPieceIds:['X','Y'],frozenPieceStatesById:Object.fromEntries(pieces.filter(p=>p.owner==='P1').map(p=>[p.id,{supplied:true,commanded:p.id!=='C1'}]))}};
    const {listLegalActions}=await import('/apps/web/generated/packages/game-engine/src/index.js');
    await window.boardFixture.configure(snapshot,listLegalActions(snapshot));
  });
  await expect(page.locator('.rush-guidance-source')).toHaveCount(3);
  await expect(page.locator('.cell.selected-piece')).toHaveCount(0);
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('pieces at 7, 1, 8, 2');
  await settledMessage(page,{publishedManagedHeight:info.project.name==='webkit',info});const before=await measureSemanticGeometry(page);
  await page.locator('.cell[data-row="4"][data-col="5"]').click();
  await expect(page.locator('.rush-guidance-target')).toHaveCount(3);
  await page.locator('.cell[data-row="3"][data-col="4"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Restores required supply after further rushes');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveCount(0);
  await settledMessage(page,{publishedManagedHeight:info.project.name==='webkit',info});assertSemanticGeometry(before,await measureSemanticGeometry(page));
  await page.screenshot({path:info.outputPath('multiple-supply-options.png')});
  await page.locator('.cell[data-row="0"][data-col="0"]').click();
  await expect(page.locator('.cell.selected-piece')).toHaveCount(0);
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('pieces at 7, 1, 8, 2');
  await settledMessage(page,{publishedManagedHeight:info.project.name==='webkit',info});expect(await measureSemanticGeometry(page)).toEqual(before);
});

test('obligatory message retains inactive-piece and blocked-destination explanations',async({page,publicationOwner})=>{
  await open(page);await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await page.locator('.cell[data-row="6"][data-col="0"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Cannot move: no command at start of rush');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await expect(page.locator('[data-board-context] .board-preview-coordinate-chip-rush-blocker')).toHaveText('7, 1');
  await expect(page.locator('[data-board-context] .board-context-dismiss')).toHaveCount(0);
  await page.locator('.cell[data-row="6"][data-col="4"]').click();
  await page.locator('.cell[data-row="7"][data-col="3"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Destination would have no supply');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await expect(page.locator('[data-board-context] .board-preview-coordinate-chip-rush-blocker')).toHaveText('7, 1');
  await expect(page.locator('[data-board-context] .board-context-dismiss')).toHaveCount(0);
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
});

for (const fontScale of [100,200]) test(`touch confirmation stays put across guidance choices at ${fontScale}% text`,async({page,publicationOwner},info)=>{
  let primary;
  try {
  if (fontScale !== 200) await open(page,{width:390});
  else {
    // Same original open sequence. Only this case observes the real client.
    await page.setViewportSize({width:390,height:1000});
    await page.goto('/browser-integration/support/board-message.html');
    await page.waitForFunction(()=>window.fixtureReady);
    await page.evaluate(async state=>{
      const [{listLegalActions},{createRushSupplyGuidanceClient},{RulesRuntime}]=await Promise.all([
        import('/apps/web/generated/packages/game-engine/src/index.js'),
        import('/apps/web/board/rush-supply-guidance.js'),import('/apps/web/board/rules-runtime.js')]);
      const rows=[],limit=96,cleanup=[];let dropped=0,errors=0,sequence=0,phase=null,enabled=true,lastDOM='';
      const executor=new RulesRuntime(),factory=executor.workerFactory,cancelAll=executor.cancelAll;
      const board=document.querySelector('#board');
      const record=(kind,data={})=>{try{if(!enabled)return;if(rows.length>=limit){dropped++;return;}rows.push({at:performance.now(),kind,...data});}catch{errors++;}};
      const job=()=>({id:executor.running?.id??null,scope:executor.running?.scope??null,type:executor.running?.type??null,jobs:executor.jobs.size});
      const readDOM=()=>{
        const current=document.querySelector('#board'),value={sameBoard:current===board,hidden:document.hidden,
          sources:current?.querySelectorAll('.rush-guidance-source').length??null,
          selection:window.boardFixture.selection(),context:document.querySelector('#fixture-context')?.textContent?.slice(0,1024)??'',
          prompt:document.querySelector('#preview')?.textContent?.slice(0,1024)??''};
        const key=JSON.stringify(value);if(key!==lastDOM){lastDOM=key;record('dom-presentation',value);}
      };
      executor.workerFactory=function(...args){
        const worker=Reflect.apply(factory,this,args),terminate=worker.terminate;
        record('worker-created',job());
        if(cleanup.length>=limit){dropped++;return worker;}
        const onMessage=event=>record('worker-message',{...job(),responseId:event.data?.id??null,responseScope:event.data?.scope??null,
          responseType:event.data?.type??null,errorCode:event.data?.error?.code??null,errorMessage:event.data?.error?.message??null,
          actions:Array.isArray(event.data?.result?.actions)?event.data.result.actions.length:null});
        const onError=event=>record('worker-error',{...job(),message:event.message??null});
        const onMessageError=()=>record('worker-messageerror',job());
        worker.addEventListener('message',onMessage);worker.addEventListener('error',onError);worker.addEventListener('messageerror',onMessageError);
        worker.terminate=function(...args){record('worker-terminate',job());return Reflect.apply(terminate,this,args);};
        cleanup.push(()=>{worker.removeEventListener('message',onMessage);worker.removeEventListener('error',onError);worker.removeEventListener('messageerror',onMessageError);worker.terminate=terminate;});
        return worker;
      };
      executor.cancelAll=function(...args){record('executor-cancelAll',{...job(),publicPhase:phase,
        caller:new Error('read-only cancellation boundary').stack?.split('\n').slice(1,5).join('\n')??null});return Reflect.apply(cancelAll,this,args);};
      const real=createRushSupplyGuidanceClient({executor});
      const observed={
        analyze(snapshot){
          const id=++sequence;record('analyze-enter',{id,inputKey:JSON.stringify(snapshot)});phase='analyze';let pending;
          try{pending=Reflect.apply(real.analyze,real,[snapshot]);}
          catch(error){record('analyze-throw',{id,code:error?.code??null,message:error?.message??null});throw error;}finally{phase=null;}
          // Observe a side branch but return the exact original promise.
          pending.then(result=>record('analyze-resolve',{id,actions:Array.isArray(result?.actions)?result.actions.length:null}),
            error=>record('analyze-reject',{id,code:error?.code??null,message:error?.message??null}));
          return pending;
        },
        cancel(...args){record('client-cancel',job());phase='cancel';try{return Reflect.apply(real.cancel,real,args);}finally{phase=null;}},
        destroy(...args){record('client-destroy',job());phase='destroy';try{return Reflect.apply(real.destroy,real,args);}finally{phase=null;}},
      };
      const onVisibility=()=>record('visibilitychange',{hidden:document.hidden,...job()});
      const onPageHide=()=>record('pagehide',{hidden:document.hidden,...job()});
      document.addEventListener('visibilitychange',onVisibility);window.addEventListener('pagehide',onPageHide);
      const mutation=new MutationObserver(()=>{try{readDOM();}catch{errors++;}});
      mutation.observe(document.querySelector('#app'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
      window.__rushGuidanceCaseObservation={finish(){
        try{readDOM();}catch{errors++;}mutation.disconnect();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pagehide',onPageHide);
        for(const dispose of cleanup)try{dispose();}catch{errors++;}
        executor.workerFactory=factory;executor.cancelAll=cancelAll;enabled=false;
        return{timeOrigin:performance.timeOrigin,rows,dropped,errors,incomplete:dropped>0||errors>0,analysisCalls:sequence,
          scope:'Real-client events and rendered DOM only. Private owner generation/key/ready assignment are not directly observed.'};
      }};
      await window.boardFixture.setup('rush',false,{rushGuidanceClient:observed});
      await window.boardFixture.configure(state,listLegalActions(state));
    },state);
  }
  await page.evaluate(async fontScale=>{
    document.documentElement.style.fontSize=`${fontScale}%`;await document.fonts.ready;
    const {scenarios}=await(await fetch('/apps/web/scenarios/catalog.json')).json();
    const snapshot=structuredClone(scenarios.find(s=>s.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState);
    const {listLegalActions}=await import('/apps/web/generated/packages/game-engine/src/index.js');
    await window.boardFixture.configure(snapshot,listLegalActions(snapshot));
  },fontScale);
  await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await settledMessage(page);const before=await measureSemanticGeometry(page);
  await page.locator('.cell[data-row="6"][data-col="0"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Cannot move: no command at start of rush');
  await settledMessage(page);assertSemanticGeometry(before,await measureSemanticGeometry(page));
  await page.locator('.cell[data-row="6"][data-col="4"]').click();
  await page.locator('.cell[data-row="7"][data-col="3"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Destination would have no supply');
  await settledMessage(page);assertSemanticGeometry(before,await measureSemanticGeometry(page));
  } catch(error) { primary=error;throw error; }
  finally {
    if(fontScale===200)try{
      const observation=await page.evaluate(()=>window.__rushGuidanceCaseObservation?.finish()??{incomplete:true,reason:'observation-not-installed'});
      await info.attach('Real rush-guidance case observation',{body:JSON.stringify(observation),contentType:'application/json'});
      if(!primary)expect(observation.incomplete,'Read-only measurement must be complete').toBe(false);
    }catch(error){console.error(JSON.stringify({kind:'rush-guidance-observation-incomplete',name:error?.name??'Error'}));if(!primary)throw error;}
  }
});
