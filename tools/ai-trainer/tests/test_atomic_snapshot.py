import importlib.util
import json
import gzip
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('snapshot_production',Path(__file__).parents[1]/'snapshot-production.py')
snapshot=importlib.util.module_from_spec(spec);spec.loader.exec_module(snapshot)


class AtomicSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row;self.addCleanup(self.db.close)
        self.db.executescript('''
          CREATE TABLE live_games(game_id TEXT,state_json TEXT,gameplay_revision INTEGER);
          CREATE TABLE live_decision_archive(game_id TEXT,event_seq INTEGER,event_ordinal INTEGER,payload BLOB);
          CREATE TABLE live_position_checkpoints(game_id TEXT,gameplay_revision INTEGER);
          CREATE TABLE live_command_receipts(game_id TEXT,client_command_id TEXT);
          CREATE TABLE live_decision_attempts(game_id TEXT,attempt_id TEXT,kind TEXT);
          CREATE TABLE game_payloads(game_id TEXT,format_version INTEGER,state_blob BLOB,state_sha256 TEXT);
          CREATE TABLE game_archives(game_id TEXT,status TEXT);
          CREATE TABLE storage_archive_chunks(game_id TEXT);
          CREATE TABLE game_archive_views(game_id TEXT);
          CREATE TABLE game_restore_receipts(game_id TEXT);
          CREATE TABLE storage_restore_reservations(game_id TEXT);
          CREATE TABLE live_legacy_command_tombstones(game_id TEXT);
        ''')
        self.owner="kenan'identity"
        for identity,owner in [('owned',self.owner),('other','someone-else')]:
            self.db.execute('INSERT INTO live_games VALUES(?,?,?)',(identity,json.dumps({'computer':{'ownerId':owner}}),1))
            self.db.execute('INSERT INTO live_decision_archive VALUES(?,?,?,?)',(identity,1,0,b'\x00\xff'))
            self.db.execute('INSERT INTO live_position_checkpoints VALUES(?,?)',(identity,1))
            self.db.execute('INSERT INTO live_command_receipts VALUES(?,?)',(identity,'receipt'))
            self.db.execute('INSERT INTO live_decision_attempts VALUES(?,?,?)',(identity,'attempt','computer'))
        self.queries=[]

    def query(self,sql):
        self.queries.append(sql)
        return [dict(row)for row in self.db.execute(sql)]

    def test_one_statement_captures_all_data_counts_and_cutoff(self):
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut';manifest=snapshot.atomic_snapshot(output,self.owner,self.query)
            self.assertEqual(manifest['consistency'],'single-select-all-tables-v1')
            self.assertEqual(len([q for q in self.queries if q.startswith('WITH RECURSIVE owned')]),1)
            self.assertTrue(all(q.startswith(('SELECT ','WITH RECURSIVE owned'))for q in self.queries))
            self.assertTrue(manifest['cutoff'].endswith('Z'))
            self.assertTrue(all(manifest['files'][kind]['rows']==1 for kind in ('games','decisions','checkpoints','receipts','attempts')))
            game=json.loads((output/'games.json').read_text())[0]
            self.assertEqual(json.loads(game['state_json'])['computer']['ownerId'],self.owner)
            decision=json.loads((output/'decisions.json').read_text())[0]
            self.assertEqual(decision['payload'],{'__righelt_blob_hex':'00FF'})

    def test_schema_discovery_is_not_the_data_cutoff(self):
        def query(sql):
            if sql.startswith('WITH RECURSIVE owned'):
                self.db.execute("INSERT INTO live_command_receipts VALUES('owned','new-before-cut')")
            return self.query(sql)
        with tempfile.TemporaryDirectory()as folder:
            manifest=snapshot.atomic_snapshot(Path(folder)/'cut',self.owner,query)
            self.assertEqual(manifest['files']['receipts']['rows'],2)

    def payload(self,version=1):
        full={'id':'owned','computer':{'ownerId':self.owner},'gameplayRevision':1,'moves':[{'undone':True,'branch':'retained'}],'turns':[{'receipt':'complete'}],'metadata':1}
        card={**full,'moves':[],'turns':[],'moveCount':1,'metadata':2}
        blob=gzip.compress(json.dumps(full).encode());checksum=hashlib.sha256(blob).hexdigest()
        self.db.execute('UPDATE live_games SET state_json=? WHERE game_id=?',(json.dumps(card),'owned'))
        self.db.execute('INSERT INTO game_payloads VALUES(?,?,?,?)',('owned',version,blob,checksum))
        return full

    def test_compressed_authority_and_raw_compact_card_are_both_preserved(self):
        full=self.payload()
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut';manifest=snapshot.atomic_snapshot(output,self.owner,self.query)
            hydrated=json.loads(json.loads((output/'games.json').read_text())[0]['state_json'])
            card=json.loads(json.loads((output/'catalog_games.json').read_text())[0]['state_json'])
            self.assertEqual(hydrated,full);self.assertEqual(card['moves'],[])
            self.assertEqual(manifest['files']['payloads']['rows'],1)
            self.assertEqual(manifest['representations']['owned']['formatVersion'],1)

    def test_format_two_matches_live_history_metadata_merge(self):
        full=self.payload(version=2)
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut';snapshot.atomic_snapshot(output,self.owner,self.query)
            hydrated=json.loads(json.loads((output/'games.json').read_text())[0]['state_json'])
            self.assertEqual(hydrated['moves'],full['moves']);self.assertEqual(hydrated['turns'],full['turns'])
            self.assertEqual(hydrated['metadata'],2)

    def test_corrupt_payload_or_archive_never_publishes_complete_snapshot(self):
        self.payload();self.db.execute("UPDATE game_payloads SET state_sha256='wrong'")
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut'
            with self.assertRaisesRegex(ValueError,'checksum'):snapshot.atomic_snapshot(output,self.owner,self.query)
            self.assertFalse((output/'manifest.json').exists());self.assertTrue((output/'raw-export.json').exists())
        self.db.execute('DELETE FROM game_payloads');self.db.execute("UPDATE live_games SET state_json=? WHERE game_id='owned'",(json.dumps({'computer':{'ownerId':self.owner}}),))
        self.db.execute("INSERT INTO game_archives VALUES('owned','archived')")
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut'
            with self.assertRaisesRegex(ValueError,'Archive/restore'):snapshot.atomic_snapshot(output,self.owner,self.query)
            self.assertFalse((output/'manifest.json').exists());self.assertTrue((output/'incomplete-storage.json').exists())

    def test_added_populated_column_before_cut_fails_closed(self):
        def query(sql):
            if sql.startswith('WITH RECURSIVE owned'):
                self.db.execute('ALTER TABLE live_games ADD COLUMN new_provenance TEXT')
                self.db.execute("UPDATE live_games SET new_provenance='retained'")
            return self.query(sql)
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut'
            with self.assertRaisesRegex(ValueError,'schema changed'):snapshot.atomic_snapshot(output,self.owner,query)
            self.assertFalse((output/'manifest.json').exists())

    def test_d1_argument_and_two_megabyte_cell_limits_preserve_large_payload(self):
        import base64,random
        full=self.payload()
        full['padding']=base64.b64encode(random.Random(17).randbytes(1_100_000)).decode()
        blob=gzip.compress(json.dumps(full).encode())
        self.db.execute('UPDATE game_payloads SET state_blob=?,state_sha256=?',(blob,hashlib.sha256(blob).hexdigest()))
        for index in range(30):self.db.execute(f'ALTER TABLE live_games ADD COLUMN extra_{index} TEXT')
        if hasattr(self.db,'setlimit'):
            self.db.setlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32)
            self.db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH,2_000_000)
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut';manifest=snapshot.atomic_snapshot(output,self.owner,self.query)
            actual=json.loads(json.loads((output/'games.json').read_text())[0]['state_json'])
            self.assertEqual(actual['padding'],full['padding'])
            self.assertEqual(manifest['files']['payloads']['rows'],1)
            self.assertTrue(all(len(query.encode())<100_000 for query in self.queries))

    def test_truncated_remote_response_never_publishes_manifest(self):
        def query(sql):
            rows=self.query(sql)
            return [row for row in rows if row.get('kind')!='decisions']if sql.startswith('WITH RECURSIVE owned')else rows
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut'
            with self.assertRaisesRegex(ValueError,'Incomplete atomic'):snapshot.atomic_snapshot(output,self.owner,query)
            self.assertFalse((output/'manifest.json').exists())

    def test_low_compound_select_limit_keeps_one_atomic_data_read(self):
        self.db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,10)
        self.payload()
        with tempfile.TemporaryDirectory()as folder:
            output=Path(folder)/'cut';manifest=snapshot.atomic_snapshot(output,self.owner,self.query)
            self.assertEqual(manifest['files']['games']['rows'],1)
            self.assertEqual(manifest['files']['payloads']['rows'],1)
            self.assertEqual(len([q for q in self.queries if q.startswith('WITH RECURSIVE owned')]),1)

if __name__=='__main__':unittest.main()
