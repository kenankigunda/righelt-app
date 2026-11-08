import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

// Start at the candidate's direct dependency, not a top-level transitive alias
// or an ancestor/global resolver. Follow that package's actual pnpm closure.
export function resolveCandidatePlaywright(candidate){
 if(!path.isAbsolute(candidate))throw Error('Absolute own candidate required');
 const directTest=path.join(candidate,'node_modules/@playwright/test');
 const testRoot=fs.realpathSync(directTest),testPackage=path.join(testRoot,'package.json');
 const ownTest=createRequire(testPackage),playwrightPackage=fs.realpathSync(ownTest.resolve('playwright/package.json'));
 const ownPlaywright=createRequire(playwrightPackage),corePackage=fs.realpathSync(ownPlaywright.resolve('playwright-core/package.json'));
 const readPackage=(file,name)=>{
  const bytes=fs.readFileSync(file),data=JSON.parse(bytes);
  if(data.name!==name||data.version!=='1.59.1')throw Error('Unexpected own Playwright package '+name);
  return{file,root:path.dirname(file),name:data.name,version:data.version,rawByteSHA256:createHash('sha256').update(bytes).digest('hex')};
 };
 const packages={test:readPackage(testPackage,'@playwright/test'),playwright:readPackage(playwrightPackage,'playwright'),core:readPackage(corePackage,'playwright-core')};
 const original=ownTest('@playwright/test');
 if(!original.webkit||typeof original.webkit.executablePath!=='function')throw Error('Own original WebKit BrowserType unavailable');
 // browsers.json is package data, not an exported package subpath. Read it only
 // after resolving the actual core package root through its owning dependency.
 const browsersFile=path.join(packages.core.root,'browsers.json'),bytes=fs.readFileSync(browsersFile),browsers=JSON.parse(bytes);
 if(!Array.isArray(browsers.browsers)||!browsers.browsers.some(row=>row.name==='webkit'))throw Error('Own browser metadata unavailable');
 return{original,webkit:original.webkit,provenance:{directTest,packages,browsersFile,browsersRawByteSHA256:createHash('sha256').update(bytes).digest('hex'),browsers}};
}
