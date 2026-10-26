// Test-only ownership: retain pending creations so partial setup cannot leak a
// context that resolves after another role's creation has already failed.
export function ownedContexts(browser) {
 const creations=[];
 let closing=false;
 return {
  create(options) {
   if(closing)throw Error('Cannot create a context during teardown');
   const operation=Promise.resolve().then(()=>browser.newContext(options));
   creations.push(operation.then(context=>({context}),error=>({error})));
   return operation;
  },
  async close() {
   closing=true;
   const outcomes=await Promise.all(creations);
   const closed=await Promise.allSettled(outcomes.filter(item=>item.context).map(({context})=>Promise.resolve().then(()=>context.close())));
   const errors=[...outcomes.filter(item=>'error' in item).map(item=>item.error),...closed.filter(item=>item.status==='rejected').map(item=>item.reason)];
   if(errors.length)throw new AggregateError(errors,'Owned browser context setup or teardown failed');
  },
 };
}
