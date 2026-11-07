// Native profile only. Forward traversal starts from the existing Stop replay
// focus return before Pass, never from navigation after 100 native cell buttons.
export function boardActionTraversalKey({platform,browserName}){
 if(!['darwin','linux','win32'].includes(platform))throw Error('Unsupported native keyboard platform');
 if(!['chromium','firefox','webkit'].includes(browserName))throw Error('Unsupported native keyboard browser');
 return platform==='darwin'&&browserName==='webkit'?'Alt+Tab':'Tab';
}
// Read-only precondition. No focus, click, scroll or synthetic starting point.
export function readBoardTraversalStart(button){
 const doc=button.ownerDocument,controls=[...doc.querySelectorAll('#app [data-alert-stack-card].is-active .board-context-replay')],start=controls[0],active=doc.activeElement;
 const position=start?start.compareDocumentPosition(button):0,flags=doc.defaultView.Node;
 const result={startControlCount:controls.length,startControlFocused:!!start&&active===start,startControlConnected:start?.isConnected===true,startControlEnabled:start?.disabled===false,startControlInert:!!start?.closest('[inert]'),primaryConnected:button.isConnected===true,primaryEnabled:button.disabled===false,primaryInert:!!button.closest('[inert]'),sameDocument:start?.ownerDocument===doc,startBeforePrimary:!!(position&flags.DOCUMENT_POSITION_FOLLOWING)&&!(position&flags.DOCUMENT_POSITION_DISCONNECTED)};
 return {...result,ready:result.startControlCount===1&&result.startControlFocused&&result.startControlConnected&&result.startControlEnabled&&!result.startControlInert&&result.primaryConnected&&result.primaryEnabled&&!result.primaryInert&&result.sameDocument&&result.startBeforePrimary};
}
