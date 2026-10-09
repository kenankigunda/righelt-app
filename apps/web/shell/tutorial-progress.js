export const TUTORIAL_PROGRESS_KEY = 'righelt.lesson.progress.v1';
export const readTutorialProgress = storage => {
 try { const value=JSON.parse(storage?.getItem(TUTORIAL_PROGRESS_KEY)||'null');
  return {completed:Array.isArray(value?.completed)?value.completed.filter(id=>typeof id==='string'):[],result:['completed','skipped'].includes(value?.result)?value.result:null};
 } catch {return {completed:[],result:null};}
};
export const writeTutorialProgress = (storage,progress) => {try {storage?.setItem(TUTORIAL_PROGRESS_KEY,JSON.stringify(progress));}catch{}};
export const needsTutorial = ({account,progress,legacyCompleted=false}) => account?.preferences ? account.preferences.tutorial==='new' : !progress.result && !legacyCompleted;

export const savedTutorialResult = ({account,progress}) => ['completed','skipped'].includes(account?.preferences?.tutorial) ? account.preferences.tutorial : progress.result || 'skipped';
