"""Stop only compute witnessed in this run's existing ownership ledgers."""
import argparse
from pathlib import Path
from .processes import cleanup_owned


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--directory', type=Path, required=True)
    args = p.parse_args()
    root = args.directory.resolve()
    for ledger in root.rglob('process-ownership.jsonl'):
        if ledger.is_symlink():
            raise ValueError('symlink ownership ledger')
        cleanup_owned(ledger.parent)


if __name__ == '__main__':
    main()
