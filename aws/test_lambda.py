import importlib.util
import os
import sys
import types
import unittest
from unittest.mock import patch
sys.modules['boto3'] = types.SimpleNamespace(client=lambda *a, **k: None)
spec=importlib.util.spec_from_file_location('worker','aws/lambda_function.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
class Context:
    invoked_function_arn='arn:aws:lambda:us-east-1:123:function:hemline-worker'
    aws_request_id='invocation-1'
    def get_remaining_time_in_millis(self): return 900000
class Tests(unittest.TestCase):
    def setUp(self): os.environ['WORKER_SECRET']='test-only'
    def test_unauthorized_never_invokes(self):
        with patch.object(worker,'api') as api, patch.object(worker,'enqueue') as enqueue:
            r=worker.lambda_handler({'requestContext':{'http':{'method':'POST'}},'headers':{}},Context())
            self.assertEqual(r['statusCode'],403); api.assert_not_called(); enqueue.assert_not_called()
    def test_admitted_dispatch_is_async_and_bounded(self):
        with patch.object(worker,'api',return_value={'token':'test-token'}),patch.object(worker,'enqueue') as enqueue:
            r=worker.lambda_handler({'requestContext':{'http':{'method':'POST'}},'headers':{'authorization':'Bearer test-only'}},Context())
            self.assertEqual(r['statusCode'],202)
            self.assertEqual(enqueue.call_args.args[1]['generation'],0)
    def test_idle_stops_without_continuation(self):
        with patch.object(worker,'api',side_effect=[{'owned':True},{'moreWork':False},{'ok':True}]) as api,patch.object(worker,'enqueue') as enqueue:
            r=worker.lambda_handler({'token':'t','generation':0,'deadline':worker.time.time()+60},Context())
            self.assertEqual(r['stopped'],'idle'); enqueue.assert_not_called()
            self.assertEqual(api.call_args.args[0],'scheduler/stop')
    def test_expired_or_limit_never_calls_backend(self):
        with patch.object(worker,'api') as api:
            worker.lambda_handler({'token':'t','generation':12,'deadline':worker.time.time()+60},Context());api.assert_not_called()
    def test_stale_lease_never_ticks(self):
        with patch.object(worker,'api',return_value={'owned':False}) as api:
            worker.lambda_handler({'token':'t','generation':0,'deadline':worker.time.time()+60},Context())
            self.assertEqual(api.call_count,1)
    def test_handoff_retains_admission_for_next_slice(self):
        c=Context();c.get_remaining_time_in_millis=lambda:120000
        with patch.object(worker,'api') as api,patch.object(worker,'enqueue') as enqueue:
            worker.lambda_handler({'token':'t','generation':0,'deadline':worker.time.time()+60},c)
            self.assertEqual(enqueue.call_args.args[1]['generation'],1)
            self.assertEqual(api.call_args.args[0],'scheduler/handoff')
if __name__=='__main__': unittest.main()
