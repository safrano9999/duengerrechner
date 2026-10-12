import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { pathToFileURL } from 'node:url';
import { createApi } from './api.mjs';
import { sqliteStore } from './node-store.mjs';
import { settings } from './settings.mjs';
export function startApi(config) {
  const store = sqliteStore(config.database);
  const api = createApi(store, config);
  const app = new Hono();
  app.all('/api', c => api.fetch(c.req.raw));
  app.all('/api/*', c => api.fetch(c.req.raw));
  app.all('/graphql', c => api.fetch(c.req.raw));
  app.get('/health', c => api.fetch(c.req.raw));
  app.get('/backend.json', c => c.json({ api_url: config.PUBLIC_API_URL || '/api', mcp_url: config.PUBLIC_MCP_URL || `http://127.0.0.1:${config.mcpPort}/mcp` }));
  // Static allowlist: never serve configuration, credentials, source or SQLite files.
  for (const path of ['/js/*', '/css/*', '/assets/*']) app.use(path, serveStatic({ root: './' }));
  app.get('/', serveStatic({ path: './index.html' }));
  const server = serve({ fetch: app.fetch, hostname: config.apiHost, port: config.apiPort });
  return { server, store, app };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = settings(); const { server, store } = startApi(config);
  console.error(`API listening on ${config.apiHost}:${config.apiPort}`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => { store.close(); process.exit(0); }));
}
