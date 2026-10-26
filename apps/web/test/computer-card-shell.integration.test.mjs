import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {renderPlayersPanel} from '../shell/players-panel.js';

const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const extract=(start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);};
const update=extract('const updateParticipantCards =','const joinFeedback=');
const mounted=extract('const updateMountedGameShell =','const doesMountedFlyoutStateMatchRoute =');
const toggle=extract("  if (action === 'toggle-computer-card')", "  if (action === 'computer-control')");

function harness(){
 class Element{matches(){return false;}}
 const expandedComputerCards=new Map(),patches=[];
 let activity={label:'Needs attention',state:'attention',showResume:true};
 const game={id:'g',myRole:'Player 1',player1:{identityId:'me'},player2:{computerProfile:'babs'},viewers:[]};
 const toggleButton=new Element();toggleButton.dataset={action:'toggle-computer-card',computerSide:'P2'};toggleButton.isConnected=true;
 const resume=new Element();resume.dataset={control:'resume-here',computerSide:'P2'};resume.isConnected=true;resume.disabled=false;
 const document={activeElement:toggleButton,body:{},getElementById:()=>null,querySelector:()=>({}),createElement:()=>({set innerHTML(value){this.firstElementChild={html:value};}})};
 toggleButton.focus=()=>{document.activeElement=toggleButton;};
 const list=new Element();list.contains=node=>[toggleButton,resume].includes(node);list.querySelector=selector=>selector.includes('toggle-computer-card')&&selector.includes('P2')?toggleButton:null;
 const join=new Element();join.contains=list.contains;join.getBoundingClientRect=()=>({height:200});
 Object.defineProperty(join,'innerHTML',{set(){assert.fail('A join update must preserve the mounted card/control nodes.');}});
 join.querySelector=selector=>selector.includes('toggle-computer-card')&&selector.includes('P2')?toggleButton:null;
 const query=selector=>selector==='[data-testid="participants-list"]'?list:selector==='[data-game-panel="join"]'?join:null;
 const root=new Element();root.querySelector=query;
 const appEl={querySelector:query};
 const renderParticipantsPanel=()=>renderPlayersPanel(game,{identityId:'me',expandedComputers:expandedComputerCards.get('g'),computerActivity:activity});
 const context={HTMLElement:Element,HTMLInputElement:class{},CSS:{escape:value=>value},document,appEl,expandedComputerCards,renderParticipantsPanel,
  patchSectionContent:(current,next)=>{assert.equal(current,list);patches.push(['players',next.html]);if(!next.html.includes('>Resume here</button>'))resume.isConnected=false;},
  patchToolHtml:(current,html)=>{assert.equal(current,join);patches.push(['join',html]);},inlineProfiles:{sync(){}},
  transport:{getGameViewModel:()=>game},getMountedGameShellRoot:()=>root,window:{location:{origin:'https://local',pathname:'/'}},
  buildInviteHash:()=> '#/invite/g',getCurrentFlyoutState:()=>({}),renderJoinInvitePanel:()=>`<h2>Players</h2>${renderParticipantsPanel()}<button data-action="copy-invite">Invite someone to view</button>`,
  joinMarkupByElement:new Map(),routeTransition:null,panelPendingFocus:new Map(),panelSizeAnimations:new Map(),isButtonPending:()=>false,getCopyInviteButtonKey:()=> 'copy',
  applySharedMutationGates(){},FLYOUT_KEYS:[],reconcileMiniBoardPreviews(){},syncMountedGameShellPanelUi(){},scheduleGameShellStickyLayout(){},mountedBoardGameId:null,
 };
 runInNewContext(`${update}\n${mounted}\nglobalThis.toggle=()=>{const action='toggle-computer-card',actionEl={dataset:{gameId:'g',computerSide:'P2'}};${toggle}};globalThis.refresh=()=>updateMountedGameShell({game:${JSON.stringify(game)},includeBoard:false});`,context);
 return{context,game,patches,list,join,resume,toggleButton,document,setActivity:value=>{activity=value;}};
}

test('computer disclosure updates the actual Players list inside the canonical join panel',()=>{
 const h=harness();h.context.toggle();
 assert.equal(h.patches.length,1);assert.equal(h.patches[0][0],'players');
 assert.match(h.patches[0][1],/aria-expanded="true"/);assert.match(h.patches[0][1],/>Resume here<\/button>/);
 assert.equal(h.document.activeElement,h.toggleButton);
 h.context.toggle();assert.match(h.patches.at(-1)[1],/aria-expanded="false"/);assert.doesNotMatch(h.patches.at(-1)[1],/>Resume here<\/button>/);
});

test('status reconciliation patches Players before join and retains the exact computer-seat focus',()=>{
 for(const disabled of [false,true]){
  const h=harness();h.context.toggle();h.document.activeElement=h.resume;h.resume.disabled=disabled;
  h.setActivity(disabled?{label:'Resuming',state:'resuming',showResume:true,disabledReason:'Resuming computer play…'}:{label:'Active here',state:'here',activeHere:true,showResume:false});
  assert.equal(h.context.refresh(),true);
  assert.deepEqual(h.patches.slice(-2).map(([kind])=>kind),['players','join']);
  assert.equal(h.document.activeElement,h.toggleButton);
  assert.match(h.patches.at(-1)[1],/Invite someone to view/);assert.match(h.patches.at(-1)[1],/aria-expanded="true"/);
  assert.equal(h.context.panelPendingFocus.size,0);
 }
});
