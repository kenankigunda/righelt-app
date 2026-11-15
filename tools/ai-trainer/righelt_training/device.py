"""Explicit execution backend. Historical local campaigns still require MPS."""
import os
import torch


def configured_device():
    name = os.environ.get('RIGHELT_TRAINING_DEVICE', 'mps')
    if name not in ('cpu', 'mps', 'cuda'):
        raise ValueError('training device must be cpu, mps or cuda')
    return name


def selected_device(requested=None):
    name = requested or configured_device()
    if name not in ('cpu', 'mps', 'cuda'):
        raise ValueError('training device must be cpu, mps or cuda')
    if name == 'mps' and not torch.backends.mps.is_available():
        raise RuntimeError('MPS unavailable; no implicit backend fallback')
    if name == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('CUDA unavailable; no implicit backend fallback')
    return torch.device(name)


def memory_bytes(device=None):
    device = selected_device(device or os.environ.get('RIGHELT_TRAINING_DEVICE') or ('mps' if torch.backends.mps.is_available() else 'cpu'))
    if device.type == 'mps':
        return torch.mps.driver_allocated_memory()
    if device.type == 'cuda':
        return torch.cuda.memory_reserved(device)
    return 0


def synchronize(device):
    if device.type == 'mps':
        torch.mps.synchronize()
    elif device.type == 'cuda':
        torch.cuda.synchronize(device)
