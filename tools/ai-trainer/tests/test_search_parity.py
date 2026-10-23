import unittest
from unittest.mock import patch
from righelt_training.search_parity import completed_search,repair_cache

class SearchParityTest(unittest.TestCase):
    def test_usable_deadline_result_is_not_completed_proof(self):
        self.assertFalse(completed_search({'status':'ready','stopped':'deadline'}))
        self.assertFalse(completed_search({'status':'failed'}))
        self.assertTrue(completed_search({'status':'ready','stopped':'complete'}))
    def test_repair_refuses_changed_model_or_duplicate_rows(self):
        current=dict(configSha256='config',referenceDevice='mps',modelSha256='model',corpusSha256='corpus',profile={'simulations':8},modelSeed=107)
        with self.assertRaisesRegex(ValueError,'identity mismatch'):
            repair_cache({**current,'modelSha256':'other','states':[]},current,'HEAD')
        with patch('righelt_training.search_parity.subprocess.run'):
            with self.assertRaisesRegex(ValueError,'duplicate'):
                repair_cache({**current,'states':[{'id':'same'},{'id':'same'}]},current,'HEAD')

if __name__=='__main__':unittest.main()
