"""SELECT-only export with revision fencing. No credentials or raw rows logged."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess


def snapshot(directory, identity, query):
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    escaped = identity.replace("'", "''")
    where = f"json_extract(g.state_json,'$.computer.ownerId')='{escaped}'"
    fence = ("SELECT g.game_id,g.event_seq,g.gameplay_revision,g.latest_activity_at "
             f"FROM live_games g WHERE {where} ORDER BY g.game_id")
    before = query(fence)
    queries = {
        'games': f'SELECT g.* FROM live_games g WHERE {where} ORDER BY g.game_id',
        'decisions': f'SELECT d.* FROM live_decision_archive d JOIN live_games g USING(game_id) WHERE {where} ORDER BY d.game_id,d.event_seq,d.event_ordinal',
        'checkpoints': f'SELECT c.* FROM live_position_checkpoints c JOIN live_games g USING(game_id) WHERE {where} ORDER BY c.game_id,c.gameplay_revision',
        'receipts': f'SELECT r.* FROM live_command_receipts r JOIN live_games g USING(game_id) WHERE {where} ORDER BY r.game_id,r.client_command_id',
        'attempts': f"SELECT a.* FROM live_decision_attempts a JOIN live_games g USING(game_id) WHERE {where} AND a.kind='computer' ORDER BY a.game_id,a.attempt_id",
    }
    manifest = {'schema': 1, 'identity': identity, 'readOnly': True,
                'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'files': {}}
    for name, sql in queries.items():
        rows = query(sql)
        raw = (json.dumps(rows, ensure_ascii=False, indent=2)+'\n').encode()
        path = directory/(name+'.json')
        path.write_bytes(raw); path.chmod(0o600)
        manifest['files'][name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'rows': len(rows)}
    after = query(fence)
    if before != after:
        # Keep evidence of the failed cut; never publish a valid manifest.
        (directory/'inconsistent-cut.json').write_text(json.dumps({'before': before, 'after': after}))
        (directory/'inconsistent-cut.json').chmod(0o600)
        raise ValueError('production changed during export; repeat into a new snapshot directory')
    manifest['cutoff'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    manifest['revisionFence'] = after
    path = directory/'manifest.json'
    path.write_text(json.dumps(manifest, indent=2)+'\n'); path.chmod(0o600)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--identity', required=True)
    args = parser.parse_args()

    def query(sql):
        result = subprocess.run(['pnpm', 'dlx', 'wrangler@4.149.0', 'd1', 'execute',
            'righelt-db-prod', '--config', 'apps/api/wrangler.toml', '--remote',
            '--command', sql, '--json'], capture_output=True, text=True, check=True, timeout=120)
        data = json.loads(result.stdout)
        if not all(item.get('success') for item in data):
            raise ValueError('production SELECT failed')
        return [row for item in data for row in item['results']]

    result = snapshot(args.output, args.identity, query)
    print(json.dumps({'cutoff': result['cutoff'],
                      'rows': {k: v['rows'] for k, v in result['files'].items()}}))


if __name__ == '__main__':
    main()
