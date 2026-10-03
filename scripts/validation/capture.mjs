import {writeFile} from 'node:fs/promises';

// Fixed/sticky surfaces change position while scrolling; stitching them would
// invent repeated UI. Keep viewport proof instead of claiming a full document.
export async function canCaptureFullPage(page) {
 return page.evaluate(()=>!Array.from(document.querySelectorAll('*')).some(e=>{
  const s=getComputedStyle(e),r=e.getBoundingClientRect();
  return (['fixed','sticky'].includes(s.position)||e.matches('dialog[open],[aria-modal="true"]'))&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
 }));
}

// Beyond-viewport Chromium capture can silently render hover CSS and disable
// touch. Capture mobile evidence as viewport tiles, retaining actual input mode.
export async function capture(page,target=page,options={}) {
 if(options.clip||options.quality!==undefined||(options.type&&options.type!=='png'))throw Error('Evidence capture supports PNG without caller clip or quality; use a component locator for visible crops');
 const before=await page.evaluate(()=>({touch:navigator.maxTouchPoints,hover:matchMedia('(any-hover: hover)').matches,x:scrollX,y:scrollY}));
 let bytes;
 try {
  if(target!==page){
   const region=await target.evaluate(element=>{
    const r=element.getBoundingClientRect();let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
    for(let p=element.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();
     if(s.overflowX!=='visible'){left=Math.max(left,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth);}
     if(s.overflowY!=='visible'){top=Math.max(top,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight);}
    }
    return {x:Math.ceil(left),y:Math.ceil(top),width:Math.floor(right)-Math.ceil(left),height:Math.floor(bottom)-Math.ceil(top)};
   });
   if(region.width<=0||region.height<=0)throw Error('Evidence component has no visible pixels; reveal it before capture');
   const {path:outputPath,...viewportOptions}=options;
   const image=await page.screenshot({...viewportOptions,fullPage:false,scale:'css',animations:'disabled'});
   const encoded=await page.evaluate(async({image,r})=>{const i=new Image();i.src=`data:image/png;base64,${image}`;await i.decode();const c=document.createElement('canvas');c.width=r.width;c.height=r.height;c.getContext('2d').drawImage(i,r.x,r.y,r.width,r.height,0,0,r.width,r.height);return c.toDataURL('image/png').split(',')[1];},{image:image.toString('base64'),r:region});
   bytes=Buffer.from(encoded,'base64');if(outputPath)await writeFile(outputPath,bytes);
  } else if(options.fullPage&&!await canCaptureFullPage(page)) {
   throw Error('Full-page evidence is unsafe with fixed, sticky or modal surfaces; capture viewport context instead');
  } else if(!before.touch || (target===page&&!options.fullPage)) {
   bytes=await target.screenshot({animations:'disabled',...options});
  } else {
   const region=await page.evaluate(()=>({x:0,y:0,width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
   region.x=Math.floor(region.x);region.y=Math.floor(region.y);region.width=Math.ceil(region.width);region.height=Math.ceil(region.height);
   if(region.width<=0||region.height<=0)throw Error('Cannot capture an empty evidence region');
   const tiles=[];
   for(let y=region.y;y<region.y+region.height;){
    let rowHeight=Infinity;
    for(let x=region.x;x<region.x+region.width;){
     await page.evaluate(async({x,y})=>{scrollTo({left:x,top:y,behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},{x,y});
     const view=await page.evaluate(()=>({x:scrollX,y:scrollY,width:innerWidth,height:innerHeight}));
     const sx=x-view.x,sy=y-view.y,width=Math.min(view.width-sx,region.x+region.width-x),height=Math.min(view.height-sy,region.y+region.height-y);
     if(width<=0||height<=0)throw Error('Evidence region is outside the scrollable viewport');
     const {path:outputPath,...tileOptions}=options;
     const image=await page.screenshot({...tileOptions,fullPage:false,scale:'css',animations:'disabled'});
     tiles.push({image:image.toString('base64'),sx,sy,width,height,dx:x-region.x,dy:y-region.y});
     rowHeight=Math.min(rowHeight,height);x+=width;
    }
    y+=rowHeight;
   }
   const encoded=await page.evaluate(async({tiles,region})=>{const canvas=document.createElement('canvas');canvas.width=region.width;canvas.height=region.height;const context=canvas.getContext('2d');for(const tile of tiles){const image=new Image();image.src=`data:image/png;base64,${tile.image}`;await image.decode();context.drawImage(image,tile.sx,tile.sy,tile.width,tile.height,tile.dx,tile.dy,tile.width,tile.height);}return canvas.toDataURL('image/png').split(',')[1];},{tiles,region});
   bytes=Buffer.from(encoded,'base64');
   if(options.path)await writeFile(options.path,bytes);
  }
 } finally {
  await page.evaluate(({x,y})=>scrollTo({left:x,top:y,behavior:'instant'}),before);
 }
 const after=await page.evaluate(()=>({touch:navigator.maxTouchPoints,hover:matchMedia('(any-hover: hover)').matches}));
 if(after.touch!==before.touch||after.hover!==before.hover)throw Error('Screenshot changed browser input emulation');
 return bytes;
}
