import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
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
    if (gateway) {
      const headers = new Headers(c.req.raw.headers); headers.delete('authorization'); headers.delete('host');
      return fetch(new Request(gateway, { method: c.req.method, headers,
        body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer(), signal: c.req.raw.signal }));
    }
    return handler.fetch(c.req.raw);
  });
  return app;
}
