import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { html } from 'hono/html';
import { authorized, tokenValue } from './auth.mjs';
import { createMcpHttpHandler } from './mcp.mjs';
export function mcpApp(call, config = {}, gateway) {
  const app = new Hono();
  const handler = gateway ? null : createMcpHttpHandler(call);
  const token = tokenValue(config.MCP_BEARER_TOKEN);
  const origins = (config.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  app.use('*', cors({ origin: origin => origins.includes(origin) ? origin : '', allowHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'MCP-Session-Id', 'Mcp-Method', 'Mcp-Name'], exposeHeaders: ['MCP-Session-Id'], allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }));
  app.get('/health', c => c.json({ status: 'ok', service: 'duengerrechner-mcp' }));
  app.all('/mcp', async c => {
    if (!await authorized(c.req.raw, token)) return c.json({ error: 'Bearer token required' }, 401, { 'WWW-Authenticate': 'Bearer' });
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin && !origins.includes(origin)) return c.json({ error: 'Origin not allowed' }, 403);
    // Browser navigation gets help; MCP GET/SSE requests retain transport semantics.
    const accept = c.req.header('accept') ?? '';
    if (c.req.method === 'GET' && accept.includes('text/html') && !accept.includes('text/event-stream')) {
      const endpoint = new URL('/mcp', c.req.url).href;
      c.header('Cache-Control', 'no-store');
      return c.html(html`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Düngerrechner · MCP</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:36rem;margin:12vh auto;padding:1.5rem;line-height:1.6}h1{line-height:1.2}input{box-sizing:border-box;width:100%;padding:.8rem;font:inherit;border:1px solid #888;border-radius:.5rem}a{color:inherit}
</style></head><body><main><h1>Düngerrechner für deinen KI-Agenten</h1>
<p>Das ist der MCP-Anschluss des Düngerrechners. Gib diese URL deinem Agenten oder trage sie in deinem MCP-Client ein:</p>
<label for="endpoint">MCP-URL</label><input id="endpoint" type="url" readonly value="${endpoint}" aria-label="MCP-URL zum Kopieren">
<p>Verbindungstyp: <strong>Streamable HTTP</strong>.</p>
<p>Damit kann dein Agent Dünger suchen und Nährstoffmischungen berechnen.</p>
<p><a href="/">Zum Düngerrechner</a></p></main></body></html>`);
    }
    if (gateway) {
      const headers = new Headers(c.req.raw.headers); headers.delete('authorization'); headers.delete('host');
      return fetch(new Request(gateway, { method: c.req.method, headers,
        body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer(), signal: c.req.raw.signal }));
    }
    return handler.fetch(c.req.raw);
  });
  return app;
}
