import test from 'node:test';
import assert from 'node:assert/strict';
import {quietFieldDestinationNotice,renderQuietFieldDestinationNotice} from '../shell/destination-load-notice.js';

const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const icon=name=>`<svg data-icon="${name}" aria-hidden="true"></svg>`;

test('Quiet field is limited to notices owned by an active full-page game-entry transition',()=>{
 const message={message:'Opening your game',heading:'Opening your game'};
 for(const phase of ['covering','covered','revealing'])assert.equal(quietFieldDestinationNotice({transition:{type:'game-entry',phase},message}),true);
 for(const transition of [null,{type:'none',phase:'covered'},{type:'game-entry',phase:'idle'}])assert.equal(quietFieldDestinationNotice({transition,message}),false);
 assert.equal(quietFieldDestinationNotice({transition:{type:'game-entry',phase:'covered'},message:null}),false);
});

test('Quiet field renders escaped centered copy and only applicable recovery actions without a notification card',()=>{
 const waiting=renderQuietFieldDestinationNotice({
  message:{heading:'Still opening <your game>.',support:'We’ll keep trying & waiting.',action:'retry',home:true},escapeHtml,icon,homeHref:'#/?next=<home>',
 });
 assert.match(waiting,/class="destination-load-field-content"/);
 assert.match(waiting,/<h2>Still opening &lt;your game&gt;\.<\/h2>/);
 assert.match(waiting,/<p>We’ll keep trying &amp; waiting\.<\/p>/);
 assert.match(waiting,/data-destination-action="retry"[\s\S]*<span>Retry<\/span>/);
 assert.match(waiting,/data-destination-action="home"[\s\S]*<span>Home<\/span>/);
 assert.match(waiting,/href="#\/\?next=&lt;home&gt;"/);
 assert.doesNotMatch(waiting,/shell-game-alert|alert|toast|banner|loading-pieces/);
 const initial=renderQuietFieldDestinationNotice({message:{heading:'Opening your game',support:null,action:null,home:false},escapeHtml,icon,homeHref:'#/'});
 assert.doesNotMatch(initial,/destination-load-field-actions|<p>/);
});
