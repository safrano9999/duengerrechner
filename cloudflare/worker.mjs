import { createApi } from '../src/api.mjs';
import { d1Store } from '../src/profiles.mjs';
import { mcpApp } from '../src/mcp-http.mjs';
import { restClient } from '../src/mcp.mjs';
let cached;
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/backend.json') return Response.json({ api_url: '/api', mcp_url: '/mcp' });
    if (!['/api', '/graphql', '/mcp', '/health'].some(p => path === p || path.startsWith(p + '/'))) return env.ASSETS.fetch(request);
    if (!cached || cached.env !== env) {
      const api = createApi(d1Store(env.DB), env);
      // MCP calls the same REST handler in-process: no public loopback request, no extra Worker invocation.
      const call = restClient('https://internal.invalid/api', env.API_BEARER_TOKEN, req => api.fetch(req));
      cached = { env, api, mcp: mcpApp(call, env) };
    }
    return path === '/mcp' ? cached.mcp.fetch(request) : cached.api.fetch(request);
  },
};
