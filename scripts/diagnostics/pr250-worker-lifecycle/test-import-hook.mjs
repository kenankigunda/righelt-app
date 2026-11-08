let binding;
export function initialize(data){binding=data;}
export function resolve(specifier,context,nextResolve){
  if(specifier==='@playwright/test'&&context.parentURL?.startsWith(binding.candidateRoot))
    return {url:binding.fixtureURL,shortCircuit:true};
  return nextResolve(specifier,context);
}
