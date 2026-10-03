import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {hash} from './model.mjs';
import {capture} from './capture.mjs';
export async function proof(page,info,label,locator){
 if(!process.env.RIGHELT_EVIDENCE_DIR)return;
 const dir=path.join(process.env.RIGHELT_EVIDENCE_DIR,'images');await mkdir(dir,{recursive:true});const images=[];
 for(const [kind,target,options]of [['context',page,{fullPage:false}],['component',locator,{}]]){
   const bytes=await capture(page,target,options);const digest=hash(bytes);const name=`${info.project.name}-${label}-${kind}-${digest.slice(0,12)}.png`;await writeFile(path.join(dir,name),bytes);
   const thumb=await page.evaluate(async base64=>{const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();const c=document.createElement('canvas');c.width=Math.min(480,image.width);c.height=Math.round(image.height*c.width/image.width);c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];},bytes.toString('base64'));await writeFile(path.join(dir,`thumb-${name}`),Buffer.from(thumb,'base64'));
   images.push({src:`images/${name}`,thumbnail:`images/thumb-${name}`,caption:`${label} · ${info.project.name} · ${kind}`,digest});
 }
 if(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+10)){const bytes=await capture(page,page,{fullPage:true});const digest=hash(bytes);const name=`${info.project.name}-${label}-full-${digest.slice(0,12)}.png`;await writeFile(path.join(dir,name),bytes);const thumb=await page.evaluate(async base64=>{const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();const c=document.createElement('canvas');c.width=Math.min(480,image.width);c.height=Math.round(image.height*c.width/image.width);c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];},bytes.toString('base64'));await writeFile(path.join(dir,`thumb-${name}`),Buffer.from(thumb,'base64'));images.push({src:`images/${name}`,thumbnail:`images/thumb-${name}`,caption:`${label} · full page${info.project.use.hasTouch?' (stitched viewport captures)':''}`,digest});}
 await info.attach('proof',{body:JSON.stringify(images),contentType:'application/json'});
 return images;
}
