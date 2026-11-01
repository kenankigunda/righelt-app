import {readFile} from 'node:fs/promises';

// CSS is the policy source. Tests probe its boundaries without maintaining a
// second table, then independently check intrinsic fit and cold/loaded anchors.
const css=await readFile(new URL('../../apps/web/shell/board-ux.css',import.meta.url),'utf8');
export const reservationBands=[...css.matchAll(/@container board-message \(min-width:([\d.]+)em\) and \(width < ([\d.]+)em\) \{\s*\.board-message-sizing \{--board-message-row-lines:([\d.]+);/g)].map(([,min,max,height])=>({min:Number(min),max:Number(max),height:Number(height)*1.5,lines:Number(height)}));
const base=css.match(/\.board-preview-label\s*\{[^}]*min-height:\s*max\(([\d.]+)em,\s*([\d.]+)px\)/);
if(!reservationBands.length||!base)throw Error('Message reservation policy is missing');
const metric=name=>{const match=css.match(new RegExp(`--board-message-${name}:([\\d.]+)`));if(!match)throw Error(`Message metric ${name} is missing`);return Number(match[1]);};
export const actionReservationMetrics=Object.freeze({em:metric('action-extra-em'),px:metric('action-extra-px'),halfPx:metric('hit-half-px'),halfEm:metric('hit-half-em')});
export const actionRowAllowance=fontSize=>actionReservationMetrics.em*fontSize+actionReservationMetrics.px+4*Math.max(0,actionReservationMetrics.halfPx-actionReservationMetrics.halfEm*fontSize);
// CSS bounds the primary-font reservation. A platform's permanent fallback can
// intrinsically need more space. Admit only its independently measured natural
// height, never the current slot or a replica with the CSS minimum applied.
export const admittedHeight=(width,fontSize,intrinsicFallback)=>{
 if(!Number.isFinite(intrinsicFallback)||intrinsicFallback<=0)throw Error('A nonempty positive intrinsic fallback measurement is required');
 return Math.max(intrinsicFallback,Number(base[1])*fontSize,Number(base[2]),3*fontSize+actionRowAllowance(fontSize),...reservationBands.filter(band=>width>=band.min*fontSize&&width<band.max*fontSize).map(band=>band.height*fontSize+actionRowAllowance(fontSize)));
};

// DOMRect serialization can differ from an ideal CSS minimum by millionths of
// a pixel (Firefox: 49.600006 vs 49.6). Normalize only budget arithmetic below
// either engine's layout quantum. Cold/loaded/reload anchors stay unrounded.
export const budgetPixelPrecision=value=>Number(value.toFixed(3));
