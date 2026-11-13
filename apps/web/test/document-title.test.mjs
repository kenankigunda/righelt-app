import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMatchupTitle,documentTitleForRoute,DOCUMENT_TITLE_MAX_CHARACTERS} from '../shell/document-title.js';
import {gameTitleModel} from '../shell/game-title.js';

const person=(identityId,displayName)=>({identityId,profile:{displayName},connected:true});
const game=(overrides={})=>({id:'game-title',createdAt:'2026-11-11T20:00:00Z',myRole:'Player 1',player1:person('red','Alex'),player2:person('blue','Blair'),...overrides});

test('browser titles cover every route state with the approved punctuation',()=>{
 assert.equal(documentTitleForRoute({routeName:'home'}),'Righelt');
 assert.equal(documentTitleForRoute({routeName:'game'}),'Loading game | Righelt');
 assert.equal(documentTitleForRoute({routeName:'game',routeHydrated:true}),'Game unavailable | Righelt');
 assert.equal(documentTitleForRoute({routeName:'invite'}),'Invitation | Righelt');
 assert.equal(documentTitleForRoute({routeName:'game',game:game(),identityId:'red'}),'You vs. Blair | Nov 11 | Righelt');
 assert.equal(documentTitleForRoute({routeName:'game',game:game({myRole:'Player 2'}),identityId:'blue'}),'You vs. Alex | Nov 11 | Righelt');
 assert.equal(documentTitleForRoute({routeName:'game',game:game({myRole:'Viewer'}),identityId:'viewer'}),'Alex vs. Blair | Nov 11 | Righelt');
});

test('self-play and invite resolution use the shared matchup model',()=>{
 const self=game({myRole:'Both Players',selfPlayMode:true,player2:person('red','Alex')});
 assert.equal(documentTitleForRoute({routeName:'game',game:self,identityId:'red'}),'You | Nov 11 | Righelt');
 assert.equal(documentTitleForRoute({routeName:'game',game:{...self,myRole:'Viewer'},identityId:'viewer'}),'Alex | Nov 11 | Righelt');
 const guestSelf=game({myRole:'Viewer',selfPlayMode:true,player1:{identityId:'guest-owner',connected:true},player2:{identityId:'guest-owner',connected:true}});
 assert.equal(documentTitleForRoute({routeName:'game',game:guestSelf,identityId:'viewer'}),'Guest 1 | Nov 11 | Righelt');
 assert.equal(documentTitleForRoute({routeName:'invite',inviteResolved:true,game:game(),identityId:'red'}),'You vs. Blair | Nov 11 | Righelt');
});

test('40-character budget shortens the longer human name first and preserves graphemes',()=>{
 const model=gameTitleModel(game({myRole:'Viewer',player1:person('red','ExtraordinarilyLongAlexandra'),player2:person('blue','ModeratelyLongBlair')}),{identityId:'viewer'});
 const title=browserMatchupTitle(model,{startedAt:'2026-11-11T20:00:00Z'});
 assert.ok([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(title)].length<=DOCUMENT_TITLE_MAX_CHARACTERS);
 assert.equal(title,'E. vs. M. | Nov 11 | Righelt');
 const unicode=gameTitleModel(game({myRole:'Viewer',player1:person('red','e\u0301'.repeat(30)),player2:person('blue','Blair')}),{identityId:'viewer'});
 assert.match(browserMatchupTitle(unicode,{startedAt:'2026-11-11T20:00:00Z'}),/^e\u0301\./u);
});

test('route input fences late identity and retains a known title during reconnect',()=>{
 const a=game({id:'a'}),b=game({id:'b',player1:person('red','Casey'),player2:person('blue','Devon')});
 assert.equal(documentTitleForRoute({routeName:'game',routeHydrated:false,game:a,identityId:'red'}),'You vs. Blair | Nov 11 | Righelt');
 assert.equal(documentTitleForRoute({routeName:'game',routeHydrated:false,game:null}),'Loading game | Righelt');
 assert.equal(documentTitleForRoute({routeName:'game',routeHydrated:true,game:b,identityId:'red'}),'You vs. Devon | Nov 11 | Righelt');
 assert.equal(documentTitleForRoute({routeName:'home',game:a,identityId:'red'}),'Righelt','late game A cannot restore its title after navigation');
 assert.equal(documentTitleForRoute({routeName:'game',routeHydrated:true,unavailable:true}),'Game unavailable | Righelt','access changes clear inaccessible identity');
});
