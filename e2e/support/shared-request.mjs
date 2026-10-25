// Match semantic operations across the supported legacy route and durable envelope.
export const isOperationRequest = (request, operation) => {
 if(request.method()!=='POST')return false;
 const path=new URL(request.url()).pathname;
 if(path.endsWith(`/${operation}`))return true;
 return path.endsWith('/shared') && request.postDataJSON()?.payload?.operation===operation;
};
export const operationValues = request => {
 const body=request.postDataJSON();return body?.kind==='shared'?body.payload.values:body;
};
