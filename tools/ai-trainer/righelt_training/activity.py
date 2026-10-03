"""Convert a fresh Codex task snapshot into conservative resource-policy input."""
import argparse
import json
from pathlib import Path
import time
from .checkpoint import atomic_json


def observation(snapshot, project_id, excluded_id):
    rows=[row for row in snapshot.get('threads',[]) if row.get('projectId')==project_id and row.get('id')!=excluded_id]
    complete=snapshot.get('sourcesComplete') is True and bool(rows)
    statuses={row.get('status') for row in rows}
    active=True if 'active' in statuses else False if complete and statuses<={'idle'} else None
    return {'schema':1,'observedAt':snapshot['observedAt'],'developmentActive':active,
            'taskIds':[row['id'] for row in rows],'source':'codex-task-snapshot'}


def main():
    p=argparse.ArgumentParser();p.add_argument('--snapshot',type=Path,required=True);p.add_argument('--project',required=True)
    p.add_argument('--exclude',required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    data=json.loads(args.snapshot.read_text())
    if not 0<=time.time()-data['observedAt']<=60:raise ValueError('snapshot is stale or future-dated')
    atomic_json(args.output,observation(data,args.project,args.exclude))

if __name__=='__main__':main()
