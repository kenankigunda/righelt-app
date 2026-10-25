"""Model-free checks of initial and reviewed repaired source identities."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from righelt_training.manifest_envelope import active_envelope


class EnvelopeTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.initial=self.write(self.root/'manifest.json',{'sourceRevision':'a'*40})

    def write(self,path,manifest):
        sha=hashlib.sha256(json.dumps(manifest,sort_keys=True,allow_nan=False).encode()).hexdigest()
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps({'manifest':manifest,'sha256':sha}))
        return sha

    def amended(self):
        manifest={'sourceRevision':'b'*40}
        sha=hashlib.sha256(json.dumps(manifest,sort_keys=True,allow_nan=False).encode()).hexdigest()
        self.write(self.root/'manifests'/(sha+'.json'),manifest)
        row={'oldManifest':self.initial,'newManifest':sha,'cause':'routine repair',
             'regressionEvidence':'recorded test','reviewEvidence':'independent review',
             'artifactDisposition':'preserved'}
        (self.root/'source-amendments.jsonl').write_text(json.dumps(row)+'\n')
        (self.root/'active-manifest.json').write_text(json.dumps({'sha256':sha}))
        return row

    def test_initial_and_reviewed_amendment_resolve(self):
        self.assertEqual(active_envelope(self.root)['sha256'],self.initial)
        row=self.amended()
        self.assertEqual(active_envelope(self.root)['sha256'],row['newManifest'])

    def test_tampered_initial_or_active_payload_rejects(self):
        row=self.amended()
        p=self.root/'manifests'/(row['newManifest']+'.json')
        d=json.loads(p.read_text());d['manifest']['sourceRevision']='c'*40;p.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError,'checksum'):active_envelope(self.root)

    def test_broken_chain_missing_review_and_pointer_reject(self):
        for field in ('oldManifest','reviewEvidence','pointer'):
            with self.subTest(field=field):
                row=self.amended()
                if field=='pointer':(self.root/'active-manifest.json').write_text(json.dumps({'sha256':'0'*64}))
                else:
                    row[field]='wrong' if field=='oldManifest'else None
                    (self.root/'source-amendments.jsonl').write_text(json.dumps(row)+'\n')
                with self.assertRaises(ValueError):active_envelope(self.root)

    def test_unknown_path_cannot_escape_manifests(self):
        row=self.amended();row['newManifest']='../elsewhere'
        (self.root/'source-amendments.jsonl').write_text(json.dumps(row)+'\n')
        with self.assertRaisesRegex(ValueError,'chain'):active_envelope(self.root)

    def test_absent_or_empty_journal_never_hides_amended_pointer(self):
        for absent in (True,False):
            with self.subTest(absent=absent):
                self.amended()
                journal=self.root/'source-amendments.jsonl'
                if absent:journal.unlink()
                else:journal.write_text('')
                with self.assertRaisesRegex(ValueError,'pointer'):active_envelope(self.root)


if __name__=='__main__':unittest.main()
