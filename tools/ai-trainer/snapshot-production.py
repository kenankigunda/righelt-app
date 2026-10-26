"""SELECT-only export with revision fencing. No credentials or raw rows logged."""
import argparse
import datetime
import hashlib
import gzip
import io
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




def hydrate_payloads(data,identity,limits):
    payloads={row['game_id']:row for row in data['payloads']}
    if len(payloads)!=len(data['payloads']):raise ValueError('Duplicate authoritative payload')
    provenance={}
    for row in data['games']:
        payload=payloads.get(row['game_id'])
        if not payload:
            catalog=json.loads(row['state_json'])
            if type(catalog.get('moveCount'))is int and len(catalog.get('moves',[]))<catalog['moveCount']:
                raise ValueError('Compact game lacks captured full payload/archive state')
            continue
        version=payload['format_version'];cell=payload['state_blob']
        if version not in (1,2)or not isinstance(cell,dict)or set(cell)!={'__righelt_blob_hex'}:
            raise ValueError('Unsupported authoritative storage representation')
        blob=bytes.fromhex(cell['__righelt_blob_hex'])
        if len(blob)>limits['storedBytes']or hashlib.sha256(blob).hexdigest()!=payload['state_sha256']:
            raise ValueError('Authoritative payload checksum/size mismatch')
        with gzip.GzipFile(fileobj=io.BytesIO(blob))as stream:raw=stream.read(limits['rawBytes']+1)
        if len(raw)>limits['rawBytes']:raise ValueError('Authoritative payload decompression bound exceeded')
        decoded=json.loads(raw.decode('utf-8'));catalog=json.loads(row['state_json'])
        if not isinstance(decoded,dict)or decoded.get('id')!=row['game_id']:
            raise ValueError('Authoritative payload game identity mismatch')
        if version==2:
            metadata={k:v for k,v in catalog.items()if k not in ('moves','turns','moveCount')}
            decoded={**decoded,**metadata,'moves':decoded['moves'],'turns':decoded['turns']}
        if decoded.get('computer',{}).get('ownerId')!=identity:
            raise ValueError('Authoritative computer owner mismatch')
        if 'gameplay_revision'in row and decoded.get('gameplayRevision')!=row['gameplay_revision']:
            raise ValueError('Authoritative gameplay revision mismatch')
        before=hashlib.sha256(row['state_json'].encode()).hexdigest()
        row['state_json']=json.dumps(decoded,ensure_ascii=False,separators=(',',':'))
        provenance[row['game_id']]={'formatVersion':version,'stateBlobSha256':payload['state_sha256'],
            'catalogStateSha256':before,'hydratedStateSha256':hashlib.sha256(row['state_json'].encode()).hexdigest()}
    return provenance

def atomic_snapshot(directory,identity,query):
    """One SELECT statement reads every retained row and its counts/cutoff."""
    directory=Path(directory);directory.mkdir(mode=0o700,parents=True,exist_ok=False)
    escaped=identity.replace("'","''")
    tables={'games':('live_games','g'),'decisions':('live_decision_archive','d'),
            'checkpoints':('live_position_checkpoints','c'),'receipts':('live_command_receipts','r'),
            'attempts':('live_decision_attempts','a'),'payloads':('game_payloads','p'),
            'archives':('game_archives','z'),'archive_chunks':('storage_archive_chunks','h'),
            'archive_views':('game_archive_views','v'),'restore_receipts':('game_restore_receipts','u'),
            'restore_reservations':('storage_restore_reservations','s'),
            'tombstones':('live_legacy_command_tombstones','t')}
    mapping=json.dumps(list((kind,table) for kind,(table,_) in tables.items())).replace("'","''")
    schema_query=("SELECT json_extract(k.value,'$[0]') AS kind,p.name,p.cid "
                  f"FROM json_each('{mapping}') k JOIN pragma_table_info(json_extract(k.value,'$[1]')) p")
    discovered=query(schema_query);columns={}
    for kind in tables:
        names=[row['name']for row in sorted((row for row in discovered if row['kind']==kind),key=lambda row:row['cid'])]
        if not names or len(names)!=len(set(names))or 'game_id'not in names:raise ValueError('Incomplete production table schema')
        columns[kind]=names
    def quoted(name):return '"'+name.replace('"','""')+'"'
    branches=[];joins=[];present=[];counts=[]
    for kind,(table,alias)in tables.items():
        condition=f"{alias}.game_id IN (SELECT game_id FROM owned)"
        if kind=='attempts':condition+=f" AND {alias}.kind='computer'"
        fields=[]
        for name in columns[kind]:
            ref=alias+'.'+quoted(name)
            if kind=='payloads'and name=='state_blob':
                cell=f"CASE WHEN typeof({ref})='blob' THEN json_object('__righelt_blob_parts',(length({ref})+262143)/262144,'bytes',length({ref})) ELSE {ref} END"
            else:
                cell=f"CASE WHEN typeof({ref})='blob' THEN json_object('__righelt_blob_hex',hex({ref})) ELSE {ref} END"
            fields.extend(["'$."+json.dumps(name).replace("'","''")+"'",cell])
        payload="'{}'"
        # D1 permits32arguments perfunction: at most15path/value pairs plusbase.
        for offset in range(0,len(fields),30):payload=f"json_set({payload},{','.join(fields[offset:offset+30])})"
        branches.append(f"WHEN '{kind}' THEN {payload}")
        # Exactly one source table can match each selector. Empty sources produce
        # a NULL join row that is removed below, rather than an invented record.
        joins.append(f"LEFT JOIN {table} {alias} ON k.value='{kind}' AND {condition}")
        present.append(f"(k.value='{kind}' AND {alias}.game_id IS NOT NULL)")
        counts.extend(["'"+kind+"'",f"(SELECT COUNT(*) FROM {table} {alias} WHERE {condition})"])
    schema_fields=[]
    for kind,(table,_)in tables.items():
        schema_fields.extend(["'"+kind+"'",f"json((SELECT json_group_array(name) FROM (SELECT name FROM pragma_table_info('{table}') ORDER BY cid)))"])
    meta="json_object('cutoff',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'counts',json_object("+','.join(counts)+"),'columns',json_object("+','.join(schema_fields)+"))"
    branches.append(f"WHEN 'meta' THEN {meta}")
    joins.append("LEFT JOIN game_payloads bp ON k.value='payload_blob_chunks' AND bp.game_id IN(SELECT game_id FROM owned) AND typeof(bp.state_blob)='blob'")
    joins.append("LEFT JOIN blob_offsets b ON k.value='payload_blob_chunks' AND b.n<length(bp.state_blob)")
    branches.append("WHEN 'payload_blob_chunks' THEN json_object('game_id',bp.game_id,'offset',b.n,'hex',hex(substr(bp.state_blob,b.n+1,262144)))")
    present.extend(["k.value='meta'","(k.value='payload_blob_chunks' AND bp.game_id IS NOT NULL AND b.n IS NOT NULL)"])
    kinds=json.dumps([*tables,'payload_blob_chunks','meta'])
    sql=("WITH RECURSIVE owned AS (SELECT g.game_id FROM live_games g WHERE "
         f"json_extract(g.state_json,'$.computer.ownerId')='{escaped}'), blob_offsets(n) AS (SELECT 0 UNION ALL SELECT n+262144 FROM blob_offsets WHERE n+262144<(SELECT COALESCE(MAX(length(state_blob)),0)FROM game_payloads WHERE game_id IN(SELECT game_id FROM owned))) "
         +"SELECT k.value AS kind,CASE k.value "+' '.join(branches)+f" END AS payload FROM json_each('{kinds}') k "+' '.join(joins)+' WHERE '+' OR '.join(present))
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    exported=query(sql)
    raw_export=(json.dumps(exported,ensure_ascii=False,indent=2)+'\n').encode()
    raw_path=directory/'raw-export.json';raw_path.write_bytes(raw_export);raw_path.chmod(0o600)
    data={kind:[]for kind in tables};metadata=[];blob_chunks=[]
    for row in exported:
        payload=json.loads(row['payload'])
        if row['kind']=='meta':metadata.append(payload)
        elif row['kind']=='payload_blob_chunks':blob_chunks.append(payload)
        elif row['kind']in data:data[row['kind']].append(payload)
        else:raise ValueError('Unknown atomic snapshot row')
    if len(metadata)!=1 or any(metadata[0]['counts'].get(kind)!=len(rows)for kind,rows in data.items()):
        raise ValueError('Incomplete atomic production export; preserve directory and retry new cut')
    if metadata[0].get('columns')!=columns:
        raise ValueError('Production schema changed during export; retry a new immutable cutoff')
    used_chunks=set()
    for payload in data['payloads']:
        cell=payload['state_blob']
        if isinstance(cell,dict)and '__righelt_blob_parts'in cell:
            parts=sorted((p for p in blob_chunks if p['game_id']==payload['game_id']),key=lambda p:p['offset'])
            if len(parts)!=cell['__righelt_blob_parts']or [p['offset']for p in parts]!=list(range(0,cell['bytes'],262144)):
                raise ValueError('Incomplete authoritative blob chunks')
            pieces=[]
            for part in parts:
                identity_key=(part['game_id'],part['offset'])
                if identity_key in used_chunks:raise ValueError('Duplicate authoritative blob chunk')
                used_chunks.add(identity_key);piece=bytes.fromhex(part['hex'])
                if len(piece)!=min(262144,cell['bytes']-part['offset']):raise ValueError('Invalid authoritative chunk length')
                pieces.append(piece)
            payload['state_blob']={'__righelt_blob_hex':b''.join(pieces).hex().upper()}
    if len(used_chunks)!=len(blob_chunks):raise ValueError('Orphaned authoritative blob chunks')
    data['catalog_games']=[dict(row)for row in data['games']]
    # Read limits come from the same authoritative policy as production readers.
    checkout=Path(__file__).resolve().parents[2]
    policy=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {STORAGE_POLICY as p}from './packages/shared-types/src/storage-policy.js'; console.log(JSON.stringify({rawBytes:p.maximumStateBytes,storedBytes:p.maximumLegacyStateBytes}));"],cwd=checkout,text=True,timeout=5))
    representations=hydrate_payloads(data,identity,policy)
    manifest={'schema':1,'identity':identity,'readOnly':True,'startedAt':started,
              'cutoff':metadata[0]['cutoff'],'consistency':'single-select-all-tables-v1',
              'querySha256':hashlib.sha256(sql.encode()).hexdigest(),'columns':columns,
              'binaryEncoding':'__righelt_blob_hex','representations':representations,'files':{'raw-export':{'sha256':hashlib.sha256(raw_export).hexdigest(),'rows':len(exported)}}}
    orders={'games':('game_id',),'decisions':('game_id','event_seq','event_ordinal'),
            'checkpoints':('game_id','gameplay_revision'),'receipts':('game_id','client_command_id'),
            'attempts':('game_id','attempt_id')}
    for kind,rows in data.items():
        rows.sort(key=lambda row:tuple(row.get(key,'')for key in orders.get(kind,('game_id',))))
        raw=(json.dumps(rows,ensure_ascii=False,indent=2)+'\n').encode()
        path=directory/(kind+'.json');path.write_bytes(raw);path.chmod(0o600)
        manifest['files'][kind]={'sha256':hashlib.sha256(raw).hexdigest(),'rows':len(rows)}
    if data['archives']or data['restore_reservations']:
        (directory/'incomplete-storage.json').write_text(json.dumps({'reason':'Archive/restore state requires immutable object capture','archiveGames':[r['game_id']for r in data['archives']],'restoreGames':[r['game_id']for r in data['restore_reservations']]},indent=2))
        raise ValueError('Archive/restore representation present; full immutable archive capture required')
    path=directory/'manifest.json';path.write_text(json.dumps(manifest,indent=2)+'\n');path.chmod(0o600)
    return manifest

def production_query(sql):
    result = subprocess.run(['pnpm', 'dlx', 'wrangler@4.149.0', 'd1', 'execute',
        'righelt-db-prod', '--config', 'apps/api/wrangler.toml', '--remote',
        '--command', sql, '--json'], capture_output=True, text=True, check=True, timeout=120)
    data = json.loads(result.stdout)
    if not all(item.get('success') for item in data):
        raise ValueError('production SELECT failed')
    return [row for item in data for row in item['results']]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--identity', required=True)
    args = parser.parse_args()


    result = atomic_snapshot(args.output, args.identity, production_query)
    print(json.dumps({'cutoff': result['cutoff'],
                      'rows': {k: v['rows'] for k, v in result['files'].items()}}))


if __name__ == '__main__':
    main()
