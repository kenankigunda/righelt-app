import {viewports} from './model.mjs';
export const WALKTHROUGH_CHECKPOINTS=['created','reconnected','account-home','sign-in','recovery-acknowledgment','account-owned-move','account-settings','move-preview-before-confirm','returning-personal-home','unavailable-trained-story','friend-game-result','friend-rematch-choice'];
function stringList(value,name){let parsed;try{parsed=JSON.parse(value);}catch{throw Error(`${name} must be a JSON array of strings`);}if(!Array.isArray(parsed)||!parsed.length||parsed.some(x=>typeof x!=='string'||!x.trim())||new Set(parsed).size!==parsed.length)throw Error(`${name} must be a nonempty unique array of strings`);return parsed;}
export function visualPolicy(env=process.env){const mode=env.RIGHELT_VISUAL_MODE||'legacy';if(!['none','walkthrough','legacy'].includes(mode))throw Error('Unknown visual mode');const visualViewports=env.RIGHELT_VISUAL_VIEWPORTS?stringList(env.RIGHELT_VISUAL_VIEWPORTS,'RIGHELT_VISUAL_VIEWPORTS'):['mobile','mid-wide'];if(visualViewports.some(name=>!viewports.some(v=>v.name===name)))throw Error('Unknown walkthrough visual viewport');return {mode,visualViewports,checkpoints:env.RIGHELT_VISUAL_CHECKPOINTS?stringList(env.RIGHELT_VISUAL_CHECKPOINTS,'RIGHELT_VISUAL_CHECKPOINTS'):WALKTHROUGH_CHECKPOINTS};}
export function selectedViewports(env=process.env){const {mode}=visualPolicy(env);const names=env.RIGHELT_VALIDATION_VIEWPORTS?stringList(env.RIGHELT_VALIDATION_VIEWPORTS,'RIGHELT_VALIDATION_VIEWPORTS'):viewports.map(v=>v.name);if(names.some(name=>!viewports.some(v=>v.name===name)))throw Error('Unknown validation viewport');return names.map(name=>viewports.find(v=>v.name===name));}
export function shouldCapture(label,viewport,policy=visualPolicy()){return policy.mode==='legacy'||policy.mode==='walkthrough'&&policy.visualViewports.includes(viewport)&&policy.checkpoints.includes(label);}
export function behaviorLabel(label){return String(label).replaceAll('-',' ');}

const descriptions={
 created:'After creating a game and choosing both players, check the board and play controls in context.',
 reconnected:'After the viewer reconnects following another move, check the recovered board and connection state.',
 'account-home':'On entry to play, check how the home page introduces the available game choices.',
 'sign-in':'After choosing account access, check the sign-in and registration dialog within the current flow.',
 'recovery-acknowledgment':'After registration, check the recovery acknowledgment and route back to play. Recovery credentials are masked.',
 'account-owned-move':'After returning to the intended game and making an authenticated move, check the board and ownership controls.',
 'move-preview-before-confirm':'After selecting a move, check the preview and confirmation controls before anything is written.',
 'account-settings':'After opening account settings, check account controls and the surrounding page context.',
 'returning-personal-home':'After returning home, check how the recent game and account controls support resuming play.',
 'unavailable-trained-story':'After opening the computer-play entry, check that its unavailable state makes the shipped scope clear. Training is excluded.',
 'friend-game-result':'After completing a friend game, check the result review and next actions.',
 'friend-rematch-choice':'After choosing rematch, check the player options and confirmation controls.'
};
export function checkpointCaption(label,viewport,kind){return `${descriptions[label]??behaviorLabel(label)} · ${viewport==='mobile'?'Mobile touch emulation':viewport==='mid-wide'?'Desktop':viewport} · ${kind}`;}
