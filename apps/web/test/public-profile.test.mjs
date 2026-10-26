import test from "node:test";
import assert from "node:assert/strict";
import { participantName, participantButton, createInlineProfiles, formatJoinedMonth } from "../shell/public-profile.js";

test('computer kind is opt-in for Players rows and absent from ordinary history names',()=>{
 const person={computerProfile:'horus'};
 assert.equal(participantName(person),'<span class="player-name">Horus</span>');
 assert.match(participantName(person,{inlineComputerBadge:true}),/player-kind-badge">Computer/);
});

test("public names are escaped and direction isolated with a profile link only for accounts", () => {
  const person = {
    identityId: "private-id",
    profile: { displayName: "<b>שלום</b>", username: "Alice" },
  };
  const html = participantButton(person);
  assert.match(html, /<bdi>&lt;b&gt;שלום&lt;\/b&gt;<\/bdi>/);
  assert.match(html, /<bdi>@Alice<\/bdi>/);
  assert.match(html, /data-action="public-profile"/);
  assert.doesNotMatch(html, /private-id/);
  assert.doesNotMatch(
    participantButton({ identityId: "legacy" }),
    /public-profile/,
  );
  assert.equal(
    participantName({ identityId: "<legacy>" }),
    "<bdi>Guest player</bdi>",
  );
});

test("inline profiles retain one expanded player and discard stale responses", async () => {
 const calls=[];
 const row = key => {
  const slot={innerHTML:"",getBoundingClientRect:()=>({height:0})};
  const button={dataset:{profileKey:key},parentElement:{querySelector:()=>slot},setAttribute(name,value){this[name]=value;}};
  return {slot,button};
 };
 const a=row("a"),b=row("b");
 const document={querySelectorAll:()=>[a.button,b.button]};
 const profiles=createInlineProfiles({document,fetcher:()=>new Promise(resolve=>calls.push(resolve))});
 const first=profiles.open("Alice",a.button);
 assert.equal(a.button['aria-expanded'],'true');
 const second=profiles.open("Bob",b.button);
 assert.equal(a.slot.innerHTML,'');assert.equal(b.button['aria-expanded'],'true');
 calls[0]({ok:true,json:async()=>({joinedMonth:"2026-01"})});await first;
 assert.match(b.slot.innerHTML,/data-loading-state="pending"/);
 calls[1]({ok:true,json:async()=>({joinedMonth:"2026-02"})});await second;
 assert.match(b.slot.innerHTML,/Joined February 2026/);
 profiles.sync();assert.match(b.slot.innerHTML,/Joined February 2026/);
 await profiles.open("Bob",b.button);assert.equal(b.slot.innerHTML,'');
 const late=profiles.open("Alice",a.button);profiles.close();calls[2]({ok:true,json:async()=>({joinedMonth:"2026-03"})});await late;
 assert.equal(a.slot.innerHTML,'');
 assert.equal(formatJoinedMonth("2026-13"),"");
});

test('an expanded guest row upgrades to its authoritative account profile without reopening or accepting stale replies',async()=>{
 const slot={innerHTML:'',getBoundingClientRect:()=>({height:0})};
 const button={dataset:{profileKey:'Player 1',action:'guest-profile'},parentElement:{querySelector:()=>slot},setAttribute(name,value){this[name]=value;}};
 const calls=[];const profiles=createInlineProfiles({document:{querySelectorAll:()=>[button]},fetcher:url=>new Promise(resolve=>calls.push({url,resolve}))});
 await profiles.open(null,button);assert.match(slot.innerHTML,/Playing as a guest/);
 button.dataset.action='public-profile';button.dataset.username='Alice';profiles.sync();
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/profiles/Alice');assert.equal(button['aria-expanded'],'true');assert.doesNotMatch(slot.innerHTML,/Playing as a guest/);
 button.dataset.username='Bob';profiles.sync();assert.equal(calls.length,2);
 calls[0].resolve({ok:true,json:async()=>({joinedMonth:'2025-01'})});await Promise.resolve();await Promise.resolve();assert.doesNotMatch(slot.innerHTML,/January 2025/);
 calls[1].resolve({ok:true,json:async()=>({joinedMonth:'2026-02'})});await Promise.resolve();await Promise.resolve();assert.match(slot.innerHTML,/Joined February 2026/);
 profiles.sync();assert.equal(calls.length,2);profiles.close();assert.equal(slot.innerHTML,'');
});


test('computer identities use an inline badge and semantic green mark without human profile actions',()=>{
 for(const side of ['p1','p2','neutral']){
  const html=participantButton({identityId:'owner',profile:{username:'Human'},computerProfile:'horus',connected:false},{side,presence:'<span>Disconnected</span>'});
  assert.match(html,/participant-profile participant-computer/);assert.match(html,/<span class="player-name">Horus<\/span><span class="player-kind-badge">Computer<\/span>/);
  assert.match(html,/connection-status-icon is-connected.*aria-label="Computer player"/);assert.doesNotMatch(html,/<button|data-profile|Human|Disconnected|player-username/);
  assert.match(html,new RegExp(`data-player-side="${side}"`));
 }
 assert.doesNotMatch(participantName({computerProfile:'horus'}),/Computer/,'History omits the Players-only kind badge');
});
