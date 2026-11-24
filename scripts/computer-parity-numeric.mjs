/** Owner exceptions affect value roundoff only; strict results remain visible. */
export function numericMarginForModel(receipt,model){
 if(receipt?.schema!==1||receipt.kind!=='owner-numeric-margin-release-acceptance'||!receipt.authority||
   !receipt.models?.some(item=>item.modelId===model.id&&item.onnxSha256===model.sha256)||
   !Number.isFinite(receipt.valueAbsoluteErrorMaximum)||receipt.valueAbsoluteErrorMaximum<=0)
  throw Error('Numeric acceptance does not bind this model');
 return receipt.valueAbsoluteErrorMaximum;
}
export function assessNumericCell(kind,actual,expected,{atol,rtol},valueMargin=null){
 const error=Math.abs(actual-expected),finite=Number.isFinite(actual)&&Number.isFinite(expected)&&
  (kind!=='value'||(Math.abs(actual)<=1&&Math.abs(expected)<=1));
 const strictPassed=finite&&error<=atol+rtol*Math.abs(expected);
 const acceptedByOwner=finite&&!strictPassed&&kind==='value'&&Number.isFinite(valueMargin)&&valueMargin>0&&error<=valueMargin;
 return {error,strictPassed,acceptedByOwner,accepted:strictPassed||acceptedByOwner};
}
