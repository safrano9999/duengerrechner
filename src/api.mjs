import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { service, mixtureSchema, batchSchema, profileSchema } from './domain.mjs';
import { yoga } from './graphql.mjs';
import { authorized, tokenValue } from './auth.mjs';
export function createApi(store, config = {}) {
  const app = new Hono();
  const svc = service(store);
  const token = tokenValue(config.API_BEARER_TOKEN);
  const origins = (config.CORS_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean);
  app.use('*', cors({ origin: origin => origins.includes(origin) ? origin : '',
    allowHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version', 'MCP-Session-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], exposeHeaders: ['MCP-Session-Id'] }));
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }));
  app.get('/health', c => c.json({ status: 'ok', service: 'duengerrechner' }));
  app.get('/api', c => c.json({ name: 'Düngerrechner API', openapi: '/api/openapi.json', graphql: '/graphql',
    endpoints: ['/api/fertilizers', '/api/profiles', '/api/calculate', '/api/calculate/batch'], units: 'dose in g/l or ml/l; results in mg/l' }));
  app.get('/api/openapi.json', c => c.json(openapi));
  app.use('*', async (c, next) => {
    if (!await authorized(c.req.raw, token)) return c.json({ error: 'Bearer token required' }, 401, { 'WWW-Authenticate': 'Bearer' });
    // Also protect write endpoints against cross-site requests when auth is disabled.
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin && !origins.includes(origin)) return c.json({ error: 'Origin not allowed' }, 403);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/api/fertilizers', c => c.json(svc.fertilizers(c.req.query('search'))));
  app.get('/api/fertilizers/:id', c => c.json(svc.fertilizer(c.req.param('id'))));
  app.get('/api/profiles', async c => c.json(await svc.profiles()));
  app.get('/api/profiles/:id', async c => c.json(await svc.profile(c.req.param('id'))));
  app.post('/api/profiles', async c => c.json(await svc.saveProfile(await c.req.json()), 201));
  app.put('/api/profiles/:id', async c => c.json(await svc.saveProfile(await c.req.json(), c.req.param('id'))));
  app.delete('/api/profiles/:id', async c => { await svc.deleteProfile(c.req.param('id')); return c.body(null, 204); });
  app.post('/api/calculate', async c => c.json(await svc.calculate(await c.req.json())));
  app.post('/api/calculate/batch', async c => c.json(await svc.batch(await c.req.json())));
  app.all('/graphql', c => yoga.fetch(c.req.raw, { svc }));
  app.onError((error, c) => {
    if (error instanceof z.ZodError) return c.json({ error: 'Invalid input', issues: error.issues }, 422);
    if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON' }, 400);
    if (error.status) return c.json({ error: error.message }, error.status);
    console.error('API request failed:', error.name);
    return c.json({ error: 'Internal server error' }, 500);
  });
  return app;
}
const definitions = { Mixture: mixtureSchema, Batch: batchSchema, ProfileInput: profileSchema };
const jsonSchema = Object.fromEntries(Object.entries(definitions).map(([k,v]) => [k,z.toJSONSchema(v, { io: 'input' })]));
const response = { '200': { description: 'Success' }, '401': { description: 'Invalid or missing bearer token' }, '422': { description: 'Invalid input' } };
const body = ref => ({ required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } });
export const openapi = {
  openapi: '3.1.0', info: { title: 'Düngerrechner REST API', version: '1.0.0', description: 'Optional instance-wide Bearer authentication. Dose is g/l or ml/l. Water is mg/l; gh/kh in °dH, ks in mmol/l. No profile means the default profile, or fertilizer-only calculation if none exists.' },
  components: { schemas: jsonSchema, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  security: [{ bearer: [] }, {}],
  paths: {
    '/api/fertilizers': { get: { parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }], responses: response } },
    '/api/fertilizers/{id}': { get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: response } },
    '/api/calculate': { post: { requestBody: body('Mixture'), responses: response } },
    '/api/calculate/batch': { post: { requestBody: body('Batch'), responses: response } },
    '/api/profiles': { get: { responses: response }, post: { requestBody: body('ProfileInput'), responses: { ...response, '201': { description: 'Created; first profile is automatically default' } } } },
    '/api/profiles/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], get: { responses: response }, put: { requestBody: body('ProfileInput'), responses: response }, delete: { responses: { '204': { description: 'Deleted' }, '404': { description: 'Unknown profile' } } } },
  },
};
