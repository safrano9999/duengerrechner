#!/usr/bin/env python3
"""FastAPI HTTP entrypoint; the original JavaScript performs every calculation."""
import asyncio
import contextlib
import os
from pathlib import Path
import shutil
import signal
import socket

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import Response

ROOT = Path(__file__).resolve().parent.parent

def read_config(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            key, value = line.split('=', 1)
            value = value.strip().strip('\"\'')
            values[key.strip()] = '' if value in ('blank', 'null') else value
    return values

config = {**read_config(ROOT / os.environ.get('CONFIG_FILE', 'config.conf')),
          **read_config(ROOT / os.environ.get('ENV_FILE', '.env')), **os.environ}
HOST = config.get('API_HOST') or '127.0.0.1'
PORT = int(config.get('API_PORT') or 8080)
if not 1 <= PORT <= 65535:
    raise ValueError('Invalid API_PORT')

@contextlib.asynccontextmanager
async def lifespan(app):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        backend_port = sock.getsockname()[1]
    local_host = '[::1]' if ':' in HOST else ('127.0.0.1' if HOST == '0.0.0.0' else HOST)
    env = {**config, 'API_HOST': '127.0.0.1', 'API_PORT': str(backend_port),
           'API_URL': f'http://{local_host}:{PORT}/api', 'CONTAINER_MODE': '0'}
    proc = await asyncio.create_subprocess_exec(shutil.which('node') or 'node', 'src/launch.mjs', cwd=ROOT, env=env)
    app.state.client = httpx.AsyncClient(base_url=f'http://127.0.0.1:{backend_port}', timeout=30, trust_env=False)
    async def watch():
        await proc.wait()
        os.kill(os.getpid(), signal.SIGTERM)
    watcher = None
    try:
        for _ in range(100):
            if proc.returncode is not None:
                raise RuntimeError('JavaScript backend exited during startup')
            try:
                response = await app.state.client.get('/health')
                if response.is_success:
                    break
            except httpx.ConnectError:
                pass
            await asyncio.sleep(0.1)
        else:
            raise RuntimeError('JavaScript backend did not become ready')
        watcher = asyncio.create_task(watch())
        yield
    finally:
        if watcher:
            watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await watcher
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
        await app.state.client.aclose()

app = FastAPI(title='Düngerrechner', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length'}

@app.api_route('/{path:path}', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'])
async def proxy(path: str, request: Request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 256 * 1024:
            return Response('Request body too large', status_code=413)
    # Preserve the public Host for same-origin validation in the shared API.
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP}
    response = await app.state.client.request(request.method, '/' + path,
        params=request.query_params.multi_items(), headers=headers, content=bytes(data))
    return Response(response.content, response.status_code,
                    headers={k: v for k, v in response.headers.items() if k.lower() not in HOP | {'content-encoding'}})

if __name__ == '__main__':
    uvicorn.run(app, host=HOST, port=PORT)
