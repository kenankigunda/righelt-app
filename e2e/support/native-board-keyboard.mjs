// Native profile only. Forward traversal starts from the browser's truthful
// post-replay focus (body or a surviving incoming action), never from a
// synthetic focus assignment after 100 native cell buttons.
export function boardActionTraversalKey({platform,browserName}){
 if(!['darwin','linux','win32'].includes(platform))throw Error('Unsupported native keyboard platform');
 if(!['chromium','firefox','webkit'].includes(browserName))throw Error('Unsupported native keyboard browser');
 return platform==='darwin'&&browserName==='webkit'?'Alt+Tab':'Tab';
}
// Read-only precondition. No focus, click, scroll or synthetic starting point.
export function readBoardTraversalStart(button){
 const doc=button.ownerDocument,controls=[...doc.querySelectorAll('#app [data-incoming-context] button')].filter(control=>!control.disabled&&!control.closest('[inert]')),active=doc.activeElement,start=controls.find(control=>control===active),bodyStart=active===doc.body;
 const position=start?start.compareDocumentPosition(button):0,flags=doc.defaultView.Node;
 const result={eligibleStartControlCount:controls.length,startIsBody:bodyStart,startControlFocused:!!start,startAction:start?.dataset?.action??null,startControlConnected:start?.isConnected===true,startControlEnabled:start?.disabled===false,startControlInert:!!start?.closest('[inert]'),primaryConnected:button.isConnected===true,primaryEnabled:button.disabled===false,primaryInert:!!button.closest('[inert]'),sameDocument:start?.ownerDocument===doc,startBeforePrimary:!!(position&flags.DOCUMENT_POSITION_FOLLOWING)&&!(position&flags.DOCUMENT_POSITION_DISCONNECTED)};
 const liveControlStart=result.eligibleStartControlCount>=1&&result.startControlFocused&&result.startControlConnected&&result.startControlEnabled&&!result.startControlInert&&result.sameDocument&&result.startBeforePrimary;
 return {...result,ready:result.primaryConnected&&result.primaryEnabled&&!result.primaryInert&&(bodyStart||liveControlStart)};
}
