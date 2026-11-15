import hashlib
import json
import tempfile
from pathlib import Path
import unittest
from righelt_training.portable import PortableClosure

class PortableTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.run=self.root/'.ai-runs'/'restore';self.run.mkdir(parents=True)
        self.outside=self.root/'original-mac-archive';self.outside.write_bytes(b'wrong original bytes')
        self.local=self.run/'payload';self.local.write_bytes(b'independent cloud bytes')
        self.expected=hashlib.sha256(self.local.read_bytes()).hexdigest()
    def closure(self,entries=None):
        self.path=self.run/'portable.json'
        self.path.write_text(json.dumps({'schema':1,'entries':entries or [{'reference':str(self.outside),'path':str(self.local.relative_to(self.root)),'sha256':self.expected}]}))
        return PortableClosure(self.path,hashlib.sha256(self.path.read_bytes()).hexdigest(),self.root)
    def test_existing_original_cannot_supply_restore_bytes(self):
        c=self.closure()
        self.assertEqual(c.resolve(self.outside,expected_sha256=self.expected).read_bytes(),b'independent cloud bytes')
        self.local.unlink()
        with self.assertRaises(FileNotFoundError):c.resolve(self.outside,expected_sha256=self.expected)
    def test_unmapped_absolute_expected_hash_mismatch_and_tamper_reject(self):
        c=self.closure()
        with self.assertRaisesRegex(ValueError,'unmapped'):c.resolve(self.root.parent/'unmapped')
        with self.assertRaisesRegex(ValueError,'committed'):c.resolve(self.outside,expected_sha256='f'*64)
        self.local.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError,'checksum'):c.resolve(self.outside)
    def test_symlink_and_escape_inventory_reject(self):
        link=self.run/'link';link.symlink_to(self.outside)
        for relative in ('.ai-runs/restore/link','.ai-runs/../original-mac-archive',str(self.outside)):
            with self.subTest(relative=relative),self.assertRaises(ValueError):
                self.closure([{'reference':'old','path':relative,'sha256':self.expected}])
    def test_inventory_digest_and_conflicting_alias_reject(self):
        c=self.closure()
        with self.assertRaisesRegex(ValueError,'checksum'):PortableClosure(self.path,'0'*64,self.root)
        with self.assertRaisesRegex(ValueError,'ambiguous'):
            self.closure([{'reference':'a','path':str(self.local.relative_to(self.root)),'sha256':self.expected},{'reference':'b','path':str(self.local.relative_to(self.root)),'sha256':'f'*64}])

    def test_production_corpus_cannot_fall_back_to_existing_original(self):
        from righelt_training.production import corpus_record
        raw=json.dumps({'schema':1,'kind':'production-starts-v1','heldOut':[],'positions':[]}).encode()
        self.local.write_bytes(raw);self.outside.write_bytes(raw);self.expected=hashlib.sha256(raw).hexdigest()
        self.closure()
        from unittest.mock import patch
        import os
        env={'RIGHELT_PORTABLE_CLOSURE_PATH':str(self.path),'RIGHELT_PORTABLE_CLOSURE_SHA256':hashlib.sha256(self.path.read_bytes()).hexdigest(),'RIGHELT_PORTABLE_ROOT':str(self.root)}
        with patch.dict(os.environ,env):
            self.assertEqual(corpus_record({'path':str(self.outside),'sha256':self.expected})['positions'],[])
            self.local.unlink()
            with self.assertRaises(FileNotFoundError):corpus_record({'path':str(self.outside),'sha256':self.expected})

if __name__=='__main__':unittest.main()
