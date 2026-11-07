// Fixture-browser module, not a product API. Import beside the used-size helper.
export function originalHeightPublication({currentNode,expectedFontKey,expectedWidth,read=globalThis.__heightPublication?.read}){
 if(!currentNode||typeof read!=='function'||typeof expectedFontKey!=='string'||!Number.isFinite(expectedWidth)||expectedWidth<=0)return {qualified:false,incomplete:true,reason:'missing-publication-input'};
 const original=read(currentNode);
 if(!original||original.expectedNode!==currentNode||original.fontKey!==expectedFontKey||original.width!==expectedWidth||original.invalid!==0||original.overflow!==false)return {qualified:false,incomplete:true,reason:'missing-current-scale-publication'};
 return {qualified:true,incomplete:false,expectedNode:original.expectedNode,currentNode,expectedTarget:original.target,sequence:original.sequence,fontKey:original.fontKey,width:original.width};
}
export function publicationUsedSizeAtCurrentScale({currentNode,expectedFontKey,expectedWidth,measurePublicationUsedSize,read}){
 const original=originalHeightPublication({currentNode,expectedFontKey,expectedWidth,read});
 if(!original.qualified)return original;
 const used=measurePublicationUsedSize(original);
 if(!used.qualification?.qualified)return {qualified:false,incomplete:true,reason:used.reason??used.qualification?.reason??'used-size-unqualified',original,used};
 return {qualified:true,incomplete:false,original,used};
}
