// Keep the disposable controller separate from both gameplay and account stacks.
export function e2eControlPort(webPort){
 const port=Number(webPort)+300;
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Invalid E2E control port');
 return port;
}
