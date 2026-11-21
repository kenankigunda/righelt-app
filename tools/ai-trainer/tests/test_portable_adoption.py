"""Synthetic adoption bytes only. Native model restoration is a separate proof."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from righelt_training.exploration_adoption import read_binding
from righelt_training.training_recipe import recipe_binding


def sha(raw):return hashlib.sha256(raw).hexdigest()


class PortableAdoptionTest(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.base=Path(temporary.name).resolve();self.root=self.base/'empty-root';self.root.mkdir()
        self.original=self.base/'old-mac'/'allocation'/'recipe-adoption.json';self.original.parent.mkdir(parents=True)
        self.value={'schema':1,'kind':'screen-selection-v1','allocation':str(self.original.parent),
                    'allocationId':'retained-allocation','sequenceId':'retained-sequence','trainingRecipe':recipe_binding()}
        self.raw=json.dumps(self.value,sort_keys=True).encode();self.binding={'path':str(self.original),'sha256':sha(self.raw)}
        self.staged=self.root/'.ai-runs'/'inputs'/'recipe-adoption.json';self.staged.parent.mkdir(parents=True)
        self.staged.write_bytes(self.raw);self.original.write_bytes(self.raw)

    def environment(self,*,alias=None,raw=None):
        if raw is not None:self.staged.write_bytes(raw)
        entry={'reference':str(self.original) if alias is None else alias,
               'path':str(self.staged.relative_to(self.root)),'sha256':self.binding['sha256']}
        closure=self.root/'.ai-runs'/'inputs'/'closure.json'
        closure.write_text(json.dumps({'schema':1,'entries':[entry]}))
        return patch.dict(os.environ,{'RIGHELT_HOSTED':'1','RIGHELT_PORTABLE_ROOT':str(self.root),
            'RIGHELT_PORTABLE_CLOSURE_PATH':str(closure),'RIGHELT_PORTABLE_CLOSURE_SHA256':sha(closure.read_bytes())})

    def test_native_reader_uses_staged_exact_bytes_and_preserves_original_identity(self):
        self.original.write_text('old Mac file must not be read')
        with self.environment():self.assertEqual(read_binding(self.binding),self.value)

    def test_existing_original_does_not_mask_missing_alias_file_or_bad_hash(self):
        with self.environment(alias='/unrelated/recipe-adoption.json'):
            with self.assertRaises(ValueError):read_binding(self.binding)
        with self.environment():
            self.staged.unlink()
            with self.assertRaises(FileNotFoundError):read_binding(self.binding)
        with self.environment(raw=b'corrupt'):
            with self.assertRaises(ValueError):read_binding(self.binding)

    def test_logical_allocation_and_binding_path_are_not_rewritten_to_staging(self):
        changed={**self.value,'allocation':'/different/allocation'};raw=json.dumps(changed).encode()
        self.binding['sha256']=sha(raw)
        with self.environment(raw=raw):
            with self.assertRaisesRegex(ValueError,'adoption identity'):read_binding(self.binding)
        with self.assertRaises(ValueError):read_binding({'path':'relative/recipe-adoption.json','sha256':sha(raw)})

    def test_nonportable_local_binding_remains_compatible(self):
        with patch.dict(os.environ,{},clear=True):self.assertEqual(read_binding(self.binding),self.value)


if __name__=='__main__':unittest.main()
