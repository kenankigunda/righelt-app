import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {capture} from '../capture.mjs';
const browser=await chromium.launch();
try{
 for(const touch of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:touch,hasTouch:touch});
  const page=await context.newPage();
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:white}#secret{background:#00ff00;width:200px;height:100px;margin:20px}#long{height:1000px}</style><div id="secret">Synthetic private code</div><div id="long"></div>');
  const secret=page.locator('#secret');
  for(const [target,fullPage]of [[page,false],[secret,false],[page,true]]){
   const bytes=await capture(page,target,{fullPage,mask:[secret],maskColor:'#ff00ff'});
   const pixels=await page.evaluate(async base64=>{
    const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;
    let green=0,magenta=0;for(let i=0;i<data.length;i+=4){if(data[i]<10&&data[i+1]>245&&data[i+2]<10)green++;if(data[i]>245&&data[i+1]<10&&data[i+2]>245)magenta++;}return {green,magenta};
   },bytes.toString('base64'));
   assert.equal(pixels.green,0,'private region cannot leak in any image path');assert.ok(pixels.magenta>1000,'mask must visibly replace the private region');
  }
  await context.close();
 }
 console.log('Private-code masking passed for desktop/mobile context, component and full-page captures.');
}finally{await browser.close();}
