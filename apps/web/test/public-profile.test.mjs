import test from "node:test";
import assert from "node:assert/strict";
import { participantName, participantButton, createInlineProfiles, formatJoinedMonth } from "../shell/public-profile.js";

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
 assert.match(b.slot.innerHTML,/Loading/);
 calls[1]({ok:true,json:async()=>({joinedMonth:"2026-02"})});await second;
 assert.match(b.slot.innerHTML,/Joined February 2026/);
 profiles.sync();assert.match(b.slot.innerHTML,/Joined February 2026/);
 await profiles.open("Bob",b.button);assert.equal(b.slot.innerHTML,'');
 const late=profiles.open("Alice",a.button);profiles.close();calls[2]({ok:true,json:async()=>({joinedMonth:"2026-03"})});await late;
 assert.equal(a.slot.innerHTML,'');
 assert.equal(formatJoinedMonth("2026-13"),"");
});
