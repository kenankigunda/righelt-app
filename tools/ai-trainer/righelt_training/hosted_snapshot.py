"""Copy a coherent run tree while its task-owned processes are suspended."""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile
import psutil


def snapshot(root, directory, pid=None, parent=None):
    root = Path(root).resolve()
    source = (root / directory).resolve()
    if not source.is_relative_to(root / '.ai-runs'):
        raise ValueError('snapshot outside run root')
    suspended = []
    target = None
    try:
        if pid is not None:
            leader = psutil.Process(pid)
            if leader.ppid() != parent or leader.environ().get('COMPUTE_ID') != os.environ.get('COMPUTE_ID'):
                raise ValueError('snapshot process ownership mismatch')
            leader.suspend(); suspended.append(leader)
            # Freeze descendants too, including the trainer's separate sessions.
            for _ in range(4):
                unseen = [p for p in leader.children(recursive=True) if p not in suspended]
                if not unseen: break
                for process in unseen:
                    try: process.suspend(); suspended.append(process)
                    except psutil.NoSuchProcess: pass
            else: raise RuntimeError('snapshot process tree did not settle')
        target = Path(tempfile.mkdtemp(prefix='righelt-snapshot-'))
        for path in source.rglob('*'):
            if path.is_symlink(): raise ValueError('symlink in run snapshot')
            if path.is_file() and not path.name.endswith(('.lock', '.tmp')):
                dest = target / path.relative_to(root)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)
        return str(target)
    except BaseException:
        if target is not None: shutil.rmtree(target)
        raise
    finally:
        for process in reversed(suspended):
            try: process.resume()
            except psutil.NoSuchProcess: pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', required=True)
    p.add_argument('--directory', required=True)
    p.add_argument('--pid', type=int)
    p.add_argument('--parent', type=int)
    args = p.parse_args()
    print(json.dumps({'directory': snapshot(args.root, args.directory, args.pid, args.parent)}))


if __name__ == '__main__': main()
