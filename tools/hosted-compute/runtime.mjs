import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assert,canonical,encode,sha256} from './policy.mjs';
const exec=promisify(execFile);
export function runtimeEnvironment(env={}) {
  const allowed=['PATH','HOME','LD_LIBRARY_PATH','CUDA_VISIBLE_DEVICES','CUDA_DEVICE_ORDER','NVIDIA_VISIBLE_DEVICES','NVIDIA_DRIVER_CAPABILITIES'];
  return Object.fromEntries(allowed.filter(key=>typeof env[key]==='string').map(key=>[key,env[key]]));
}
export async function probeRuntime(root,env={}, {execute=exec}={}) {
  try{
    const {stdout}=await execute('tools/ai-trainer/.venv/bin/python',['-m','righelt_training.runtime_probe'],{cwd:root,env:{...runtimeEnvironment(env),LANG:'C.UTF-8',PYTHONPATH:'tools/ai-trainer'},timeout:60000,maxBuffer:65536});
    return JSON.parse(stdout);
  }catch{throw Error('CUDA runtime qualification probe failed');}
}
export async function verifyRuntime(record,identity,manifest) {
  const config=identity.buildConfig;
  assert(record?.schema===1&&record.kind==='cuda-runtime-probe'&&record.kernelPassed===true&&record.gpuCount===1&&record.machine==='x86_64','usable single-GPU Linux runtime required');
  assert(config&&record.torchVersion===config.torchVersion&&record.cudaVersion===config.cudaVersion&&record.pythonVersion?.startsWith(config.pythonVersion+'.'),'actual CUDA wheel/Python runtime differs from image');
  assert(typeof record.driverVersion==='string'&&/^\d+(?:\.\d+)+$/.test(record.driverVersion)&&typeof record.gpuName==='string'&&record.gpuName.length>0&&Array.isArray(record.computeCapability)&&record.computeCapability.length===2&&record.computeCapability.every(Number.isSafeInteger)&&Number.isSafeInteger(record.gpuMemoryBytes)&&record.gpuMemoryBytes>0,'CUDA driver/hardware identity incomplete');
  const runtimeSha256=await sha256(encode(canonical(record)));
  if(manifest.mode==='unattended')assert(runtimeSha256===manifest.runtimeSha256,'actual qualified CUDA runtime changed');
  return {runtimeSha256,record};
}
