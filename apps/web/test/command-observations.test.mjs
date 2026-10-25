import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPassiveCommandObservations} from '../../../e2e/support/command-observations.mjs';

const fixture=()=>{
 class Events{listeners=new Map();addEventListener(type,listener){const list=this.listeners.get(type)??[];list.push(listener);this.listeners.set(type,list);}emit(type,event={}){for(const listener of this.listeners.get(type)??[])listener(event);}}
 const nativeError=new Error('native failure'),request=new Events(),calls=[];request.result=[];
 class Store{constructor(){this.name='commands';this.transaction=new Events();this.transaction.db={name:'owner-journal'};}
  add(value){calls.push({self:this,value});if(value===nativeError)throw nativeError;return request;}
  put(value){return this.add(value);}delete(value){return this.add(value);}getAll(){return request;}}
 const response={status:200,headers:{get:()=>null},clone:()=>({json:async()=>({eventSeq:2,commandOutcomes:[]})})},fetchPromise=Promise.resolve(response);
 const sendResult={native:true};class Socket extends Events{static OPEN=1;constructor(url){super();this.url=url;}send(value){if(value===nativeError)throw nativeError;return sendResult;}}
 const window={IDBObjectStore:Store,WebSocket:Socket,fetch:function(input){if(input===nativeError)throw nativeError;calls.push({fetchThis:this,input});return fetchPromise;},performance:{now:()=>1},localStorage:{getItem:()=>null},document:{hasFocus:()=>true,hidden:false,querySelector:()=>null},location:{href:'https://example.test/',hash:'#/game/g'},URL};window.window=window;
 vm.runInNewContext(`(${installPassiveCommandObservations.toString()})()`,window);
 return {window,Store,Socket,request,calls,nativeError,fetchPromise,sendResult};
};

test('journal observers preserve native requests, receivers, prototypes, original errors and transaction events',()=>{
 const f=fixture(),store=new f.window.IDBObjectStore(),command={gameId:'g',identityId:'owner',clientCommandId:'original',kind:'action',fingerprint:'original-hash'};
 assert.equal(Object.getPrototypeOf(store),f.Store.prototype);assert.equal(store.add(command),f.request);assert.equal(f.calls[0].self,store);assert.equal(f.calls[0].value,command);
 let nativeEvent;f.request.addEventListener('success',event=>{nativeEvent=event;});const event={untouched:true};f.request.emit('success',event);assert.equal(nativeEvent,event);
 assert.equal(store.getAll(),f.request);store.transaction.emit('complete');
 assert.throws(()=>store.add(f.nativeError),error=>error===f.nativeError);
 const records=f.window.passiveCommandObservations;
 assert.equal(records.filter(record=>record.kind==='journal-transaction').length,1);
 assert.equal(records.find(record=>record.kind==='journal-request').value.fingerprint,'original-hash');
});

test('network observers return native promises, sockets, send values and exact throws',async()=>{
 const f=fixture();assert.equal(f.window.fetch('/api/shell/games/g'),f.fetchPromise);assert.equal(f.calls[0].fetchThis,f.window);assert.throws(()=>f.window.fetch(f.nativeError),error=>error===f.nativeError);await f.fetchPromise;
 const socket=new f.window.WebSocket('https://example.test/api/shell/games/g/ws');assert(socket instanceof f.Socket);assert.equal(Object.getPrototypeOf(socket),f.Socket.prototype);assert.equal(f.window.WebSocket.OPEN,f.Socket.OPEN);
 assert.equal(socket.send(JSON.stringify({type:'heartbeat'})),f.sendResult);assert.throws(()=>socket.send(f.nativeError),error=>error===f.nativeError);
 let received;socket.addEventListener('message',event=>{received=event;});const event={data:JSON.stringify({type:'event_appended',eventSeq:3,commandOutcome:{clientCommandId:'original',fingerprint:'original-hash',outcome:'accepted'}})};socket.emit('message',event);assert.equal(received,event);
 const record=f.window.passiveCommandObservations.find(record=>record.kind==='socket-received');assert.equal(record.commandOutcome.fingerprint,'original-hash');
});
