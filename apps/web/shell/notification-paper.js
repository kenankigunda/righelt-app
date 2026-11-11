export const PAPER_INFORMATION_KINDS=Object.freeze(['history-change','undo-outcome']);
export const PAPER_TIMING=Object.freeze({offset:100,opening:386,drop:230,refurl:370,departure:520});
const interactiveSelector='button,a,input,select,textarea,summary,details,[data-action],[contenteditable="true"],[role="button"],[tabindex]:not([tabindex="-1"])';
export const paperInformationEligible=({kind,priority='normal',tone='',activity='static',count=1,active=true,interactive=false,focused=false}={})=>
  PAPER_INFORMATION_KINDS.includes(kind)&&priority==='normal'&&!['warn','danger'].includes(tone)&&activity==='static'&&count===1&&active&&!interactive&&!focused;
const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
export const paperFrame=(phase,elapsed,{progress=phase==='enter'?0:1,elevation=phase==='enter'?54:0}={})=>phase==='enter'
  ?{progress:progress+(1-progress)*smooth((elapsed-PAPER_TIMING.offset)/PAPER_TIMING.opening),elevation:elevation*(1-smooth(elapsed/PAPER_TIMING.drop))}
  :{progress:progress*(1-smooth(elapsed/PAPER_TIMING.refurl)),elevation:elevation+(58-elevation)*smooth((elapsed-320)/200)};
export const paperPolygon=progress=>{
 const k=.08+1.92*clamp(progress),points=[[0,0],[1,0],[1,1],[0,1]],out=[];
 for(let i=0;i<4;i++){
  const a=points[i],b=points[(i+1)%4],da=a[0]+a[1]-k,db=b[0]+b[1]-k;
  if(da<=0)out.push(a);
  if((da>=0)!==(db>=0)){const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
 }
 return progress>=.999?'none':`polygon(${out.map(v=>`${v[0]*100}% ${v[1]*100}%`).join(',')})`;
};

export const createNotificationPaper=({document:doc=globalThis.document,sound,scope=()=>'',
  active=()=>!doc.hidden&&doc.hasFocus()&&!doc.querySelector?.('dialog:modal'),reduced=()=>globalThis.matchMedia?.('(prefers-reduced-motion:reduce)').matches??false,
  now=()=>performance.now(),requestFrame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id)}={})=>{
 let currentScope=null,primed=false,serial=0,raf=null,capture=null;
 const records=new Map(),exits=new Set();
 const measure=(card,paper)=>{
  const eligible=paperInformationEligible({kind:card.dataset.paperKind,priority:card.dataset.paperPriority,tone:paper.classList.contains('danger')?'danger':paper.classList.contains('warn')?'warn':'',activity:paper.dataset.notificationActivity??'static',count:Number(card.dataset.stackCount),active:card.classList.contains('is-active'),interactive:Boolean(paper.querySelector(interactiveSelector)),focused:card.contains(doc.activeElement)});
  const face=paper.querySelector('.notice-paper-face'),styles=doc.defaultView?.getComputedStyle??globalThis.getComputedStyle;
  const visualReady=Boolean(face&&styles?.call(doc.defaultView??globalThis,face).position==='absolute');
  const rect=paper.getBoundingClientRect(),copyRect=paper.querySelector('.shell-game-alert-copy')?.getBoundingClientRect();
  const view=doc.defaultView??globalThis,visible=rect.width>0&&rect.height>0&&rect.right>0&&rect.bottom>0&&rect.left<(view.innerWidth??Infinity)&&rect.top<(view.innerHeight??Infinity);
  const ink=copyRect&&rect.width>0&&rect.height>0?{right:(copyRect.right-rect.left)/rect.width,bottom:(copyRect.bottom-rect.top)/rect.height}:null;
  return{eligible,visualReady,rect,ink,visible};
 };
 const clearPaint=node=>{
  node.style.removeProperty('clip-path');node.style.removeProperty('transform');node.style.removeProperty('opacity');
  for(const child of node.querySelectorAll('.notice-paper-face,.notice-paper-curl'))child.removeAttribute('style');
  node.querySelector('.shell-game-alert-copy')?.style.removeProperty('opacity');
 };
 const paint=(record,frame)=>{
  record.painted=true;
  const node=record.paper,face=node.querySelector('.notice-paper-face'),curl=node.querySelector('.notice-paper-curl');
  node.style.clipPath=paperPolygon(frame.progress);
  if(face){face.style.transform=`perspective(600px) translateZ(${frame.elevation}px) rotateX(${frame.elevation*.045}deg)`;face.style.opacity=String(smooth((54-frame.elevation)/38));}
  if(curl){
   const {width:w,height:h}=record.rect,k=.08+1.92*frame.progress;
   const a=k>1?[w*(k-1),h]:[0,h*k],b=k>1?[w,h*(k-1)]:[w*k,0],dx=b[0]-a[0],dy=b[1]-a[1],band=5+12*Math.sin(Math.PI*frame.progress);
   curl.style.width=`${Math.hypot(dx,dy)+3}px`;curl.style.height=`${band}px`;
   curl.style.transform=`translate(${a[0]}px,${a[1]-band/2}px) rotate(${Math.atan2(dy,dx)*180/Math.PI}deg)`;
   curl.style.opacity=frame.progress>.96?String((1-frame.progress)/.04):'1';
  }
  const copy=node.querySelector('.shell-game-alert-copy');
  if(copy&&record.ink){const k=.08+1.92*frame.progress;copy.style.opacity=frame.progress>=.999||record.ink.right+record.ink.bottom<=k-.025?'1':'0';}
  if(record.phase==='retire')node.style.transform=`perspective(600px) translateZ(${frame.elevation}px)`;
 };
 const settle=record=>{record.phase=null;if(record.painted){clearPaint(record.paper);record.painted=false;}};
 const animate=()=>{
  raf=null;const at=now();if(!active()){cancel();return;}
  for(const record of [...records.values(),...exits]){
   if(!record.phase)continue;
   if(!active()||reduced()){if(exits.has(record)){record.host.remove();exits.delete(record);}else settle(record);continue;}
   const elapsed=at-record.start,duration=record.phase==='enter'?PAPER_TIMING.offset+PAPER_TIMING.opening:PAPER_TIMING.departure;
   paint(record,paperFrame(record.phase,elapsed,record.origin));
   if(elapsed>=duration){if(exits.has(record)){record.host.remove();exits.delete(record);}else settle(record);}
  }
  if([...records.values(),...exits].some(r=>r.phase))raf=requestFrame(animate);
 };
 const schedule=()=>{if(raf===null)raf=requestFrame(()=>{try{animate();}catch{safeCancel();}});};
 const cancel=()=>{
  capture=null;
  if(raf!==null)cancelFrame(raf);raf=null;
  for(const r of records.values())settle(r);
  for(const r of exits)r.host.remove();exits.clear();sound?.cancelPaper?.();
 };
 const retireAll=()=>{cancel();records.clear();currentScope=null;primed=false;};
 const captureBeforePatch=()=>{
  capture=null;
  if(currentScope!==scope()||!active())return;
  const region=doc.getElementById('shell-game-alerts'),snapshots=new Map();
  for(const record of records.values()){
   if(record.paper.isConnected&&region?.contains(record.card))snapshots.set(record,measure(record.card,record.paper));
  }
  capture={scope:currentScope,snapshots};
 };
 const sync=()=>{
  const nextScope=scope();if(currentScope!==nextScope){retireAll();currentScope=nextScope;}
  const ownCapture=capture;capture=null;
  const region=doc.getElementById('shell-game-alerts');if(!region){retireAll();return;}
  const present=new Set(),at=now();let entered=false,immediate=false;
  for(const card of region.querySelectorAll(':scope > [data-notification-id]')){
   const key=card.dataset.notificationId,paper=card.querySelector('.shell-game-alert');if(!key||!paper)continue;
   paper.style.animation='none';
   present.add(key);
   const {eligible,visualReady,rect,ink,visible}=measure(card,paper);
   if(card.classList.contains('is-active')&&!eligible)immediate=true;
   let record=records.get(key);
   if(!record){record={paper,card,key,token:`${nextScope}:${++serial}`,eligible,visible,visualReady,rect,ink,phase:null,start:at};records.set(key,record);
    if(primed&&eligible&&visible&&active()){
     entered=true;sound?.paper?.('enter',{key:record.token,eventAt:at,delayMs:reduced()?0:PAPER_TIMING.offset});
     if(!reduced()&&visualReady){record.phase='enter';paint(record,paperFrame('enter',0));schedule();}
    }
   }else{
    record.paper=paper;record.card=card;record.eligible=eligible;record.visible=visible;record.visualReady=visualReady;record.rect=rect;record.ink=ink;
    if(!eligible||!visible||!active()){sound?.cancelPaper?.();settle(record);}
    else if(reduced()||!visualReady)settle(record);
    else if(record.phase)paint(record,paperFrame(record.phase,at-record.start));
   }
  }
  if(immediate){for(const exit of exits)exit.host.remove();exits.clear();sound?.cancelPaper?.();}
  for(const [key,record]of records){if(present.has(key))continue;records.delete(key);
   const retired=ownCapture?.scope===nextScope?ownCapture.snapshots.get(record):null;
   if(immediate||!retired?.eligible||!retired.visible||!active())continue;
   Object.assign(record,retired);
   if(!entered)sound?.paper?.('retire',{key:record.token,eventAt:at});
   if(reduced()||!record.visualReady)continue;
   // The retired semantic node is already gone. This bounded paint snapshot
   // has no controls, IDs, live region, incident attributes or app models.
   for(const old of exits)old.host.remove();exits.clear();
   const host=doc.createElement('div'),paper=doc.createElement('div'),copy=doc.createElement('div');
   host.className='notice-paper-exit';host.inert=true;host.setAttribute('aria-hidden','true');
   Object.assign(host.style,{left:`${record.rect.left}px`,top:`${record.rect.top}px`,width:`${record.rect.width}px`,height:`${record.rect.height}px`});
   paper.className='shell-game-alert alert notice-paper-snapshot';copy.className='shell-game-alert-copy';copy.textContent=record.paper.querySelector('.shell-game-alert-copy')?.textContent??'';
   for(const name of ['notice-paper-face','notice-paper-curl']){const part=doc.createElement('span');part.className=name;part.hidden=true;part.setAttribute('aria-hidden','true');paper.append(part);}
   paper.append(copy);host.append(paper);doc.body.append(host);
   const elapsed=record.phase==='enter'?at-record.start:null,origin=elapsed===null?{progress:1,elevation:0}:paperFrame('enter',elapsed);
   const exit={paper,host,rect:record.rect,ink:record.ink,phase:'retire',start:at,origin};exits.add(exit);paint(exit,origin);schedule();
  }
  primed=true;
 };
 const safeCancel=()=>{try{cancel();}catch{if(raf!==null)cancelFrame(raf);raf=null;for(const record of records.values()){record.phase=null;record.paper.removeAttribute('style');}for(const record of exits)record.host.remove();exits.clear();}};
 return{captureBeforePatch(){try{captureBeforePatch();}catch{capture=null;safeCancel();}},sync(){try{sync();}catch{safeCancel();}},cancel:safeCancel,retire(){safeCancel();records.clear();currentScope=null;primed=false;}};
};
