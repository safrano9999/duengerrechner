#!/usr/bin/env python3
"""Idempotently create the private R2 destination and Duengerrechner HTTP Logpush job."""
import json
from urllib.parse import urlencode

from log_sync import Cloudflare, FIELDS, config, settings, logpush_base


def job_options(cfg):
    host_rules = [{'key': 'ClientRequestHost', 'operator': 'eq', 'value': host} for host in cfg['hosts']]
    return {
        'name': cfg['job_name'], 'dataset': 'http_requests', 'enabled': True,
        'filter': json.dumps({'where': {'and': [
            host_rules[0] if len(host_rules) == 1 else {'or': host_rules},
            {'key': 'ClientRequestSource', 'operator': 'eq', 'value': 'eyeball'},
        ]}}, separators=(',', ':')),
        'output_options': {'field_names': FIELDS, 'timestamp_format': 'rfc3339ns', 'sample_rate': 1},
        'max_upload_bytes': 5_000_000,
        'max_upload_interval_seconds': 60,
    }


def destination_path(cfg):
    return f"r2://{cfg['bucket']}/{cfg['prefix']}/{{DATE}}"


def check_existing(job, cfg):
    path = job.get('destination_conf', '').split('?', 1)[0]
    if job.get('dataset') != 'http_requests' or path != destination_path(cfg):
        raise ValueError('Named Logpush job belongs to another destination; refusing takeover')


def setup(values=None, cfg=None, client=None):
    values = settings() if values is None else values
    cfg = config() if cfg is None else cfg
    remote = client or Cloudflare(values)
    try:
        base = logpush_base(remote, cfg)
        jobs_path = base + '/jobs'
        jobs = remote.json('GET', jobs_path)['result']
        matching = [j for j in jobs if j.get('name') == cfg['job_name']]
        if len(matching) > 1:
            raise ValueError('Duplicate named Logpush jobs require review')
        existing = matching[0] if matching else None
        if existing:
            check_existing(existing, cfg)
        available = remote.json('GET', base + '/datasets/http_requests/fields')['result']
        if any(field not in available for field in FIELDS):
            raise ValueError('HTTP Requests dataset is missing required log fields')
        bucket_path = f"/accounts/{remote.account}/r2/buckets/{cfg['bucket']}"
        found = remote.request('GET', bucket_path, allow404=True)
        if found.status_code == 404:
            remote.json('POST', f'/accounts/{remote.account}/r2/buckets', json={'name': cfg['bucket']})
        # Buckets are private by default. Never enable r2.dev or attach a domain.
        desired = job_options(cfg)
        if existing:
            changed = {}
            for key, value in desired.items():
                old = existing.get(key)
                if key == 'filter':
                    equal = json.loads(old or '{}') == json.loads(value)
                elif key == 'output_options':
                    equal = (set((old or {}).get('field_names', [])) == set(FIELDS)
                             and (old or {}).get('timestamp_format') == 'rfc3339ns'
                             and (old or {}).get('sample_rate', 1) == 1)
                else:
                    equal = old == value
                if not equal:
                    changed[key] = value
            if changed:
                remote.json('PUT', jobs_path + '/' + str(existing['id']), json=changed)
            return {'status': 'updated' if changed else 'unchanged', 'job_id': existing['id'], 'bucket': cfg['bucket']}
        required = ('R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')
        if any(not values.get(key) for key in required):
            raise ValueError('Private bucket is ready; set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (bucket-scoped Object Read & Write)')
        desired['destination_conf'] = destination_path(cfg) + '?' + urlencode({
            'account-id': remote.account, 'access-key-id': values['R2_ACCESS_KEY_ID'],
            'secret-access-key': values['R2_SECRET_ACCESS_KEY'],
        })
        created = remote.json('POST', jobs_path, json=desired)['result']
        return {'status': 'created', 'job_id': created['id'], 'bucket': cfg['bucket']}
    finally:
        if client is None:
            remote.close()


if __name__ == '__main__':
    try:
        print(json.dumps(setup()))
    except (ValueError, RuntimeError) as exc:
        # Our explicit errors contain no Cloudflare response body or destination.
        print(str(exc))
        raise SystemExit(1)
