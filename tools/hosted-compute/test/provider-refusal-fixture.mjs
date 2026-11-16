import {fixture} from './helpers.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=v=>sha256(encode(canonical(v)));
// Independent retained public metadata. This seeds the trusted durable-stage
// boundary, not a substitute manifest or new provider request.
export const historical={campaignId:'public-timing-20261116-1c3a839f',manifestSha256:'e6805ccb4f3efec99ac60e89f8813f4eef1dfe3162692148d1ba22987dda9508',sourceRevision:'ea726e0f77594dde18563a3c82a99f6ff7a96664',acceptedAt:1794830144993,
 name:'righelt-public-timing-20261116-1c3a839f-036ef1532d656a112984dffa4c1916e0-1-0',intentSha256:'192521fa0e31b4256f7143701f0334364e20df2102ba231763475fe42d3eb359',
 body:'{"detail":"There are no longer any instances available with the requested specifications. Please refresh and try again.","status":400,"title":"Bad Request"}\n',
 attestation:{kind:'operator-reviewed-single-native-request',evidenceSha256:'bd043adbe0ba7c87f0a8fb099715855146c323bc810e33917d74e969ac9b540c',helperSnapshotSha256:'8c3ffcad10a33e966d88b46e1d3033b34784658e892692a44de18f5b9d43a24b',bootstrapSnapshotSha256:'e5867c15a2eaeae6e7bdc76148603f3e4dfaa1629295985108f7fcf37a2107c0',credentialBindingSha256:'fbdcd71dd2cb159f0a0a973f0bb615058ce0e2b73ac5a7fb05d2bb9d9edff322',manifestSha256:'e6805ccb4f3efec99ac60e89f8813f4eef1dfe3162692148d1ba22987dda9508',sourceRevision:'ea726e0f77594dde18563a3c82a99f6ff7a96664',requestBodySha256:null,redirectPolicy:'error',timeoutMs:20000}};
export async function refusalFixture(){
 const f=await fixture();f.advance(historical.acceptedAt+60000-f.now());
 const m=structuredClone(f.manifest);m.id=historical.campaignId;m.purpose='public-performance-timing';m.sourceRevision=historical.sourceRevision;m.deadline=f.now()+900000;
 const prearm=await f.arm(m,'036ef1532d656a112984dffa4c1916e0');f.control.records=new Map();f.control.fences=new Map([[prearm.nonce,{kind:'terminal',prearmSha256:m.externalControl.sha256}]]);
 const c={manifest:m,manifestSha256:historical.manifestSha256,status:'cleanup-uncertain',cleanupVerified:false,generation:1,phase:0,events:[],objects:{},manual:{intentSha256:historical.intentSha256,intent:{createdAt:historical.acceptedAt-1000,expiresAt:historical.acceptedAt+299000}},attempts:[{manual:true,provider:'runpod',name:historical.name,prearmSha256:m.externalControl.sha256,startedAt:historical.acceptedAt-1000,cutoff:historical.acceptedAt+900000,hourlyCents:100,uncertain:true}]};
 const basis={receiptSha256:'a'.repeat(64),accountId:'test-account',observedAt:f.now(),validUntil:f.now()+900000,activeResources:[],admissions:{},observedDebitCents:3};
 await f.core.save({schema:1,campaigns:{[m.id]:c},manualProgram:{acceptedAt:1794789331599,deadline:1794891540000},actualSpendBasis:basis,creditAllocatedCents:3,pilotReservedCents:3});
 const receipt=async value=>{const ref={repository:'fixture/private-control',commit:'d'.repeat(40),path:`control/receipts/${'a'.repeat(32)}/${'b'.repeat(32)}.json`,sha256:await hash(value)};f.control.records.set(`${ref.path}@${ref.commit}`,structuredClone(value));return ref;};
 // Raw retained journals include indentation/newline and are bound byte-for-byte.
 const attempt={acceptedAt:historical.acceptedAt,method:'POST',url:'https://api.runpod.io/v2/pods',name:historical.name,intentSha256:historical.intentSha256,maximumAttempts:1,bootstrapSecretsExcluded:true};
 const outcome={outcome:'response-received',httpStatus:400,acceptedAt:historical.acceptedAt,name:historical.name,responseBodySha256:await sha256(encode(historical.body)),responseCategory:'unclassified-provider-rejection',rawBodyRetained:false};
 const binding=await f.core.providerRefusalBinding(m.id);
 const r={schema:1,kind:'operator-attested-capacity-refusal',id:'c'.repeat(32),createdAt:f.now(),expiresAt:f.now()+900000,ledgerSha256:binding.ledgerSha256,programAcceptedAt:1794789331599,target:binding.target,accountId:'test-account',actualSpendBasisSha256:basis.receiptSha256,native:{attemptJournalUtf8:JSON.stringify(attempt,null,2)+'\n',outcomeJournalUtf8:JSON.stringify(outcome,null,2)+'\n',responseBodyUtf8:historical.body},attestation:structuredClone(historical.attestation),contract:{url:'https://docs.runpod.io/api-reference-v2/pods/create-a-pod',revision:'3ff535a35d23eef07c962830ba35978f561fe441',sha256:'27538a3a0f71f757af26af05bb83ac2988f1920ad87232692262250b4768958c'}};
 return {...f,m,r,receipt,prearm};
}
