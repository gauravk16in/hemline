"""Bounded Lambda scheduler. No patient/model/database credentials leave Vercel."""
import hmac
import json
import os
import time
import urllib.request
import boto3


def api(path, body):
    request = urllib.request.Request(
        os.environ['APP_BASE_URL'].rstrip('/') + '/api/internal/' + path,
        data=json.dumps(body).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + os.environ['WORKER_SECRET'],
                 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=110) as response:
        return json.load(response)


def enqueue(context, payload):
    boto3.client('lambda', region_name='us-east-1').invoke(
        FunctionName=context.invoked_function_arn, InvocationType='Event',
        Payload=json.dumps(payload).encode())


def lambda_handler(event, context):
    if 'requestContext' in event:
        supplied = (event.get('headers') or {}).get('authorization', '')
        expected = 'Bearer ' + os.environ['WORKER_SECRET']
        if not hmac.compare_digest(supplied, expected):
            return {'statusCode': 403, 'body': 'Forbidden'}
        if event['requestContext'].get('http', {}).get('method') != 'POST':
            return {'statusCode': 405, 'body': 'POST required'}
        admission = api('scheduler/start', {})
        if admission.get('token'):
            enqueue(context, {'token': admission['token'], 'generation': 0,
                              'deadline': time.time() + 7200})
        return {'statusCode': 202, 'body': json.dumps({'accepted': True})}
    token = event.get('token')
    generation = event.get('generation', 99)
    deadline = event.get('deadline', 0)
    if not token or not isinstance(generation, int) or generation >= 12 or time.time() >= deadline:
        return {'stopped': 'bounded session ended'}
    owner = context.aws_request_id
    while context.get_remaining_time_in_millis() > 125000 and time.time() < deadline:
        lease = api('scheduler/lease', {'token': token, 'owner': owner})
        if not lease.get('owned'):
            return {'stopped': 'lease superseded'}
        result = api('tick', {'schedulerToken': token, 'schedulerOwner': owner})
        if not result.get('moreWork'):
            api('scheduler/stop', {'token': token, 'owner': owner})
            return {'stopped': 'idle'}
        time.sleep(1)
    if generation < 11 and time.time() < deadline:
        # Retain session admission, release this owner, then enqueue. If enqueue
        # fails, Lambda's bounded async retry can reacquire the same session.
        api('scheduler/handoff', {'token': token, 'owner': owner})
        enqueue(context, {'token': token, 'generation': generation + 1, 'deadline': deadline})
    else:
        api('scheduler/stop', {'token': token, 'owner': owner})
    return {'stopped': 'slice finished'}
