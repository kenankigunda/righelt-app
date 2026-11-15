import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from righelt_training import source_image as module

class SourceImageTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.files={'pnpm-lock.yaml':b'lock','tools/ai-trainer/requirements.lock':b'python','packages/a/source.js':b'actual source'}
        for name,raw in self.files.items():
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        inventory={n:hashlib.sha256(b).hexdigest() for n,b in self.files.items()}
        locks={n:inventory[n] for n in ['pnpm-lock.yaml','tools/ai-trainer/requirements.lock']}
        self.identity={'schema':2,'sourceRevision':'a'*40,'locks':locks,'dependencySha256':module.digest(locks),'sourceInventory':inventory,'sourceInventorySha256':module.digest(inventory),'proofInventory':dict(inventory),'proofInventorySha256':module.digest(inventory)}
        self.write();module.source_image.cache_clear();self.addCleanup(module.source_image.cache_clear)
    def write(self):
        (self.root/'.compute-source.json').write_text(json.dumps(self.identity))
    def test_source_only_inventory_needs_no_git_and_rejects_historical_reinterpretation(self):
        with patch.object(module,'ROOT',self.root),patch.dict(os.environ,{'RIGHELT_HOSTED':'1','SOURCE_REVISION':'a'*40}):
            self.assertEqual(module.source_image()['sourceRevision'],'a'*40)
            self.assertEqual(module.proof_inventory(['packages/a']),{'packages/a/source.js':self.identity['sourceInventory']['packages/a/source.js']})
            with self.assertRaisesRegex(ValueError,'historical'):module.proof_inventory(['packages/a'],'b'*40)
    def test_changed_source_or_inventory_never_passes_as_committed(self):
        with patch.object(module,'ROOT',self.root),patch.dict(os.environ,{'RIGHELT_HOSTED':'1','SOURCE_REVISION':'a'*40}):
            (self.root/'packages/a/source.js').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'bytes differ'):module.source_image()
            (self.root/'packages/a/source.js').write_bytes(self.files['packages/a/source.js'])
            self.identity['proofInventory']['packages/a/source.js']='0'*64;self.write()
            with self.assertRaisesRegex(ValueError,'inventory binding'):module.source_image()
    def test_source_symlink_cannot_supply_outside_bytes(self):
        target=self.root/'outside';target.write_bytes(self.files['packages/a/source.js']);local=self.root/'packages/a/source.js';local.unlink();local.symlink_to(target)
        with patch.object(module,'ROOT',self.root),patch.dict(os.environ,{'RIGHELT_HOSTED':'1','SOURCE_REVISION':'a'*40}):
            with self.assertRaisesRegex(ValueError,'symlink'):module.source_image()
    def test_malformed_proof_only_hash_or_revision_is_not_a_source_identity(self):
        self.identity['proofInventory']['tools/ai-trainer/tests/test_missing.py']='not-a-hash'
        self.identity['proofInventorySha256']=module.digest(self.identity['proofInventory']);self.write()
        with patch.object(module,'ROOT',self.root),patch.dict(os.environ,{'RIGHELT_HOSTED':'1','SOURCE_REVISION':'a'*40}):
            with self.assertRaisesRegex(ValueError,'hash malformed'):module.source_image()
        self.identity['proofInventory']['tools/ai-trainer/tests/test_missing.py']='b'*64
        self.identity['proofInventorySha256']=module.digest(self.identity['proofInventory']);self.identity['sourceRevision']='z'*40;self.write()
        with patch.object(module,'ROOT',self.root),patch.dict(os.environ,{'RIGHELT_HOSTED':'1','SOURCE_REVISION':'z'*40}):
            with self.assertRaisesRegex(ValueError,'revision missing'):module.source_image()

if __name__=='__main__':unittest.main()
