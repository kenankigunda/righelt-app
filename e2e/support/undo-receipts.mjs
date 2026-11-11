import {buildLocalApiWsHost,isLocalDevHost} from '../../apps/web/local-dev-ports.js';

// Observe original browser traffic. Never send, replay or alter a command.
export function observeUndoReceipts(page){
 const packets=[],sockets=new Map();let disposed=false;
 const onSocket=socket=>{
  const url=new URL(socket.url()),location=new URL(page.url());
  const host=location.protocol!=='https:'&&isLocalDevHost(location.hostname)?buildLocalApiWsHost(location.port):location.host;
  if(url.protocol!==(location.protocol==='https:'?'wss:':'ws:')||url.host!==host)return;
  const match=/^\/api\/shell\/games\/([^/]+)\/ws$/.exec(url.pathname);if(!match)return;
  const gameId=decodeURIComponent(match[1]);
  const frame=({payload})=>{
   if(disposed)return;
   let value;try{value=JSON.parse(typeof payload==='string'?payload:payload.toString('utf8'));}catch{return;}
   if(value?.commandOutcome)packets.push({gameId,value,raw:typeof payload==='string'?payload:payload.toString('utf8')});
  };
  sockets.set(socket,frame);socket.on('framereceived',frame);
 };
 page.on('websocket',onSocket);
 return{
  find(command){
   const matching=packets.filter(packet=>packet.value.commandOutcome?.clientCommandId===command.clientCommandId);
   let selected;
   for(const packet of matching){
    const {value,gameId}=packet,outcome=value.commandOutcome;
    if(gameId!==command.gameId||value.game?.id!==command.gameId||outcome.gameId!==command.gameId||outcome.identityId!==command.identityId||outcome.fingerprint!==command.fingerprint||outcome.outcome!=='accepted'||!Number.isSafeInteger(outcome.eventSeq)||outcome.eventSeq<=0||!Number.isSafeInteger(value.eventSeq)||value.eventSeq<outcome.eventSeq||!Number.isSafeInteger(outcome.gameplayRevision)||outcome.gameplayRevision<0||!Number.isSafeInteger(value.game.gameplayRevision)||value.game.gameplayRevision<outcome.gameplayRevision)throw Error('Original Undo socket receipt does not match the exact command');
    if(selected&&JSON.stringify(selected)!==JSON.stringify(outcome))throw Error('Conflicting original Undo socket receipts');
    selected=outcome;
   }
   return selected;
  },
  originals(){return packets.map(packet=>({gameId:packet.gameId,raw:packet.raw}));},
  dispose(){if(disposed)return;disposed=true;page.off('websocket',onSocket);for(const [socket,frame]of sockets)socket.off('framereceived',frame);sockets.clear();}
 };
}
const observers=new WeakMap();
export const undoReceiptFixtures={undoReceiptObserver:[async({page},use)=>{
 const observer=observeUndoReceipts(page);observers.set(page,observer);
 try{await use(observer);}finally{observer.dispose();observers.delete(page);}
},{auto:true}]};
export function undoReceiptObserver(page){const observer=observers.get(page);if(!observer)throw Error('Original Undo socket observer must be installed before game creation');return observer;}
