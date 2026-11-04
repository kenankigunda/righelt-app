import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('const liveBoardVisible ='),end=source.indexOf('const syncConfirmedPlayback =',start);
const declaration=source.slice(start,end);
function visible({covered=false,replaying=false,scenarios=false,phase='idle',debug=false,layout='narrow',history=false,panel='board',hidden=false,focused=true}={}){
 const hit={},cover={},wrapper={contains:node=>node===hit},board={getBoundingClientRect:()=>({left:10,right:380,top:230,bottom:600,width:370,height:370}),closest:()=>wrapper};
 const document={hidden,hasFocus:()=>focused,elementFromPoint:()=>covered?cover:hit};
 const appEl={dataset:{shellTransitionPhase:phase},querySelector:()=>board};
 return Function('document','currentRoute','transport','getShellLayoutMode','appEl','window','replayController',`${declaration};return liveBoardVisible;`)(document,{name:'game',gameId:'g',panel,debug,scenarios},{getGameViewModel:()=>({inHistoryMode:history})},()=>layout,appEl,{innerWidth:390,innerHeight:450},{snapshot:()=>({playing:replaying})})();
}
test('actual visibility excludes utility occlusion while retaining a visible docked Board',()=>{
 assert.equal(visible(),true);
 assert.equal(visible({covered:true,debug:true}),false,'a visible rectangle behind a utility is not a seen Live Board');
 assert.equal(visible({debug:true,layout:'wide'}),true,'a docked utility does not hide a genuinely visible Live Board');
});
test('actual visibility follows live intent rather than a historical replay, editor or route cover',()=>{
 for(const state of [{replaying:true},{scenarios:true},{phase:'covering'},{phase:'covered-waiting'}])assert.equal(visible(state),false,JSON.stringify(state));
});
test('actual visibility retains History, other-panel and foreground boundaries',()=>{
 for(const state of [{history:true},{panel:'players'},{hidden:true},{focused:false}])assert.equal(visible(state),false,JSON.stringify(state));
});
