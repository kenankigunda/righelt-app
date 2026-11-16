"""Bounded same-key transport faults, with invented remote state and no model."""
import hashlib
import json
import unittest
from unittest.mock import patch
from righelt_training import hosted_receipts as receipts


class HostedTransportTest(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(receipts.os.environ,{'RIGHELT_HOSTED':'1'},clear=True);self.env.start();self.addCleanup(self.env.stop)

    def test_uncertain_claim_queries_same_key_without_a_second_create(self):
        calls=[]
        def remote(action,payload=None,**kwargs):
            calls.append((action,payload))
            if len(calls)==1:raise receipts.HostedInfrastructureError('lost accepted claim response')
            return {'created':False,'record':{'generation':1}}
        with patch.object(receipts,'request',remote):result=receipts.evaluation_claim('public','job')
        self.assertFalse(result['created']);self.assertEqual(len(calls),2)
        self.assertEqual(calls[0][1]['key'],calls[1][1]['key']);self.assertTrue(calls[0][1]['allowCreate']);self.assertFalse(calls[1][1]['allowCreate'])

    def test_consumption_wrapper_never_runs_a_game_after_ambiguous_claim(self):
        from righelt_training.prospective_durability import consume_and_qualify
        import tempfile,time
        from unittest.mock import Mock
        remote=Mock(side_effect=[receipts.HostedInfrastructureError('lost'),{'created':False,'record':{'generation':1}}])
        player=Mock();verify=Mock()
        with tempfile.TemporaryDirectory() as directory,patch.object(receipts,'request',remote):
            record,_=consume_and_qualify(job={'id':'invented','purpose':'public-performance-timing'},base={'workId':'invented'},execution={'generation':1,'sourceRevision':'a'*40,'publicTiming':{}},namespace='public',directory=directory,deadline=time.monotonic()+100,barrier=receipts,play=player,verify=verify,start_verify=Mock(),model_versions={},profile_versions={})
        self.assertEqual(record['status'],'unfinished');self.assertEqual(record['reason'],'consumed-without-settlement')
        player.assert_not_called();verify.assert_not_called();self.assertEqual(remote.call_count,2)

    def test_uncertain_unobserved_claim_stops_instead_of_redispatch(self):
        with patch.object(receipts,'request',side_effect=[receipts.HostedInfrastructureError('lost'),{'created':False,'unclaimed':True}]) as remote:
            with self.assertRaises(receipts.HostedInfrastructureError):receipts.evaluation_claim('public','job')
            self.assertEqual(remote.call_count,2)

    def test_lost_settlement_response_reconciles_retained_identical_bytes(self):
        result={'status':'raw-complete','invented':True};raw=json.dumps(result,sort_keys=True,allow_nan=False).encode()
        descriptor={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)};calls=[]
        def remote(action,payload=None,**kwargs):
            calls.append((action,payload,kwargs))
            if action.startswith('objects/'):
                self.assertEqual(kwargs['raw'],raw);return descriptor
            if action=='settle':raise receipts.HostedInfrastructureError('lost accepted settle response')
            self.assertEqual(action,'claim');self.assertFalse(payload['allowCreate']);return {'created':False,'record':{'result':descriptor}}
        with patch.object(receipts,'request',remote):receipts.settle('public','job',result)
        self.assertEqual([c[0] for c in calls],['objects/'+descriptor['sha256'],'settle','claim'])
        self.assertEqual(calls[1][1]['key'],calls[2][1]['key'])

    def test_unsettled_owned_key_allows_only_one_identical_settlement_retry(self):
        calls=[];raw=json.dumps({'x':1},sort_keys=True).encode();descriptor={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        def remote(action,payload=None,**kwargs):
            calls.append((action,payload,kwargs))
            if action.startswith('objects/'):return descriptor
            if action=='claim':return {'created':False,'record':{'generation':1}}
            if sum(a=='settle' for a,_,_ in calls)==1:raise receipts.HostedInfrastructureError('lost')
            return {'settled':True}
        with patch.object(receipts,'request',remote):receipts.settle('public','job',{'x':1})
        settled=[c[1] for c in calls if c[0]=='settle'];self.assertEqual(len(settled),2);self.assertEqual(settled[0],settled[1])

    def test_hash_upload_retries_once_with_identical_bytes_but_contract_failures_never_retry(self):
        raw=b'public-prefix';descriptor={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        with patch.object(receipts,'request',side_effect=[receipts.HostedInfrastructureError('lost'),descriptor]) as remote:
            self.assertEqual(receipts._upload(raw),descriptor);self.assertEqual(remote.call_count,2)
            self.assertEqual(remote.call_args_list[0].args,remote.call_args_list[1].args)
            self.assertEqual(remote.call_args_list[0].kwargs['raw'],remote.call_args_list[1].kwargs['raw'])
        with patch.object(receipts,'request',side_effect=ValueError('auth fenced')) as remote:
            with self.assertRaises(ValueError):receipts.evaluation_claim('public','job')
            self.assertEqual(remote.call_count,1)
        with patch.object(receipts,'request',side_effect=receipts.HostedInfrastructureError('down')) as remote:
            with self.assertRaises(receipts.HostedInfrastructureError):receipts._safe_read('objects/'+'a'*64)
            self.assertEqual(remote.call_count,2)

    def test_pending_preflight_reads_only_metadata_without_create_or_game_objects(self):
        calls=[]
        def remote(action,payload=None,**kwargs):
            calls.append((action,payload));self.assertEqual(action,'claim');self.assertFalse(payload['allowCreate'])
            return {'created':False,'record':{'generation':1,'result':{'sha256':'a'*64,'bytes':999999}}}
        with patch.object(receipts,'request',remote):self.assertFalse(receipts.evaluation_pending('public',['one','two']))
        self.assertEqual(len(calls),2)
        with patch.object(receipts,'request',return_value={'created':False,'unclaimed':True}) as remote:
            self.assertTrue(receipts.evaluation_pending('public',['new','unused']));self.assertEqual(remote.call_count,1)

    def test_malformed_controller_json_is_a_contract_failure_not_transport_retry(self):
        import io
        with patch.dict(receipts.os.environ,{'COMPUTE_URL':'https://compute.example','COMPUTE_ID':'public','COMPUTE_WORKER_TOKEN':'private','COMPUTE_GENERATION':'1'}):
            with patch.object(receipts.urllib.request,'urlopen') as remote:
                remote.return_value.__enter__.return_value=io.BytesIO(b'not json')
                with self.assertRaisesRegex(ValueError,'response malformed'):receipts.evaluation_claim('public','job')
                self.assertEqual(remote.call_count,1)

    def test_first_party_transport_identity_preserves_auth_session_and_payloads(self):
        import io
        session='7'*32
        with patch.dict(receipts.os.environ,{'COMPUTE_URL':'https://compute.example','COMPUTE_ID':'public','COMPUTE_WORKER_TOKEN':'private','COMPUTE_GENERATION':'1','COMPUTE_STARTUP_SESSION':session}):
            calls=[]
            def transport(req,**kwargs):
                calls.append((req,kwargs))
                response=__import__('unittest.mock',fromlist=['MagicMock']).MagicMock()
                response.__enter__.return_value=io.BytesIO(b'{"created":false,"unclaimed":true}')
                return response
            with patch.object(receipts.urllib.request,'urlopen',transport):
                self.assertTrue(receipts.evaluation_pending('public',['job']))
                self.assertEqual(json.loads(calls[-1][0].data)['allowCreate'],False)
                receipts.request('objects/'+'a'*64,raw=b'exact bytes',method='PUT')
                self.assertEqual(calls[-1][0].data,b'exact bytes');self.assertEqual(calls[-1][0].get_method(),'PUT')
                self.assertEqual(receipts.request('status',method='GET'),b'{"created":false,"unclaimed":true}')
                self.assertEqual(calls[-1][0].get_method(),'GET');self.assertIsNone(calls[-1][0].data)
            self.assertEqual(len(calls),3)
            for req,options in calls:
                self.assertEqual(req.get_header('User-agent'),'Righelt-Hosted-Compute/1')
                self.assertEqual(req.get_header('Accept'),'application/json')
                self.assertEqual(req.get_header('Authorization'),'Bearer private')
                self.assertEqual(req.get_header('X-compute-generation'),'1')
                self.assertEqual(req.get_header('X-compute-startup-session'),session)
                self.assertEqual(options['timeout'],10)

    def test_http_contract_failure_preserves_only_status_and_never_retries(self):
        import io,urllib.error
        with patch.dict(receipts.os.environ,{'COMPUTE_URL':'https://compute.example','COMPUTE_ID':'public','COMPUTE_WORKER_TOKEN':'private','COMPUTE_GENERATION':'1'}):
            error=urllib.error.HTTPError('https://private.example',409,'secret response',{},io.BytesIO(b'secret body'))
            with patch.object(receipts.urllib.request,'urlopen',side_effect=error) as remote:
                with self.assertRaises(receipts.HostedContractError) as raised:receipts.evaluation_pending('public',['job'])
                self.assertEqual(raised.exception.http_status,409);self.assertNotIn('secret',str(raised.exception));self.assertEqual(remote.call_count,1)

    def test_changed_settled_hash_is_correctness_failure_without_write_retry(self):
        raw=b'{"x": 1}';descriptor={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        with patch.object(receipts,'request',side_effect=[descriptor,receipts.HostedInfrastructureError('lost'),{'record':{'result':{'sha256':'f'*64,'bytes':len(raw)}}}]) as remote:
            with self.assertRaises(ValueError):receipts.settle('public','job',{'x':1})
            self.assertEqual(remote.call_count,3)

if __name__=='__main__':unittest.main()
