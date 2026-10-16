#!/usr/bin/env python3
"""Import only the last 24 hours of private R2 HTTP logs into GoAccess JSON."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import fcntl
import gzip
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import time
from urllib.parse import quote

from dotenv import dotenv_values
import httpx

HERE = Path(__file__).resolve().parent
BASE = Path.home() / '.local/share/duengerrechner-goaccess'
WINDOW = timedelta(hours=24)  # Deliberately not configurable: never backfill older traffic.
MAX_LINE = 1024 * 1024
MAX_OBJECT = 256 * 1024 * 1024


class SyncError(RuntimeError):
    """Safe operational message with no remote payload or credentials."""


FIELDS = [
    'RayID', 'EdgeStartTimestamp', 'EdgeEndTimestamp', 'ClientIP',
    'ClientRequestHost', 'ClientRequestMethod', 'ClientRequestPath',
    'ClientRequestProtocol', 'ClientRequestReferer', 'ClientRequestUserAgent',
    'ClientRequestSource', 'EdgeResponseStatus', 'EdgeResponseBytes',
    'EdgeResponseBodyBytes', 'CacheCacheStatus', 'ClientCountry', 'ClientASN',
]


def settings():
    return {**dotenv_values(HERE / '.env', interpolate=False), **os.environ}


def config():
    value = json.loads((HERE / 'log_config.json').read_text())
    if value.get('scope', 'zone') not in ('zone', 'account'):
        raise ValueError('Logpush scope must be zone or account')
    allowed = {'duengerrechner.safrano9999.workers.dev'}
    if not value['hosts'] or len(set(value['hosts'])) != len(value['hosts']) or not set(value['hosts']) <= allowed:
        raise ValueError('Log import is restricted to the Duengerrechner Worker')
    for host, since in value.get('host_since', {}).items():
        if host not in value['hosts']:
            raise ValueError('Log cutover timestamp belongs to an unconfigured host')
        timestamp(since)
    for key in ('bucket', 'prefix', 'job_name'):
        if not value.get(key) or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in value[key]):
            raise ValueError(f'Invalid log configuration: {key}')
    return value


def logpush_base(client, cfg):
    scope = cfg.get('scope', 'zone')
    if scope == 'account':
        return f'/accounts/{client.account}/logpush'
    if scope == 'zone':
        return f'/zones/{client.zone}/logpush'
    raise ValueError('Logpush scope must be zone or account')


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Expected an RFC3339 log timestamp')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Log timestamp requires a timezone')
    return result.astimezone(timezone.utc)


def without_query(value):
    return str(value or '').split('?', 1)[0].split('#', 1)[0]


def normalize(raw, hosts, start, end, host_since=None):
    """None means deliberately outside scope/window, never an invalid record."""
    if not isinstance(raw, dict):
        raise ValueError('Expected an HTTP log object')
    when = timestamp(raw['EdgeStartTimestamp'])
    if not start <= when < end:
        return None
    host = str(raw['ClientRequestHost']).lower().rstrip('.')
    if host not in hosts or raw['ClientRequestSource'] != 'eyeball':
        return None
    if host_since and host in host_since and timestamp(raw['EdgeStartTimestamp']) < timestamp(host_since[host]):
        return None
    ray = str(raw['RayID']).lower()
    if not ray or ray == 'null':
        raise ValueError('HTTP log has no RayID')
    ip = str(ipaddress.ip_address(raw['ClientIP']))
    status = int(raw['EdgeResponseStatus'])
    if status != 0 and not 100 <= status <= 599:
        raise ValueError('Invalid HTTP response status')
    size = int(raw['EdgeResponseBodyBytes'])
    duration = (timestamp(raw['EdgeEndTimestamp']) - when).total_seconds()
    if size < 0 or duration < 0 or not math.isfinite(duration):
        raise ValueError('Invalid HTTP response size or duration')
    # Caddy already removes query strings and request/response headers. Keep that
    # privacy boundary, while retaining all selected Cloudflare fields for SEO.
    detail = {key: raw[key] for key in FIELDS if key in raw}
    detail['ClientRequestPath'] = without_query(raw['ClientRequestPath']) or '/'
    detail['ClientRequestReferer'] = without_query(raw.get('ClientRequestReferer'))
    event_id = hashlib.sha256((host + '\0' + ray + '\0' + when.isoformat()).encode()).hexdigest()
    return {
        'ts': when.timestamp(), 'source': 'cloudflare', 'event_id': event_id,
        'request': {'client_ip': ip, 'proto': str(raw['ClientRequestProtocol']).upper(),
                    'method': raw['ClientRequestMethod'], 'host': host,
                    'uri': detail['ClientRequestPath']},
        'user_agent': raw.get('ClientRequestUserAgent') or '-',
        'referer': detail['ClientRequestReferer'] or '-',
        'duration': duration, 'size': size, 'status': status, 'cloudflare': detail,
    }


class Cloudflare:
    """Small REST client; errors never print response bodies or credential URLs."""
    def __init__(self, values, client=None):
        for key in ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID'):
            if not values.get(key):
                raise ValueError(f'{key} is required')
        self.account = values['CLOUDFLARE_ACCOUNT_ID']
        self.zone = values['CLOUDFLARE_ZONE_ID']
        self.client = client or httpx.Client(
            base_url='https://api.cloudflare.com/client/v4',
            headers={'Authorization': 'Bearer ' + values['CLOUDFLARE_API_TOKEN']},
            timeout=httpx.Timeout(45, connect=10), follow_redirects=False)
        self.last_request = 0.0

    def close(self):
        self.client.close()

    def request(self, method, path, *, allow404=False, stream=False, **kwargs):
        for attempt in range(3):
            # Leave headroom under the global API rate limit; object receipts
            # mean overlapping 24h windows don't re-download completed objects.
            time.sleep(max(0, .3 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                r = self.client.send(self.client.build_request(method, path, **kwargs), stream=stream)
            except httpx.HTTPError:
                if attempt == 2 or method != 'GET':
                    raise SyncError('Cloudflare network request failed') from None
                time.sleep(2 ** attempt)
                continue
            if r.status_code == 404 and allow404:
                return r
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 2 and method == 'GET':
                delay = r.headers.get('Retry-After', '')
                r.close()
                time.sleep(min(30, float(delay)) if delay.isdigit() else 2 ** (attempt + 1))
                continue
            if not 200 <= r.status_code < 300:
                hint = ' (check Logs Write at the configured scope / Account R2 permissions)' if r.status_code == 403 else ''
                # Distinguish product activation from token rights without ever
                # echoing arbitrary API responses or credential-bearing URLs.
                if r.status_code == 403:
                    r.read()
                    try:
                        messages = [e.get('message') for e in r.json().get('errors', [])]
                    except ValueError:
                        messages = []
                    if 'logpush is not enabled for this account' in messages:
                        hint = ' (Logpush must be activated for this account in the Cloudflare dashboard)'
                    elif 'Please enable R2 through the Cloudflare Dashboard.' in messages:
                        hint = ' (R2 must be activated in the Cloudflare dashboard)'
                    elif any(isinstance(message, str) and 'exceeded max jobs allowed' in message for message in messages):
                        hint = ' (Cloudflare Logpush job limit reached; check dataset entitlement and existing jobs)'
                r.close()
                raise SyncError(f'Cloudflare API HTTP {r.status_code}{hint}')
            return r
        raise SyncError('Cloudflare request exhausted retries')

    def json(self, method, path, **kwargs):
        value = self.request(method, path, **kwargs).json()
        if not value.get('success'):
            raise SyncError('Cloudflare API reported failure')
        return value

    def check_job(self, cfg):
        from setup_logs import check_existing, job_options
        jobs = self.json('GET', logpush_base(self, cfg) + '/jobs')['result']
        matches = [j for j in jobs if j.get('name') == cfg['job_name']]
        if len(matches) != 1:
            raise SyncError('Expected one Logpush job; run setup_logs.py')
        job = matches[0]
        check_existing(job, cfg)
        options = job.get('output_options') or {}
        if (not job.get('enabled') or options.get('sample_rate', 1) != 1
                or not set(FIELDS).issubset(options.get('field_names', []))
                or options.get('timestamp_format') != 'rfc3339ns'
                or json.loads(job.get('filter') or '{}') != json.loads(job_options(cfg)['filter'])):
            raise SyncError('Logpush configuration drift; run setup_logs.py')
        if job.get('last_error') and (not job.get('last_complete')
                or timestamp(job['last_error']) > timestamp(job['last_complete'])):
            raise SyncError('Logpush reports a delivery error; inspect the Cloudflare dashboard')

    def objects(self, cfg, start, end):
        day = start.date()
        while day <= end.date():
            prefix = f"{cfg['prefix']}/{day.strftime('%Y%m%d')}/"
            cursor = None
            cursors = set()
            while True:
                params = {'prefix': prefix, 'per_page': 1000}
                if cursor:
                    params['cursor'] = cursor
                page = self.json('GET', f"/accounts/{self.account}/r2/buckets/{cfg['bucket']}/objects", params=params)
                for obj in page['result']:
                    if not obj['key'].startswith(prefix):
                        raise ValueError('R2 returned an object outside the requested prefix')
                    # Destination validation writes a gzip text probe, not JSON logs.
                    if obj['key'] == prefix + 'test.txt.gz':
                        continue
                    if start <= timestamp(obj['last_modified']) < end and obj['key'].endswith(('.gz', '.json', '.jsonl')):
                        yield obj
                info = page.get('result_info') or {}
                if not info.get('is_truncated'):
                    break
                cursor = info.get('cursor')
                if not cursor or cursor in cursors:
                    raise SyncError('Invalid R2 pagination cursor')
                cursors.add(cursor)
            day += timedelta(days=1)

    @contextmanager
    def records(self, cfg, obj):
        """Download one bounded gzip object. Temporary raw data is never published."""
        if obj['size'] > MAX_OBJECT:
            raise ValueError('R2 object exceeds the 256 MiB batch safety limit')
        path = f"/accounts/{self.account}/r2/buckets/{cfg['bucket']}/objects/{quote(obj['key'], safe='')}"
        response = self.request('GET', path, stream=True,
                                headers={'Accept-Encoding': 'identity',
                                         'If-Match': '"' + obj['etag'].strip('"') + '"'})
        with tempfile.TemporaryFile() as data:
            try:
                downloaded = 0
                for chunk in response.iter_raw():
                    downloaded += len(chunk)
                    if downloaded > MAX_OBJECT:
                        raise ValueError('R2 object exceeds the download limit')
                    data.write(chunk)
            finally:
                response.close()
            data.seek(0)
            zipped = data.read(2) == b'\x1f\x8b'
            data.seek(0)
            with gzip.GzipFile(fileobj=data) if zipped else _borrow(data) as source:
                def rows():
                    total = 0
                    while True:
                        line = source.readline(MAX_LINE + 1)
                        if not line:
                            break
                        total += len(line)
                        if len(line) > MAX_LINE or total > 1024 * 1024 * 1024:
                            raise ValueError('Logpush batch exceeds decoding limits')
                        if not line.endswith(b'\n'):
                            raise ValueError('Incomplete Logpush JSON line')
                        if line.strip():
                            yield json.loads(line)
                yield rows()


@contextmanager
def _borrow(value):
    yield value


class Journal:
    """Append-only JSON is authoritative; SQLite is a recoverable dedup index.

    fsync the log BEFORE committing its offset and object receipt. If interrupted,
    index complete lines beyond the old offset before accepting another batch.
    Never replace the log inode: GoAccess uses it for incremental restoration.
    """
    def __init__(self, log_path, state_dir):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.log_path = log_path
        self.file = log_path.open('a+b')
        self.db = sqlite3.connect(state_dir / 'logs.sqlite3')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), inode INTEGER, offset INTEGER);
            CREATE TABLE IF NOT EXISTS objects (key TEXT PRIMARY KEY, etag TEXT, modified TEXT);
        ''')
        self.recover()

    def close(self):
        self.db.close()
        self.file.close()

    def recover(self):
        stat = os.fstat(self.file.fileno())
        previous = self.db.execute('SELECT inode, offset FROM checkpoint WHERE id=1').fetchone()
        offset = previous[1] if previous else 0
        if previous and (previous[0] != stat.st_ino or stat.st_size < offset):
            raise ValueError('Cloudflare journal was replaced/truncated; refusing unsafe replay')
        self.file.seek(offset)
        with self.db:
            while True:
                start = self.file.tell()
                line = self.file.readline(MAX_LINE + 1)
                if not line:
                    break
                if len(line) > MAX_LINE:
                    raise ValueError('Journal line too large')
                if not line.endswith(b'\n'):
                    self.file.truncate(start)  # Only incomplete, uncommitted tail.
                    self.file.flush()
                    os.fsync(self.file.fileno())
                    break
                row = json.loads(line)
                self.db.execute('INSERT OR IGNORE INTO events VALUES (?)', (row['event_id'],))
            self._checkpoint()

    def _checkpoint(self):
        stat = os.fstat(self.file.fileno())
        self.db.execute('INSERT OR REPLACE INTO checkpoint VALUES (1,?,?)', (stat.st_ino, stat.st_size))

    def seen_object(self, obj):
        return self.db.execute('SELECT 1 FROM objects WHERE key=? AND etag=?', (obj['key'], obj['etag'])).fetchone() is not None

    def ingest(self, rows, obj, hosts, start, end, host_since=None):
        counts = {'added': 0, 'duplicate': 0, 'outside_window_or_scope': 0}
        # Stage the complete object first: bad JSON/gzip cannot publish half a batch.
        with tempfile.TemporaryFile() as stage:
            with self.db:
                for raw in rows:
                    record = normalize(raw, hosts, start, end, host_since)
                    if record is None:
                        counts['outside_window_or_scope'] += 1
                        continue
                    inserted = self.db.execute('INSERT OR IGNORE INTO events VALUES (?)', (record['event_id'],)).rowcount
                    if not inserted:
                        counts['duplicate'] += 1
                        continue
                    line = json.dumps(record, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode() + b'\n'
                    if len(line) > MAX_LINE:
                        raise ValueError('Normalized journal line too large')
                    stage.write(line)
                    counts['added'] += 1
                stage.seek(0)
                self.file.seek(0, os.SEEK_END)
                while chunk := stage.read(1024 * 1024):
                    self.file.write(chunk)
                self.file.flush()
                os.fsync(self.file.fileno())
                self._checkpoint()
                self.db.execute('INSERT OR REPLACE INTO objects VALUES (?,?,?)',
                                (obj['key'], obj['etag'], obj['last_modified']))
        return counts


def sync(*, values=None, cfg=None, now=None, base=BASE, remote=None):
    values = settings() if values is None else values
    cfg = config() if cfg is None else cfg
    end = now or datetime.now(timezone.utc)
    start = end - WINDOW
    state = base / 'cloudflare-state'
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    totals = {'status': 'ok', 'window_start': start.isoformat(), 'window_end': end.isoformat(),
              'downloaded_objects': 0, 'unchanged_objects': 0, 'added': 0, 'duplicate': 0,
              'outside_window_or_scope': 0}
    with (state / 'sync.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        client = remote or Cloudflare(values)
        journal = None
        try:
            # A missing/disabled job must not masquerade as a successful empty import.
            client.check_job(cfg)
            journal = Journal(base / 'logs/access-cloudflare.json', state)
            # Never broaden the requested window after an outage.
            for obj in client.objects(cfg, start, end):
                if journal.seen_object(obj):
                    totals['unchanged_objects'] += 1
                    continue
                with client.records(cfg, obj) as rows:
                    result = journal.ingest(rows, obj, cfg['hosts'], start, end, cfg.get('host_since'))
                totals['downloaded_objects'] += 1
                for key, value in result.items():
                    totals[key] += value
            with journal.db:
                journal.db.execute('DELETE FROM objects WHERE modified < ?', ((start - WINDOW).isoformat(),))
            receipt = state / 'last-success.json'
            temporary = receipt.with_suffix('.tmp')
            temporary.write_text(json.dumps(totals, indent=2) + '\n')
            temporary.replace(receipt)
        finally:
            if journal is not None:
                journal.close()
            if remote is None:
                client.close()
    return totals


if __name__ == '__main__':
    try:
        print(json.dumps(sync()))
    except Exception as exc:
        # Record contents, HTTP bodies and secret-bearing destination URLs must
        # never leak into journald on a parse/network failure.
        print(json.dumps({'status': 'failed', 'error_type': type(exc).__name__,
                          **({'message': str(exc)} if isinstance(exc, SyncError) else {})}))
        raise SystemExit(1)
