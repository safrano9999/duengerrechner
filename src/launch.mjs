import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { settings } from './settings.mjs';
import { startApi } from './node-api.mjs';
import { mcpApp } from './mcp-http.mjs';
import { restClient } from './mcp.mjs';
const config = settings();
const { server: api, store } = startApi(config);
let gateway;
if (config.container) {
  // Supergateway is supplied by the pinned base image; never install or download it at startup.
  gateway = spawn('supergateway', ['--stdio', 'node /opt/duengerrechner/src/mcp-stdio.mjs',
    '--outputTransport', 'streamableHttp', '--port', '8001',
    '--streamableHttpPath', '/mcp', '--logLevel', 'none'], {
    stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, API_URL: 'http://127.0.0.1:8080/api',
      NODE_OPTIONS: '--import=/opt/duengerrechner/scripts/gateway-loopback.mjs' },
  });
}
const mcp = serve({ fetch: mcpApp(restClient(config.apiUrl, config.API_BEARER_TOKEN), config,
  config.container ? 'http://127.0.0.1:8001/mcp' : undefined).fetch, hostname: config.mcpHost, port: config.mcpPort });
console.error(`API: ${config.apiHost}:${config.apiPort}; MCP: ${config.mcpHost}:${config.mcpPort}`);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  gateway?.kill('SIGTERM');
  api.close(); mcp.close();
  setTimeout(() => { gateway?.kill('SIGKILL'); store.close(); process.exit(code); }, 1000);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const server of [api, mcp]) server.on('error', e => { console.error(e.message); stop(1); });
gateway?.on('error', e => { console.error(e.message); stop(1); });
gateway?.on('exit', () => { if (!stopping) stop(1); });
