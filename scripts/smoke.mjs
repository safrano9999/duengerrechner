import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base = (process.argv[2] || 'http://127.0.0.1:18787').replace(/\/$/, '');
const headers = { 'Content-Type': 'application/json', ...(process.env.API_BEARER_TOKEN ? { Authorization: `Bearer ${process.env.API_BEARER_TOKEN}` } : {}) };
async function req(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(r.ok, `${path}: ${r.status} ${r.ok ? '' : await r.text()}`);
  return r.status === 204 ? null : r.json();
}
assert.equal((await req('/health')).status, 'ok');
const html = await (await fetch(base + '/')).text();
assert.equal((html.match(/id="api-link"/g) || []).length, 1);
assert.ok(html.includes('bergrows Düngerrechner'));
const catalog = await req('/api/fertilizers?search=Hakaphos');
assert.ok(catalog.some(f => f.id === 27));
const input = { fertilizers: [{ id: 27, dose: 0.5 }, { id: 28, dose: 0.75 }], use_default_profile: false };
const rest = await req('/api/calculate', input);
assert.equal(rest.totals_mg_l.n, 160);
assert.equal(rest.target_assessment.deviations.find(c => c.nutrient === 'p').distance_to_range, 10.186);
const gql = await req('/graphql', { query: 'query($input:Mixture!){calculate(input:$input){totals_mg_l{n p k} target_assessment{stage all_in_range}}}', variables: { input } });
assert.equal(gql.errors, undefined, JSON.stringify(gql));
assert.equal(gql.data.calculate.totals_mg_l.n, rest.totals_mg_l.n);
assert.equal(gql.data.calculate.target_assessment.stage, 'veg');
const client = new Client({ name: 'deployment-smoke', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL || base + '/mcp'), { requestInit: { headers: process.env.MCP_BEARER_TOKEN ? { Authorization: `Bearer ${process.env.MCP_BEARER_TOKEN}` } : {} } }));
try {
  assert.equal((await client.listTools()).tools.length, 7);
  const mcp = await client.callTool({ name: 'calculate_mixture', arguments: input });
  assert.equal(mcp.isError, undefined, JSON.stringify(mcp));
  assert.deepEqual(mcp.structuredContent.result.totals_mg_l, rest.totals_mg_l);
  assert.deepEqual(mcp.structuredContent.result.target_assessment, rest.target_assessment);
} finally { await client.close(); }
// Probe the modern stateless protocol directly; no initialize or legacy fallback.
async function modern(method, params = {}) {
  const r = await fetch(process.env.MCP_URL || base + '/mcp', {
    method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method,
      ...(params.name ? { 'Mcp-Name': params.name } : {}),
      ...(process.env.MCP_BEARER_TOKEN ? { Authorization: `Bearer ${process.env.MCP_BEARER_TOKEN}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params: { ...params, _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'deployment-smoke', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
    } } }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(r.status, 200, `modern ${method}: ${await r.clone().text()}`);
  const body = await r.json();
  assert.equal(body.error, undefined, JSON.stringify(body));
  assert.equal(body.result.resultType, 'complete');
  return body.result;
}
assert.ok((await modern('server/discover')).supportedVersions.includes('2026-07-28'));
assert.equal((await modern('tools/list')).tools.length, 7);
const modernResult = (await modern('tools/call', { name: 'calculate_mixture', arguments: input })).structuredContent.result;
assert.deepEqual(modernResult.totals_mg_l, rest.totals_mg_l);
assert.deepEqual(modernResult.target_assessment, rest.target_assessment);
if (process.argv.includes('--profiles')) {
  const p = await req('/api/profiles', { name: `Smoke test ${crypto.randomUUID()}`, water: { ca: 47, mg: 9 } });
  try {
    const r = await req('/api/calculate', { ...input, profile_id: p.id });
    assert.equal(r.totals_mg_l.ca, 47);
    assert.equal((await req(`/api/profiles/${p.id}`)).name, p.name);
  } finally { await req(`/api/profiles/${p.id}`, undefined, 'DELETE'); }
}
console.log(`OK: UI, REST, GraphQL, MCP legacy + 2026-07-28${process.argv.includes('--profiles') ? ', profile storage' : ''} at ${base}`);
