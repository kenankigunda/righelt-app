"""Fixed operations for the charged, externally supervised bootstrap proof."""
import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import sys
import time

from .allocation import Allocation
from .bootstrap import STATES, validate_identity, runtime_identity
from .budget import effective_deadline
from .config import ROOT
from .parity import verify_corpus
from .runner_monitor import RunnerMonitor
from .sequence import read, immutable


@contextmanager
def arguments(argv):
    original = sys.argv
    try:
        sys.argv = argv
        yield
    finally: sys.argv = original


def run(attempt):
    attempt = Path(attempt).resolve(); plan = read(attempt / 'plan.json')
    directory = Path(plan['runDirectory']).resolve(); runtime = plan['runtime']; identity = plan['identity']
    if (not attempt.is_relative_to(directory / 'bootstrap') or runtime.get('command') != 'bootstrap-proof'
            or runtime.get('supervisorPid') != os.getppid() or os.getpgrp() != os.getpid()
            or read(directory / 'runtime.json') != runtime):
        raise ValueError('bootstrap worker requires the original external supervisor')
    creation, _, pending = Allocation(directory.parent, directory).accounting()
    interval = next((row for row in pending if row['id'] == runtime['allocationInterval']), None)
    if (creation['id'] != runtime['allocationId'] or interval != plan['interval']
            or interval.get('owner', {}).get('pid') != os.getppid()):
        raise ValueError('bootstrap worker lacks an open charged interval')
    validate_identity(identity)
    corpus = Path(identity['corpus']['path']); checkpoint = Path(identity['checkpoint']['path'])
    if len(verify_corpus(read(corpus))) != STATES: raise ValueError('bootstrap requires exactly 1000 frozen states')
    deadline = effective_deadline(runtime) - 5
    def bound(maximum):
        remaining = min(maximum, deadline-time.monotonic())
        if remaining <= 1: raise TimeoutError('bootstrap proof allowance exhausted')
        return remaining
    script = ROOT / 'tools/ai-trainer/bootstrap-proof.mjs'
    with RunnerMonitor(directory) as monitor:
        with monitor.operation('bootstrap-total', bound(plan['remainingSeconds'])):
            with monitor.operation('bootstrap-corpus', bound(300)):
                subprocess.run(['node', '--import', 'tsx', str(script), 'corpus', str(attempt)],
                               cwd=ROOT, check=True, timeout=bound(300))
            from .parity import main as numeric_main
            with monitor.operation('bootstrap-native-numeric', bound(600)):
                with arguments(['parity', '--corpus', str(corpus), '--output', str(attempt / 'numeric'),
                                '--reference-output', str(attempt / 'native-raw.json'), '--require-mps',
                                '--checkpoint', str(checkpoint)]):
                    numeric_main()
            from .search_parity import main as search_main
            with monitor.operation('bootstrap-native-search', bound(1800)):
                with arguments(['search_parity', '--corpus', str(corpus), '--output', str(attempt / 'native-search.json'),
                                '--device', 'mps', '--limit', str(STATES), '--seconds', str(bound(1790)),
                                '--checkpoint', str(checkpoint)]):
                    search_main()
                if read(attempt / 'native-search.json').get('complete') is not True:
                    raise ValueError('native search proof is incomplete')
            with monitor.operation('bootstrap-browser-build', bound(120)):
                subprocess.run(['node', str(ROOT / 'scripts/build-ai-benchmark.mjs'), '--out', str(attempt / 'benchmark'),
                                '--model', str(attempt / 'numeric/model.onnx'), '--corpus', str(corpus)],
                               cwd=ROOT, check=True, timeout=bound(120))
            with monitor.operation('bootstrap-browser-proof', bound(1800)):
                subprocess.run(['node', '--import', 'tsx', str(script), 'browser', str(attempt)],
                               cwd=ROOT, check=True, timeout=bound(1800))
    validate_identity(identity)
    immutable(attempt / 'worker-complete.json', {'complete': True, 'identity': identity,
              'runtime': runtime_identity(), 'productionPromotion': False})


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--attempt', type=Path, required=True)
    args = parser.parse_args(); run(args.attempt)


if __name__ == '__main__': main()
