import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('trusted native paper audio shares mute and yields to gameplay independently of reduced motion',async({page},info)=>{
  let primaryError,proof;
  try {
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto('/browser-integration/support/notifications.html');
    await page.waitForFunction(()=>window.fixtureReady===true);
    await page.bringToFront();
    await page.evaluate(async()=>{
      const {createGameSound,SOUND_KEY}=await import('/apps/web/shell/sound.js');
      if(!globalThis.AudioBufferSourceNode||!globalThis.BaseAudioContext)throw Error('Native Web Audio constructors unavailable');
      const sourcePrototype=AudioBufferSourceNode.prototype,decodePrototype=BaseAudioContext.prototype;
      const descriptors={start:Object.getOwnPropertyDescriptor(sourcePrototype,'start'),stop:Object.getOwnPropertyDescriptor(sourcePrototype,'stop'),decode:Object.getOwnPropertyDescriptor(decodePrototype,'decodeAudioData')};
      const nativeStart=sourcePrototype.start,nativeStop=sourcePrototype.stop;
      if(typeof nativeStart!=='function'||typeof nativeStop!=='function'||!descriptors.decode?.value)throw Error('Native Web Audio observation boundary unavailable');
      const events=[],decodes=[],actions=[],errors=[],contexts=new Set(),bufferHashes=new WeakMap(),sourceIds=new WeakMap();
      let sequence=0,sourceId=0,overflow=0,sound;
      const oldPreference=localStorage.getItem(SOUND_KEY),controls=document.createElement('div');
      controls.setAttribute('aria-label','Native paper audio fixture');document.body.append(controls);
      const bounded=(target,value)=>{if(target.length<64)target.push(value);else overflow++;};
      const hex=bytes=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
      const observeSource=(source,kind,args)=>{
        if(!sourceIds.has(source))sourceIds.set(source,++sourceId);
        bounded(events,{sequence:++sequence,kind,id:sourceIds.get(source),bufferHash:bufferHashes.get(source.buffer)??null,nativeSource:source instanceof AudioBufferSourceNode,nativeBuffer:source.buffer instanceof AudioBuffer,when:args[0]??null});
      };
      sourcePrototype.start=function(...args){const result=Reflect.apply(nativeStart,this,args);observeSource(this,'start',args);return result;};
      sourcePrototype.stop=function(...args){const result=Reflect.apply(nativeStop,this,args);observeSource(this,'stop',args);return result;};
      decodePrototype.decodeAudioData=function(...args){
        // Observe a copy: the real decoder may detach its original input. Return
        // its original promise unchanged to the production preparation owner.
        const bytes=args[0].slice(0);contexts.add(this);
        const digest=crypto.subtle.digest('SHA-256',bytes);
        const result=Reflect.apply(descriptors.decode.value,this,args);
        void Promise.all([digest,result]).then(([hash,buffer])=>{
          const sha256=hex(hash);bufferHashes.set(buffer,sha256);
          bounded(decodes,{sha256,bytes:bytes.byteLength,nativeBuffer:buffer instanceof AudioBuffer,duration:buffer.duration,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels});
        }).catch(error=>bounded(errors,String(error)));
        return result;
      };
      const snapshot=()=>({events:[...events],decodes:[...decodes],actions:[...actions],errors:[...errors],overflow,contextStates:[...contexts].map(context=>context.state)});
      window.__paperAudioNative={snapshot,async close(){
        const cleanupErrors=[];
        try {sound?.disposePaper();sound?.hide();}catch(error){cleanupErrors.push(String(error));}
        finally {
          if(descriptors.start)Object.defineProperty(sourcePrototype,'start',descriptors.start);else delete sourcePrototype.start;
          if(descriptors.stop)Object.defineProperty(sourcePrototype,'stop',descriptors.stop);else delete sourcePrototype.stop;
          Object.defineProperty(decodePrototype,'decodeAudioData',descriptors.decode);
          controls.remove();if(oldPreference===null)localStorage.removeItem(SOUND_KEY);else localStorage.setItem(SOUND_KEY,oldPreference);
        }
        for(const context of contexts)try {await context.close();}catch(error){cleanupErrors.push(String(error));}
        const result={...snapshot(),cleanupErrors,restored:sourcePrototype.start===nativeStart&&sourcePrototype.stop===nativeStop&&Object.getOwnPropertyDescriptor(decodePrototype,'decodeAudioData').value===descriptors.decode.value,closedContexts:[...contexts].map(context=>context.state),preferenceRestored:localStorage.getItem(SOUND_KEY)===oldPreference};
        delete window.__paperAudioNative;return result;
      }};
      localStorage.setItem(SOUND_KEY,'true');sound=createGameSound({storage:localStorage});
      const button=(label,operation)=>{
        const element=document.createElement('button');element.textContent=label;element.type='button';controls.append(element);
        element.addEventListener('click',event=>{
          const record={label,trusted:event.isTrusted,activation:navigator.userActivation.isActive,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
          try {Object.assign(record,operation(event));}catch(error){record.error=String(error);bounded(errors,String(error));}
          bounded(actions,record);
        });
      };
      button('Unlock native paper audio',event=>{sound.gesture();return{prepared:sound.preparePaper(event)};});
      button('Play native paper enter',()=>({played:sound.paper('enter',{key:'original-pair',eventAt:performance.now()})}));
      button('Play native paper retire',()=>({played:sound.paper('retire',{key:'original-pair',eventAt:performance.now()})}));
      button('Mute native paper audio',event=>({enabled:sound.toggle(),prepared:sound.preparePaper(event),played:sound.paper('enter',{key:'muted-reduced',eventAt:performance.now()})}));
      button('Try muted native paper audio',event=>({enabled:sound.enabled(),prepared:sound.preparePaper(event),played:sound.paper('enter',{key:'muted-normal',eventAt:performance.now()})}));
      button('Unmute native paper audio',event=>({enabled:sound.toggle(),prepared:sound.preparePaper(event)}));
      button('Gameplay interrupts native paper',()=>({paper:sound.paper('enter',{key:'gameplay-priority',eventAt:performance.now()}),gameplay:sound.play('move'),blockedRetire:sound.paper('retire',{key:'gameplay-priority',eventAt:performance.now()})}));
    });
    await page.getByRole('button',{name:'Unlock native paper audio',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>{const value=window.__paperAudioNative.snapshot();return value.decodes.length===2&&value.contextStates.length===1&&value.contextStates.every(state=>state==='running');})).toBe(true);
    await page.getByRole('button',{name:'Play native paper enter',exact:true}).click();
    await page.getByRole('button',{name:'Play native paper retire',exact:true}).click();
    await page.getByRole('button',{name:'Mute native paper audio',exact:true}).click();
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.getByRole('button',{name:'Try muted native paper audio',exact:true}).click();
    await page.getByRole('button',{name:'Unmute native paper audio',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.__paperAudioNative.snapshot().contextStates.every(state=>state==='running'))).toBe(true);
    await page.getByRole('button',{name:'Gameplay interrupts native paper',exact:true}).click();
    proof=await page.evaluate(()=>window.__paperAudioNative.snapshot());
    expect(proof.errors).toEqual([]);expect(proof.overflow).toBe(0);
    expect(proof.decodes.map(value=>value.sha256).sort()).toEqual(['00a58475f55f1368bb18b0ad96579029929c5fd7bc2e088a725b77574d8a68d2','1cd93401257c961e10f0c62b7522003753047f9f81c7b40d7dfa1e849fc71b90']);
    expect(proof.decodes.every(value=>value.nativeBuffer&&value.duration>0&&value.duration<1&&value.channels>0)).toBe(true);
    expect(proof.actions.map(value=>({label:value.label,trusted:value.trusted,activation:value.activation}))).toEqual([
      'Unlock native paper audio','Play native paper enter','Play native paper retire','Mute native paper audio','Try muted native paper audio','Unmute native paper audio','Gameplay interrupts native paper',
    ].map(label=>({label,trusted:true,activation:true})));
    const [unlock,enter,retire,mutedReduced,mutedNormal,unmute,priority]=proof.actions;
    expect(unlock.prepared).toBe(true);expect(enter.played).toBe(true);expect(retire.played).toBe(true);expect(enter.reducedMotion).toBe(true);expect(retire.reducedMotion).toBe(true);
    expect([mutedReduced.enabled,mutedReduced.prepared,mutedReduced.played,mutedNormal.enabled,mutedNormal.prepared,mutedNormal.played]).toEqual([false,false,false,false,false,false]);
    expect(mutedReduced.reducedMotion).toBe(true);expect(mutedNormal.reducedMotion).toBe(false);expect(unmute.enabled).toBe(true);expect(unmute.prepared).toBe(true);
    expect([priority.paper,priority.gameplay,priority.blockedRetire]).toEqual([true,true,false]);
    const starts=proof.events.filter(value=>value.kind==='start');expect(starts.map(value=>value.bufferHash)).toEqual(['1cd93401257c961e10f0c62b7522003753047f9f81c7b40d7dfa1e849fc71b90','00a58475f55f1368bb18b0ad96579029929c5fd7bc2e088a725b77574d8a68d2','1cd93401257c961e10f0c62b7522003753047f9f81c7b40d7dfa1e849fc71b90',null]);
    expect(starts.every(value=>value.nativeSource&&value.nativeBuffer)).toBe(true);
    const interrupted=proof.events.find(value=>value.kind==='stop'&&value.id===starts[2].id);expect(interrupted).toBeDefined();expect(interrupted.sequence).toBeGreaterThan(starts[2].sequence);expect(interrupted.sequence).toBeLessThan(starts[3].sequence);
  } catch(error) {primaryError=error;}
  try {
    const closed=await page.evaluate(async()=>window.__paperAudioNative?await window.__paperAudioNative.close():null);
    proof={...proof,cleanup:closed,claim:'Native API scheduling, decode, mute and priority; no acoustic or hardware-output claim.'};
    if(closed){expect(closed.cleanupErrors).toEqual([]);expect(closed.restored).toBe(true);expect(closed.preferenceRestored).toBe(true);expect(closed.closedContexts).toEqual(['closed']);}
  } catch(error) {primaryError=primaryError?new AggregateError([primaryError,error],'Native paper audio and cleanup failed'):error;}
  try {
    const file=info.outputPath('native-paper-audio.json');await writeFile(file,JSON.stringify({...proof,error:primaryError?.message??null},null,2));await info.attach('Native paper audio scheduling',{path:file,contentType:'application/json'});
  } catch(error) {primaryError=primaryError?new AggregateError([primaryError,error],'Native paper audio evidence failed'):error;}
  if(primaryError)throw primaryError;
});
