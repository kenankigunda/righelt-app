import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMatchupTitle,documentTitleForRoute,DOCUMENT_TITLE_MAX_CHARACTERS} from '../shell/document-title.js';
import {gameTitleModel} from '../shell/game-title.js';

const person=(identityId,displayName)=>({identityId,profile:{displayName},connected:true});
const game=(overrides={})=>({id:'game-title',createdAt:'2026-11-11T20:00:00Z',myRole:'Player 1',player1:person('red','Alex'),player2:person('blue','Blair'),...overrides});
const graphemeLength=value=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].length;
const titleForRoute=options=>documentTitleForRoute({...options,timeZone:'UTC'});

test('browser titles cover every route state with the approved punctuation',()=>{
 assert.equal(titleForRoute({routeName:'home'}),'Righelt');
 assert.equal(titleForRoute({routeName:'game'}),'Loading game | Righelt');
 assert.equal(titleForRoute({routeName:'game',routeHydrated:true}),'Game unavailable | Righelt');
 assert.equal(titleForRoute({routeName:'invite'}),'Invitation | Righelt');
 assert.equal(titleForRoute({routeName:'game',game:game(),identityId:'red'}),'vs. Blair | Nov 11 evening | Righelt');
 assert.equal(titleForRoute({routeName:'game',game:game({myRole:'Player 2'}),identityId:'blue'}),'vs. Alex | Nov 11 evening | Righelt');
 assert.equal(titleForRoute({routeName:'game',game:game({myRole:'Viewer'}),identityId:'viewer'}),'Alex vs. Blair | Nov 11 evening | Righelt');
});

test('self-play and invite resolution use the shared matchup model',()=>{
 const self=game({myRole:'Both Players',selfPlayMode:true,player2:person('red','Alex')});
 assert.equal(titleForRoute({routeName:'game',game:self,identityId:'red'}),'You | Nov 11 evening | Righelt');
 assert.equal(titleForRoute({routeName:'game',game:{...self,myRole:'Viewer'},identityId:'viewer'}),'Alex | Nov 11 evening | Righelt');
 const guestSelf=game({myRole:'Viewer',selfPlayMode:true,player1:{identityId:'guest-owner',connected:true},player2:{identityId:'guest-owner',connected:true}});
 assert.equal(titleForRoute({routeName:'game',game:guestSelf,identityId:'viewer'}),'Guest 1 | Nov 11 evening | Righelt');
 assert.equal(titleForRoute({routeName:'invite',inviteResolved:true,game:game(),identityId:'red'}),'vs. Blair | Nov 11 evening | Righelt');
});

test('50-grapheme budget shortens the longer human name first and preserves graphemes',()=>{
 const model=gameTitleModel(game({myRole:'Viewer',player1:person('red','ExtraordinarilyLongAlexandra'),player2:person('blue','ModeratelyLongBlair')}),{identityId:'viewer'});
 const title=browserMatchupTitle(model,{startedAt:'2026-11-11T20:00:00Z',timeZone:'UTC'});
 assert.ok([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(title)].length<=DOCUMENT_TITLE_MAX_CHARACTERS);
 assert.equal(title,'E. vs. M. | Nov 11 evening | Righelt');
 const unicode=gameTitleModel(game({myRole:'Viewer',player1:person('red','e\u0301'.repeat(30)),player2:person('blue','Blair')}),{identityId:'viewer'});
 assert.match(browserMatchupTitle(unicode,{startedAt:'2026-11-11T20:00:00Z',timeZone:'UTC'}),/^e\u0301\./u);
});

test('date addition keeps alias collisions and generic seats within the title budget',()=>{
 const collision=game({player2:{identityId:'blue',profile:{displayName:'You',username:'x'.repeat(24)},connected:true}});
 const qualified=titleForRoute({routeName:'game',game:collision,identityId:'red'});
 assert.equal(qualified,'vs. You (@x…) | Nov 11 evening | Righelt');
 assert.ok(graphemeLength(qualified)<=DOCUMENT_TITLE_MAX_CHARACTERS);
 const colors=titleForRoute({routeName:'game',game:game({player2:person('blue','You')}),identityId:'red'});
 assert.equal(colors,'vs. You (Blue) | Nov 11 evening | Righelt');
 assert.ok(graphemeLength(colors)<=DOCUMENT_TITLE_MAX_CHARACTERS);
 const open=titleForRoute({routeName:'game',game:game({myRole:'Viewer',player1:null,player2:null}),identityId:'viewer'});
 assert.equal(open,'Open seat vs. Open seat | Nov 11 evening | Righelt');
 assert.ok(graphemeLength(open)<=DOCUMENT_TITLE_MAX_CHARACTERS);
});

test('browser titles reuse all seven canonical dayparts and exact boundaries',()=>{
 const cases=[
  ['2026-11-14T00:00:00Z','late night'],['2026-11-14T05:00:00Z','early morning'],
  ['2026-11-14T09:00:00Z','mid morning'],['2026-11-14T11:00:00Z','noon'],
  ['2026-11-14T14:00:00Z','afternoon'],['2026-11-14T18:00:00Z','evening'],['2026-11-14T21:00:00Z','night'],
 ];
 for(const [createdAt,phase] of cases)assert.equal(titleForRoute({routeName:'game',game:game({createdAt}),identityId:'red'}),`vs. Blair | Nov 14 ${phase} | Righelt`);
});

test('viewer timezone controls date and daypart without browser-locale leakage',()=>{
 const startedAt='2026-11-14T07:30:00Z',base={routeName:'game',game:game({createdAt:startedAt}),identityId:'red'};
 assert.equal(documentTitleForRoute({...base,timeZone:'America/Los_Angeles'}),'vs. Blair | Nov 13 night | Righelt');
 assert.equal(documentTitleForRoute({...base,timeZone:'Asia/Tokyo'}),'vs. Blair | Nov 14 afternoon | Righelt');
 const spring=game({createdAt:'2026-03-08T10:00:00Z'}),fallA=game({createdAt:'2026-11-01T08:30:00Z'}),fallB=game({createdAt:'2026-11-01T09:30:00Z'});
 assert.equal(documentTitleForRoute({routeName:'game',game:spring,identityId:'red',timeZone:'America/Los_Angeles'}),'vs. Blair | Mar 8 late night | Righelt');
 assert.equal(documentTitleForRoute({routeName:'game',game:fallA,identityId:'red',timeZone:'America/Los_Angeles'}),documentTitleForRoute({routeName:'game',game:fallB,identityId:'red',timeZone:'America/Los_Angeles'}));
});

test('unknown starts omit both date and daypart while immutable createdAt alone owns the fragment',()=>{
 const unknown=titleForRoute({routeName:'game',game:game({createdAt:'not-a-date'}),identityId:'red'});
 assert.equal(unknown,'vs. Blair | Righelt');
 const started=game({createdAt:'2026-11-11T20:00:00Z',updatedAt:'2030-01-01T00:00:00Z',completedAt:'2031-01-01T00:00:00Z'});
 assert.equal(titleForRoute({routeName:'game',game:started,identityId:'red'}),'vs. Blair | Nov 11 evening | Righelt');
});

test('route input fences late identity and retains a known title during reconnect',()=>{
 const a=game({id:'a'}),b=game({id:'b',player1:person('red','Casey'),player2:person('blue','Devon')});
 assert.equal(titleForRoute({routeName:'game',routeHydrated:false,game:a,identityId:'red'}),'vs. Blair | Nov 11 evening | Righelt');
 assert.equal(titleForRoute({routeName:'game',routeHydrated:false,game:null}),'Loading game | Righelt');
 assert.equal(titleForRoute({routeName:'game',routeHydrated:true,game:b,identityId:'red'}),'vs. Devon | Nov 11 evening | Righelt');
 assert.equal(titleForRoute({routeName:'home',game:a,identityId:'red'}),'Righelt','late game A cannot restore its title after navigation');
 assert.equal(titleForRoute({routeName:'game',routeHydrated:true,unavailable:true}),'Game unavailable | Righelt','access changes clear inaccessible identity');
});
