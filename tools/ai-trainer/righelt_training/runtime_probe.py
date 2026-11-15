"""Probe the container's CUDA runtime before hydrating private inputs."""
import json
import platform
import subprocess
import re


def probe():
    import torch
    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError('one available CUDA device required')
    device = torch.cuda.get_device_properties(0)
    # Import alone cannot establish a usable driver or working kernel.
    value = torch.tensor([2.0], device='cuda').add_(3).item()
    torch.cuda.synchronize()
    if value != 5:
        raise RuntimeError('CUDA kernel check failed')
    driver = subprocess.check_output(['nvidia-smi', '--query-gpu=driver_version', '--format=csv,noheader'],
                                     text=True, timeout=10).strip().splitlines()
    # CUDA_VISIBLE_DEVICES can mask the assigned CUDA device even when NVML
    # enumerates more devices. All enumerated entries must agree on the driver.
    if not driver or any(not re.fullmatch(r'\d+(?:\.\d+)+',line) for line in driver) or len(set(driver)) != 1:
        raise RuntimeError('exact CUDA driver evidence required')
    return {'schema': 1, 'kind': 'cuda-runtime-probe', 'pythonVersion': platform.python_version(),
            'machine': platform.machine(), 'torchVersion': torch.__version__.split('+')[0],
            'cudaVersion': torch.version.cuda, 'driverVersion': driver[0], 'gpuCount': 1,
            'gpuName': device.name, 'computeCapability': [device.major, device.minor],
            'gpuMemoryBytes': device.total_memory, 'kernelPassed': True}


def main():
    try:
        result = probe()
    except Exception:
        raise SystemExit('CUDA runtime qualification probe failed') from None
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
