import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from righelt_training.config import CONFIG_SHA256, CONFIG_PATH
from righelt_training.manifest import build_manifest, write_manifest, amend_manifest, manifest_hashes
from righelt_training.resource_policy import POLICY_ID, POLICY_SHA256, LIMITS, manifest_fields


class ResourcePolicyTest(unittest.TestCase):
    def test_new_manifest_binds_policy_without_changing_checkpoint_configuration(self):
        # External historical contract: checkpoint942 depends on these bytes.
        self.assertEqual(CONFIG_SHA256,'f433dd71f410c451fd6523946b224df710919be5008abe507cbc80aca97a374d')
        before=CONFIG_PATH.read_bytes()
        with patch('righelt_training.manifest.subprocess.check_output',side_effect=['','current\n','locked==1\n']), \
                patch('righelt_training.manifest.platform.platform',return_value='fixture-host'):
            result=build_manifest(107,'initial')
        self.assertEqual(result['configSha256'],CONFIG_SHA256)
        self.assertEqual(result['seconds'],21600)
        self.assertEqual(result['resourcePolicy'],'adaptive-headroom-v2')
        self.assertEqual(result['resourceLimits']['maxWorkers'],4)
        self.assertEqual(result['resourceLimits']['maxMemoryGiB'],24)
        expected=hashlib.sha256(json.dumps({'id':POLICY_ID,'limits':dict(LIMITS)},sort_keys=True,allow_nan=False).encode()).hexdigest()
        self.assertEqual(result['resourcePolicySha256'],expected)
        self.assertEqual(CONFIG_PATH.read_bytes(),before)

    def test_operational_amendment_preserves_original_and_requires_review(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            original={'sourceRevision':'old','configSha256':CONFIG_SHA256,'seed':107,
                      'stage':'initial','seconds':21600,'resourcePolicy':'adaptive-v1'}
            old_digest=write_manifest(root/'manifest.json',original)
            old_bytes=(root/'manifest.json').read_bytes()
            current={**original,'sourceRevision':'new',**manifest_fields()}
            repair={'cause':'preserve host headroom','regressionEvidence':'resource and process tests',
                    'reviewEvidence':'independent review','artifactDisposition':'model config unchanged'}
            with self.assertRaisesRegex(ValueError,'reviewEvidence'):
                amend_manifest(root,current,{**repair,'reviewEvidence':None})
            updated=amend_manifest(root,current,repair)
            self.assertEqual(updated['manifest']['resourcePolicySha256'],POLICY_SHA256)
            self.assertEqual((root/'manifest.json').read_bytes(),old_bytes)
            self.assertEqual(manifest_hashes(root),{old_digest,updated['sha256']})

    def test_runner_rejects_old_peak_worker_permit(self):
        from righelt_training.runner import Runner
        with tempfile.TemporaryDirectory() as d:
            runner=Runner.__new__(Runner);runner.directory=Path(d)
            allocation=runner.directory/'allocation.json'
            for workers in (5,8,True):
                allocation.write_text(json.dumps({'workers':workers,'paused':False}))
                with self.assertRaisesRegex(ValueError,'invalid allocation'):runner.allocation()
            allocation.write_text(json.dumps({'workers':4,'paused':False}))
            self.assertEqual(runner.allocation()['workers'],4)
