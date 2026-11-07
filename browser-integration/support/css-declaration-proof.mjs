// Declaration serialization is distinct from computed/used geometry. The
// ORIGINAL numeric policy/assignment operand is never rounded or replaced.
const positive=value=>Number.isFinite(value)&&value>0;
export function qualifyAssignedDeclaration({ideal,assignedValue,declaration,property='height'}={}){
 const fail=reason=>({qualified:false,incomplete:true,reason});
 if(!['height','min-height'].includes(property)||!positive(ideal)||typeof assignedValue!=='string')return fail('invalid-declaration-input');
 const inputValue=`${ideal}px`;
 // Retain the prior exact path. Only a representation mismatch needs the
 // independent detached declaration; no optional proof may relax this input.
 if(assignedValue===inputValue)return {qualified:true,incomplete:false,ideal,inputValue,serializedValue:inputValue,mode:'original-exact-assignment'};
 const d=declaration;
 if(!d||d.schema!==1||d.ideal!==ideal||d.property!==property||d.inputValue!==inputValue||d.detached!==true||d.childNodes!==0||d.declarationCount!==1||d.declaredProperty!==property||d.priority!=='')return fail('declaration-binding');
 if(typeof d.serializedValue!=='string'||!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?px$/i.test(d.serializedValue)||!positive(Number(d.serializedValue.slice(0,-2))))return fail('unsupported-declaration-representation');
 if(assignedValue!==d.serializedValue)return fail('declaration-assignment-mismatch');
 return {qualified:true,incomplete:false,ideal,inputValue,serializedValue:d.serializedValue,mode:'independent-empty-declaration'};
}
export function measureEmptyHeightDeclaration(reference,ideal,{property='height'}={}){
 if(!['height','min-height'].includes(property)||!positive(ideal))throw Error('Invalid original declaration target');
 const node=reference.ownerDocument.createElement('div'),inputValue=`${ideal}px`;
 // No append, CSS rules, computed style, geometry or live-content reads.
 node.style.setProperty(property,inputValue);
 return {schema:1,ideal,property,inputValue,serializedValue:node.style.getPropertyValue(property),detached:node.isConnected===false,childNodes:node.childNodes.length,declarationCount:node.style.length,declaredProperty:node.style.item(0),priority:node.style.getPropertyPriority(property)};
}
function qualifyCurrentPropertyAssignment(reference,ideal,assignedValue,property){
 if(!positive(ideal))return qualifyAssignedDeclaration({ideal,assignedValue,property});
 if(assignedValue===`${ideal}px`)return {...qualifyAssignedDeclaration({ideal,assignedValue,property}),declaration:null};
 let declaration;
 try{declaration=measureEmptyHeightDeclaration(reference,ideal,{property});}catch{return {qualified:false,incomplete:true,reason:'declaration-measurement-incomplete'};}
 return {...qualifyAssignedDeclaration({ideal,assignedValue,declaration,property}),declaration};
}

export const qualifyCurrentHeightAssignment=(reference,ideal,assignedValue)=>qualifyCurrentPropertyAssignment(reference,ideal,assignedValue,'height');
export const qualifyCurrentMinHeightAssignment=(reference,ideal,assignedValue)=>qualifyCurrentPropertyAssignment(reference,ideal,assignedValue,'min-height');
