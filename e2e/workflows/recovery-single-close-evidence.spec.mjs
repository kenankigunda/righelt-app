import {test,expect} from '@playwright/test';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';

const guestRequest=(page,route,body)=>page.evaluate(async({route,body,header})=>{
 const bootstrap=await fetch('/api/shell/bootstrap');
 const generation=bootstrap.headers.get(header),identityId=localStorage.getItem('righelt.identity.id.v1');
 const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},
  body:JSON.stringify({...body,identityId,protocolVersion:2})});
 if(!response.ok)throw Error(`Local recovery fixture failed: ${response.status}`);
 return response.json();
},{route,body,header:STORAGE_GENERATION_HEADER});

const recoveryEvidence=page=>page.evaluate(async()=>({
 timeline:(await import('/shell/recovery-telemetry.js')).recoveryTimelineSnapshot(),
}));

test('a first-frame socket close produces one bounded recovery episode and converges',async({context,page},info)=>{
 await page.goto('/');
 await expect(page.getByTestId('home-create-game')).toBeVisible();
 const {game}=await guestRequest(page,'/api/shell/games',{selfPlayMode:true,computer:{p1:null,p2:'babs'}});
 await page.close();

 const target=await context.newPage();
 let firstFrame=null,closed=false,socketCount=0;
 await target.routeWebSocket(new RegExp(`/api/shell/games/${game.id}/ws`),socket=>{
  socketCount++;
  const server=socket.connectToServer();
  socket.onClose((code,reason)=>{void server.close({code,reason}).catch(()=>{});});
  server.onMessage(message=>{
   let parsed;try{parsed=JSON.parse(String(message));}catch{}
   if(!closed&&parsed?.game?.id===game.id){
    closed=true;firstFrame={type:parsed.type??null,eventSeq:parsed.eventSeq??null,socketCount};
    void socket.close({code:1012,reason:'Test first-frame transition'});
    return;
   }
   socket.send(message);
  });
 });
 let evidence={timeline:[]};
 try{
  await target.goto(`/#/game/${game.id}`);
  await expect.poll(()=>firstFrame).not.toBe(null);
  await expect.poll(async()=>{
   evidence=await recoveryEvidence(target);
   return evidence.timeline.some(event=>event.type==='recovery_started'&&event.reason==='socket_closed');
  }).toBe(true);
  expect(firstFrame.socketCount).toBe(1);
  const starts=evidence.timeline.filter(event=>event.type==='recovery_started'&&event.reason==='socket_closed'&&event.closeCode===1012);
  expect(starts).toHaveLength(1);
  const started=starts[0];
  expect(started).toMatchObject({owner:'recovery',ownerAction:'acquired',activeEpisodeRelation:'active',closeCode:1012});
  await expect.poll(async()=>{
   evidence=await recoveryEvidence(target);
   const startIndex=evidence.timeline.findIndex(event=>event.eventId===started.eventId);
   const completedIndex=evidence.timeline.findIndex((event,index)=>index>startIndex&&event.type==='recovery_completed'&&event.episodeId===started.episodeId
    &&event.ownerAction==='released'&&event.result==='resolved');
   const readyIndex=evidence.timeline.findIndex((event,index)=>index>completedIndex&&event.type==='readiness'&&event.gate==='ready');
   return startIndex>=0&&completedIndex>startIndex&&readyIndex>completedIndex;
  }).toBe(true);
  expect(evidence.timeline.filter(event=>event.type==='recovery_started'&&event.reason==='socket_closed'&&event.closeCode===1012)).toHaveLength(1);
  expect(evidence.timeline.some(event=>event.episodeId===started.episodeId&&(event.terminalFailure||event.type==='recovery_blocked'))).toBe(false);
  expect(socketCount).toBe(2);
  await expect(target.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0);
  await expect(target.locator('[data-board-preview-action="pass"]')).toBeEnabled();
  evidence=await recoveryEvidence(target);
 }finally{
  await info.attach('single-close-recovery-evidence',{body:JSON.stringify({gameId:game.id,firstFrame,socketCount,...evidence},null,2),contentType:'application/json'});
  await target.close();
 }
});

test('a first-frame offline transition records 1006, keeps actions fenced, and converges after restore',async({context,page},info)=>{
 await page.goto('/');
 await expect(page.getByTestId('home-create-game')).toBeVisible();
 const {game}=await guestRequest(page,'/api/shell/games',{selfPlayMode:true,computer:{p1:null,p2:'babs'}});
 await page.close();

 const target=await context.newPage();
 await target.addInitScript(()=>{
  window.__recoveryNativeCloses=[];
  const NativeWebSocket=window.WebSocket;
  window.WebSocket=new Proxy(NativeWebSocket,{construct(value,args,newTarget){
   const socket=Reflect.construct(value,args,newTarget);
   socket.addEventListener('close',event=>window.__recoveryNativeCloses.push({code:event.code,clean:event.wasClean}));
   return socket;
  }});
 });
 let firstFrame=null,offlineWork=null,socketCount=0;
 await target.routeWebSocket(new RegExp(`/api/shell/games/${game.id}/ws`),socket=>{
  socketCount++;
  const server=socket.connectToServer();
  server.onMessage(message=>{
   let parsed;try{parsed=JSON.parse(String(message));}catch{}
   if(!firstFrame&&parsed?.game?.id===game.id){
    firstFrame={type:parsed.type??null,eventSeq:parsed.eventSeq??null,socketCount};
    offlineWork=context.setOffline(true);
    return;
   }
   socket.send(message);
  });
 });
 let evidence={timeline:[]};
 try{
  await target.goto(`/#/game/${game.id}`);
  await expect.poll(()=>firstFrame).not.toBe(null);
  await offlineWork;
  await expect.poll(()=>target.evaluate(()=>window.__recoveryNativeCloses)).toContainEqual({code:1006,clean:false});
  await expect.poll(()=>target.locator('[data-board-preview-action]:enabled').count()).toBe(0);
  await expect.poll(async()=>{
   evidence=await recoveryEvidence(target);
   return evidence.timeline.some(event=>event.type==='socket'&&event.reason==='socket_closed'&&event.closeCode===1006&&event.closeClean===false);
  }).toBe(true);
  const closed=evidence.timeline.find(event=>event.type==='socket'&&event.reason==='socket_closed'&&event.closeCode===1006);
  expect(closed).toMatchObject({activeEpisodeRelation:'active',closeClean:false});
  expect(closed.ownerAction).toBeUndefined();

  await context.setOffline(false);
  await expect.poll(async()=>{
   evidence=await recoveryEvidence(target);
   const closeIndex=evidence.timeline.findIndex(event=>event.eventId===closed.eventId);
   return evidence.timeline.some((event,index)=>index>closeIndex&&event.type==='readiness'&&event.gate==='ready'&&event.socketGeneration>1);
  }).toBe(true);
  await expect(target.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0);
  await expect(target.locator('[data-board-preview-action="pass"]')).toBeEnabled();
  expect(firstFrame.socketCount).toBe(1);
  expect(socketCount).toBeGreaterThan(1);
  evidence=await recoveryEvidence(target);
 }finally{
  await context.setOffline(false).catch(()=>{});
  await info.attach('single-1006-recovery-evidence',{body:JSON.stringify({gameId:game.id,firstFrame,socketCount,...evidence},null,2),contentType:'application/json'});
  await target.close();
 }
});
