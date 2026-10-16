"""Offline regression checks for the shared F24-style log import behavior."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cloudflare'))
import log_sync as logs
from pull_logs import summarize

END = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)
START = END - timedelta(hours=24)
HOST = 'duengerrechner.safrano9999.workers.dev'


def record(ray='one', when=START, path='/mcp'):
    return {'RayID': ray, 'EdgeStartTimestamp': when.isoformat(),
            'EdgeEndTimestamp': (when + timedelta(milliseconds=10)).isoformat(),
            'ClientIP': '192.0.2.1', 'ClientRequestHost': HOST,
            'ClientRequestMethod': 'POST', 'ClientRequestPath': path,
            'ClientRequestProtocol': 'HTTP/2', 'ClientRequestReferer': '',
            'ClientRequestUserAgent': 'LogImportTest', 'ClientRequestSource': 'eyeball',
            'EdgeResponseStatus': 200, 'EdgeResponseBodyBytes': 100}


def test_exact_24h_window_and_host():
    assert logs.normalize(record(), [HOST], START, END)
    assert logs.normalize(record(when=START-timedelta(microseconds=1)), [HOST], START, END) is None
    assert logs.normalize(record(when=END), [HOST], START, END) is None
    assert logs.normalize(record(), ['www.f24-sales.com'], START, END) is None


def test_overlap_recovery_and_report_categories(tmp_path):
    path = tmp_path / 'logs/access-cloudflare.json'
    state = tmp_path / 'state'
    obj = {'key': 'one.gz', 'etag': 'a', 'last_modified': END.isoformat()}
    journal = logs.Journal(path, state)
    assert journal.ingest([record()], obj, [HOST], START, END)['added'] == 1
    journal.close()
    # A lost dedup DB must rebuild from the append-only journal.
    (state / 'logs.sqlite3').unlink()
    journal = logs.Journal(path, state)
    result = journal.ingest([record(), record('two', path='/api/calculate?token=private')],
                            {**obj, 'key': 'two.gz'}, [HOST], START, END)
    journal.close()
    assert result['duplicate'] == 1
    assert result['added'] == 1
    assert 'private' not in path.read_text()
    summary = summarize(path, END.timestamp())
    assert summary['total'] == {'mcp': 1, 'api': 1}
    assert summary['last_24h'] == summary['total']


def test_secret_headers_and_payloads_never_exported():
    value = record()
    value.update(RequestHeaders={'Authorization': 'private'}, RequestBody='private')
    assert 'private' not in str(logs.normalize(value, [HOST], START, END))
