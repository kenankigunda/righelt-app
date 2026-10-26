import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
test('real offline Web Audio renders one dry finite stone fracture',async({page},info)=>{
 await page.goto('/browser-integration/support/result-feedback.html');
 const proof=await page.evaluate(async()=>{
  const {playStoneCrack}=await import('/apps/web/shell/destruction-sound.js');
  const audio=new OfflineAudioContext(1,Math.ceil(44100*.25),44100);playStoneCrack(audio);
  const rendered=await audio.startRendering(),data=[...rendered.getChannelData(0)];
  const rms=(from,to)=>Math.sqrt(data.slice(from*44100,to*44100).reduce((sum,n)=>sum+n*n,0)/((to-from)*44100));
  return {sampleRate:rendered.sampleRate,data,peak:Math.max(...data.map(Math.abs)),attack:rms(0,.02),tail:rms(.11,.13),silence:rms(.14,.24)};
 });
 expect(proof.peak).toBeGreaterThan(.02);expect(proof.peak).toBeLessThan(.4);expect(proof.attack).toBeGreaterThan(proof.tail*30);expect(proof.silence).toBeLessThan(.00001);
 const bytes=Buffer.alloc(44+proof.data.length*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(proof.sampleRate,24);bytes.writeUInt32LE(proof.sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);proof.data.forEach((n,i)=>bytes.writeInt16LE(Math.round(Math.max(-1,Math.min(1,n))*32767),44+i*2));
 await writeFile(info.outputPath('stone-crack.wav'),bytes);await writeFile(info.outputPath('audio-metrics.json'),JSON.stringify({...proof,data:undefined},null,2));await info.attach('Stone crack preview',{path:info.outputPath('stone-crack.wav'),contentType:'audio/wav'});
});
