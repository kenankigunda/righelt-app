// Optional account preference adapters can replace this device store without changing the story UI.
export const createIntroductionPreferences = (storage) => ({
  has(opponent) { try{return JSON.parse(storage.getItem('righelt.introduced.v1')||'[]').includes(opponent);}catch{return false;} },
  mark(opponent) { try{const entries=JSON.parse(storage.getItem('righelt.introduced.v1')||'[]');storage.setItem('righelt.introduced.v1',JSON.stringify([...new Set([...entries,opponent])]));}catch{} },
});
export const createOpponentSession = ({preferences,getReadiness,createGame}) => {
  let generation=0,busy=false;
  return {
    needsIntroduction(opponent){return !preferences.has(opponent)||getReadiness(opponent).state!=='ready';},
    cancel(){generation++;busy=false;},
    async play(intent){
      if(busy)return {state:'busy'};
      if(getReadiness(intent.opponent).state!=='ready')return {state:'unavailable'};
      const request=++generation;busy=true;
      try{
        const result=await createGame(intent,()=>request===generation);
        if(request!==generation)return {state:'cancelled'};
        preferences.mark(intent.opponent);return {state:'started',result};
      }catch(error){return {state:'error',message:error.message||'Could not start this game.'};}
      finally{if(request===generation)busy=false;}
    },
  };
};
