"""Seeded, family-partitioned starts. No catalog or sealed puzzle inputs."""
import hashlib
import json
import random
from .config import CONFIG
from .replay import partition_for_family


def simple_root(seed):
    rng = random.Random(seed)
    # Small local-contact positions, far below a developed game's piece count.
    row, col = rng.randrange(2, 6), rng.randrange(3, 7)
    pieces = []
    occupied = set()
    for owner, points in [('P1', [(row, col), (row, col-1), (row-1, col)]),
                          ('P2', [(row+1, col-1), (row+1, col-2), (row+2, col-1)])]:
        count = rng.randrange(1, 4)
        for index, (r, c) in enumerate(points[:count]):
            if (r, c) in occupied:
                raise ValueError('curriculum overlap')
            occupied.add((r, c))
            pieces.append({'id': ('C1' if owner == 'P1' else 'C2') if index == 0 else f'{owner}-start-{index}',
                           'owner': owner, 'kind': 'commander' if index == 0 else 'unit',
                           'position': {'row': r, 'col': c}, 'supplied': True, 'commanded': True})
    return {'boardSize': CONFIG['boardSize'], 'sideToMove': rng.choice(['P1', 'P2']),
            'turnIndex': 0, 'pieces': pieces, 'continuation': None, 'outcome': {'status': 'ongoing'}}


def family_for_root(root):
    # Unit-count and controller variants of the same commander arrangement are
    # related starts and must not straddle training/validation/final partitions.
    anchors = sorted([(p['owner'], p['position']['row'], p['position']['col'])
                      for p in root['pieces'] if p['kind'] == 'commander'])
    return 'simple:' + hashlib.sha256(json.dumps(anchors, separators=(',', ':')).encode()).hexdigest()


class Curriculum:
    def __init__(self, seed, *, switched=False):
        self.seed = seed
        self.switched = switched

    def observe(self, elapsed_seconds, terminal_games, truncated_games, completed_games):
        if not self.switched and elapsed_seconds >= 3600 and (
                terminal_games < 100 or (completed_games > 0 and truncated_games / completed_games > .8)):
            self.switched = True
            return True
        return False

    def job(self, index, model_version):
        # Job index, rather than asynchronous completion order, determines all starts.
        seed = int.from_bytes(hashlib.sha256(f'{self.seed}:{index}'.encode()).digest()[:4], 'big')
        rng = random.Random(seed)
        weights = CONFIG['training']['fallbackCurriculum' if self.switched else 'curriculum']
        draw = rng.random()
        kind = 'normal' if draw < weights[0] else 'simple' if draw < weights[0] + weights[1] else 'continuation'
        for attempt in range(10000):
            candidate_seed = (seed + attempt) % (2**32)
            root = None if kind == 'normal' else simple_root(candidate_seed)
            # The standard initial board is the explicit shared-root exception;
            # evaluation trajectories still receive independent sealed seed families.
            family = f'normal:{candidate_seed}' if root is None else family_for_root(root)
            if partition_for_family(family) == 'train':
                return {'command': 'generate', 'id': f'game-{self.seed}-{index}', 'seed': candidate_seed,
                        'familyId': family, 'partition': 'train', 'kind': kind,
                        'initialState': root, 'modelVersion': model_version}
        raise RuntimeError('cannot find training-partition root')
