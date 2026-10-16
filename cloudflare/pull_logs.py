#!/usr/bin/env python3
"""Import the last 24h, deduplicate, then publish a separate GoAccess report."""
from collections import Counter
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import subprocess

from log_sync import BASE, SyncError, sync

REPORT = Path.home() / '.local/share/litellm-free-goaccess/report/duengerrechner'
LOG_FORMAT = '{"ts":"%x.%^","request":{"client_ip":"%h","proto":"%H","method":"%m","host":"%v","uri":"%U"},"user_agent":"%u","referer":"%R","duration":"%T","size":"%b","status":"%s"}'


def atomic(path, content):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(content)
    tmp.chmod(0o644)
    tmp.replace(path)


def summarize(path, now):
    totals, recent, routes = Counter(), Counter(), Counter()
    last = None
    with path.open() as source:
        for line in source:
            event = json.loads(line)
            uri = event['request']['uri']
            kind = ('mcp' if uri == '/mcp' else 'api' if uri == '/api' or uri.startswith('/api/')
                    or uri == '/graphql' else 'web')
            totals[kind] += 1
            if now - 86400 <= event['ts'] < now:
                recent[kind] += 1
            routes[(kind, event['request']['method'], uri, event['status'])] += 1
            last = max(last or event['ts'], event['ts'])
    return {'total': dict(totals), 'last_24h': dict(recent), 'latest_event': last,
            'routes': [{'kind': k, 'method': m, 'path': p, 'status': s, 'requests': n}
                       for (k, m, p, s), n in routes.most_common()]}


def render(result):
    REPORT.mkdir(parents=True, exist_ok=True)
    journal = BASE / 'logs/access-cloudflare.json'
    summary = summarize(journal, datetime.now(timezone.utc).timestamp())
    summary.update({'generated_at': datetime.now(timezone.utc).isoformat(), 'pull': result})
    if sum(summary['total'].values()):
        # Use the already running GoAccess binary, with no global F24 config or
        # shared persistent database. Stream the journal in: no new bind mount.
        with journal.open('rb') as source:
            run = subprocess.run([
                '/usr/bin/podman', 'exec', '-i', 'litellm-free-goaccess', 'goaccess',
                '--no-global-config', '--no-progress', '--no-term-resolver',
                '--log-file=-', '--date-format=%s', '--time-format=%s',
                '--log-format=' + LOG_FORMAT, '--no-query-string', '--agent-list', '--http-method',
                '--geoip-database=/geoip/dbip-country-lite.mmdb',
                '--html-report-title=Düngerrechner — MCP & API',
                '--html-custom-js=/duengerrechner/navigation.js',
                '--output=/var/www/goaccess/duengerrechner/next.html',
            ], stdin=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=240)
        if run.returncode:
            raise SyncError('GoAccess report generation failed; previous report retained')
        (REPORT / 'next.html').chmod(0o644)
        (REPORT / 'next.html').replace(REPORT / 'index.html')
    else:
        atomic(REPORT / 'index.html', '<!doctype html><html lang="de"><meta charset="utf-8">'
               '<title>Düngerrechner — MCP &amp; API</title><h1>Düngerrechner</h1>'
               '<p>Log-Abruf eingerichtet. Noch keine MCP- oder API-Requests erfasst.</p>'
               '<p><a href="/">Zur GoAccess-Übersicht</a></p></html>')
    atomic(REPORT / 'navigation.js', "window.addEventListener('load',()=>{const p=document.createElement('p');"
           "p.style.cssText='padding:12px;text-align:center';const a=document.createElement('a');"
           "a.href='/';a.textContent='← F24 SALES / GoAccess-Übersicht';p.append(a);"
           "const info=document.createElement('p');info.textContent='Eigener Cloudflare-Trafficbericht · MCP und API nach HTTP-Methode und Pfad · Abruf um 01:10 und 13:10 UTC, jeweils letzte 24 Stunden.';"
           "p.append(info);document.body.prepend(p);});\n")
    atomic(REPORT / 'summary.json', json.dumps(summary, ensure_ascii=True) + '\n')
    return summary


def main():
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (BASE / 'pull.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            result = sync()
            render(result)
            print(json.dumps(result))
            return 0
        except Exception as exc:
            print(json.dumps({'status': 'failed', 'error_type': type(exc).__name__,
                              **({'message': str(exc)} if isinstance(exc, SyncError) else {})}))
            return 1


if __name__ == '__main__':
    raise SystemExit(main())
