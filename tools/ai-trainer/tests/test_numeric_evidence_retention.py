import unittest
from unittest.mock import patch
from righelt_training.exploratory_window import numeric_verification
from righelt_training.export import NumericParityError


class NumericEvidenceRetentionTest(unittest.TestCase):
    def test_strict_default_raises_original_failure(self):
        failure=NumericParityError({'numericPassed':False,'evidence':'original'})
        with patch('righelt_training.export.numeric_parity',side_effect=failure):
            with self.assertRaises(NumericParityError) as caught:numeric_verification(None,None,None)
        self.assertIs(caught.exception,failure)
    def test_retaining_report_preserves_false_result_and_all_original_evidence(self):
        report={'numericPassed':False,'batches':[{'failed':True}]}
        with patch('righelt_training.export.numeric_parity',side_effect=NumericParityError(report)):
            observed=numeric_verification(None,None,None,retain_failure=True)
        self.assertIs(observed,report);self.assertIs(observed['numericPassed'],False)
    def test_other_errors_are_never_converted_to_evidence(self):
        with patch('righelt_training.export.numeric_parity',side_effect=RuntimeError('invalid ABI')):
            with self.assertRaisesRegex(RuntimeError,'invalid ABI'):
                numeric_verification(None,None,None,retain_failure=True)
