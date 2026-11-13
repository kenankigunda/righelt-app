import test from 'node:test';
import assert from 'node:assert/strict';
import {createDestinationNoticeRetirementOwner,mountDestinationNotice,presentDestinationNotice,quietFieldDestinationNotice,renderQuietFieldDestinationNotice,retireDestinationNotice} from '../shell/destination-load-notice.js';

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

const noticeFixture=()=>{
 const attributes=new Map(),frames=[],body={};
 const documentObject={activeElement:body},element={hidden:false,inert:false,dataset:{},ownerDocument:documentObject,
  setAttribute(name,value){attributes.set(name,String(value));},removeAttribute(name){attributes.delete(name);},hasAttribute:name=>attributes.has(name),getAttribute:name=>attributes.get(name)??null,
  contains(node){return node?.notice===this;}};
 const control={notice:element,tabIndex:0,closest(selector){return selector==='[inert]'&&element.hasAttribute('inert')?element:null;},blur(){documentObject.activeElement=body;}};
 return{element,control,body,documentObject,frames,frame:callback=>frames.push(callback),attributes};
};

test('first mount enters from the hidden inert state before becoming visible on a frame',()=>{
 const fixture=noticeFixture();mountDestinationNotice(fixture.element);
 assert.equal(fixture.element.hidden,true);assert.equal(fixture.element.inert,true);assert.equal(fixture.element.getAttribute('aria-hidden'),'true');
 assert.equal(presentDestinationNotice(fixture.element,{quietField:true,requestAnimationFrame:fixture.frame}),'entering');
 assert.equal(fixture.element.hidden,false);assert.equal(fixture.element.inert,false);assert.equal(fixture.element.hasAttribute('inert'),false);assert.equal(fixture.element.getAttribute('aria-hidden'),null);assert.equal(fixture.frames.length,1);
 fixture.frames[0]();assert.equal(fixture.element.dataset.state,'visible');
});

test('exit is immediately inert and untabbable, blurs stale focus, and safely re-enters',()=>{
 const fixture=noticeFixture();mountDestinationNotice(fixture.element);presentDestinationNotice(fixture.element,{quietField:true,requestAnimationFrame:fixture.frame});
 fixture.documentObject.activeElement=fixture.control;
 assert.equal(retireDestinationNotice(fixture.element,{quietField:true,documentObject:fixture.documentObject}).ownedFocus,true);
 assert.equal(fixture.element.dataset.state,'exiting');assert.equal(fixture.element.inert,true);assert.equal(fixture.element.hasAttribute('inert'),true);assert.equal(fixture.element.getAttribute('aria-hidden'),'true');assert.equal(fixture.control.closest('[inert]'),fixture.element);assert.equal(fixture.documentObject.activeElement,fixture.body);
 assert.equal(presentDestinationNotice(fixture.element,{quietField:true,requestAnimationFrame:fixture.frame}),'entering');
 assert.equal(fixture.element.inert,false);assert.equal(fixture.element.hasAttribute('inert'),false);assert.equal(fixture.element.getAttribute('aria-hidden'),null);
 fixture.frames.shift()();assert.equal(fixture.element.dataset.state,'entering');fixture.frames.shift()();assert.equal(fixture.element.dataset.state,'visible');
});

test('a stale delayed exit cannot settle or disown a newer retirement episode',()=>{
 const fixture=noticeFixture(),timers=[],cleared=[];
 const retirement=createDestinationNoticeRetirementOwner({setTimeout:callback=>{const timer={callback};timers.push(timer);return timer;},clearTimeout:timer=>cleared.push(timer)});
 mountDestinationNotice(fixture.element);fixture.element.innerHTML='current notice';presentDestinationNotice(fixture.element,{quietField:true,requestAnimationFrame:fixture.frame});
 const first=retireDestinationNotice(fixture.element,{quietField:true,documentObject:fixture.documentObject}),firstOwner=retirement.schedule(fixture.element,first.generation);
 presentDestinationNotice(fixture.element,{quietField:true,requestAnimationFrame:fixture.frame});retirement.cancel();
 const second=retireDestinationNotice(fixture.element,{quietField:true,documentObject:fixture.documentObject}),secondOwner=retirement.schedule(fixture.element,second.generation);
 assert.equal(retirement.owns(firstOwner),false);assert.equal(retirement.owns(secondOwner),true);assert.equal(cleared.includes(firstOwner.timer),true);
 firstOwner.timer.callback();
 assert.equal(retirement.owns(secondOwner),true);assert.equal(fixture.element.hidden,false);assert.equal(fixture.element.innerHTML,'current notice');assert.equal(fixture.element.dataset.state,'exiting');
 secondOwner.timer.callback();
 assert.equal(retirement.owns(secondOwner),false);assert.equal(fixture.element.hidden,true);assert.equal(fixture.element.innerHTML,'');assert.equal(fixture.element.dataset.state,'hidden');
});
