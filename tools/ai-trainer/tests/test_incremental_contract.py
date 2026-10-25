import datetime
import unittest
from righelt_training.incremental import checked_contract


class IncrementalContractTest(unittest.TestCase):
    def value(self):
        start=datetime.datetime(2026,10,25,9,33,7,tzinfo=datetime.timezone.utc)
        return {'schema':1,'kind':'incremental-production-v1','id':'round-20261025','seed':107,
                'startedAt':start.isoformat(),'deadline':(start+datetime.timedelta(hours=12)).isoformat(),
                'humanAuthority':'Implement plan;12h end-to-end','semanticApproval':'d7f84a8'}

    def test_fixed_deadline_includes_setup_and_stopped_time(self):
        value=self.value();start=datetime.datetime.fromisoformat(value['startedAt']).timestamp()
        self.assertEqual(checked_contract(value,now=start+3600),(start,start+43200))
        with self.assertRaisesRegex(ValueError,'deadline'):
            checked_contract(value,now=start+43200)
        value['deadline']=(datetime.datetime.fromisoformat(value['deadline'])+datetime.timedelta(seconds=1)).isoformat()
        with self.assertRaisesRegex(ValueError,'deadline'):
            checked_contract(value,now=start+1)

    def test_authority_required(self):
        value=self.value();value['semanticApproval']=''
        with self.assertRaisesRegex(ValueError,'authorization'):
            checked_contract(value,now=datetime.datetime.fromisoformat(value['startedAt']).timestamp()+1)
