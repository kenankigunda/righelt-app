export function socketEnvironment(t) {
  const originals = Object.fromEntries(['window','document','navigator','WebSocket'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const sockets = [], owners = [];
  class Socket extends EventTarget {
    constructor(url) { super(); this.url=url; this.readyState=0; this.sent=[]; sockets.push(this); }
    emit(type, values={}) { if(type==='open')this.readyState=1;if(type==='close')this.readyState=3;this.dispatchEvent(Object.assign(new Event(type),values)); }
    send(value) { this.sent.push(value); }
    close() { this.emit('close',{code:1000,wasClean:true}); }
  }
  const window = Object.assign(new EventTarget(),{location:{protocol:'https:',hostname:'test',host:'test',port:'',origin:'https://test'}});
  const document = Object.assign(new EventTarget(),{hidden:false,visibilityState:'visible'});
  for(const [key,value] of Object.entries({window,document,navigator:{onLine:true},WebSocket:Socket}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  t.after(() => {
    try { for(const owner of owners)owner.retire(); }
    finally { for(const [key,descriptor] of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];} }
  });
  return {sockets,window,document,own(owner){owners.push(owner);return owner;}};
}
