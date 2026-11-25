"""Content-addressed, append-only storage for completed training batch witnesses."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


BLOCK_SIZE = 256
BLOCK_KEY = 'witnessBlocksV1'


def _validate_rows(rows, first):
    if any(type(row.get('update')) is not int or row['update'] != first + i
           for i, row in enumerate(rows)):
        raise ValueError('training witness updates are not consecutive')


def _sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _publish(directory, rows):
    raw = json.dumps(rows, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    digest = hashlib.sha256(raw).hexdigest()
    path = directory / (digest + '.json.gz')
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temp:
            try:
                temp.write(gzip.compress(raw, compresslevel=1, mtime=0))
                temp.flush()
                os.fsync(temp.fileno())
                try:
                    os.link(temp.name, path)
                except FileExistsError:
                    pass
                _sync_directory(directory)
            finally:
                os.unlink(temp.name)
    if gzip.decompress(path.read_bytes()) != raw:
        raise ValueError('existing training witness block differs')
    return {'first': rows[0]['update'], 'sha256': digest}


def seal_completed(state, checkpoint_directory):
    """Remove a full in-memory block only after its immutable bytes are durable."""
    fresh = state.get('freshTraining')
    if fresh is None or len(fresh['batches']) < BLOCK_SIZE:
        return
    directory = Path(checkpoint_directory) / 'batch-witnesses'
    directory.mkdir(parents=True, exist_ok=True)
    _sync_directory(directory.parent)
    receipts = list(fresh.get(BLOCK_KEY, []))
    rows = fresh['batches']
    first = receipts[-1]['first'] + BLOCK_SIZE if receipts else rows[0]['update']
    _validate_rows(rows, first)
    if first + len(rows) - 1 != state['updates']:
        raise ValueError('training witness tail differs from checkpoint update')
    offset = 0
    while len(rows) - offset >= BLOCK_SIZE:
        receipts.append(_publish(directory, rows[offset:offset + BLOCK_SIZE]))
        offset += BLOCK_SIZE
    fresh.update({BLOCK_KEY: receipts, 'batches': rows[offset:]})


def expanded_state(state, checkpoint_directory):
    """Return the original logical records after checking every referenced block."""
    fresh = state.get('freshTraining', {})
    if BLOCK_KEY not in fresh:
        return state
    receipts = fresh[BLOCK_KEY]
    if not isinstance(receipts, list) or not receipts:
        raise ValueError('invalid training witness block inventory')
    first = receipts[0].get('first')
    if type(first) is not int or first < 1:
        raise ValueError('invalid initial training witness update')
    rows = []
    for receipt in receipts:
        digest = receipt.get('sha256', '')
        if (set(receipt) != {'first', 'sha256'} or receipt['first'] != first + len(rows)
                or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest)):
            raise ValueError('invalid training witness block binding')
        path = Path(checkpoint_directory) / 'batch-witnesses' / (digest + '.json.gz')
        raw = gzip.decompress(path.read_bytes())
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError('training witness block checksum mismatch')
        block = json.loads(raw)
        if not isinstance(block, list) or len(block) != BLOCK_SIZE:
            raise ValueError('invalid training witness block length')
        _validate_rows(block, receipt['first'])
        rows.extend(block)
    tail = fresh['batches']
    if len(tail) >= BLOCK_SIZE or first + len(rows) + len(tail) - 1 != state['updates']:
        raise ValueError('training witness tail differs from checkpoint update')
    _validate_rows(tail, first + len(rows))
    rows.extend(tail)
    logical = dict(fresh)
    del logical[BLOCK_KEY]
    logical['batches'] = rows
    return {**state, 'freshTraining': logical}
