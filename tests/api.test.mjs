import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteStore } from '../src/node-store.mjs';
import { createApi } from '../src/api.mjs';
import { catalog, service } from '../src/domain.mjs';
import { mcpApp } from '../src/mcp-http.mjs';
import { restClient } from '../src/mcp.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function setup(t, config = {}) {
  const store = sqliteStore(':memory:'); t.after(() => store.close());
  const api = createApi(store, config);
  const req = (path, body, headers = {}, method = body === undefined ? 'GET' : 'POST') => api.request(path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { store, api, req, svc: service(store) };
}
const mixture = { fertilizers: [{ id: 27, dose: 0.5 }, { id: 28, dose: 0.75 }], volume_l: 10 };

test('catalog and rounding match browser for every original fertilizer, including id zero', async t => {
  const { svc } = setup(t);
  assert.equal(new Set(catalog.map(f => f.id)).size, catalog.length);
  for (const f of catalog) {
    const actual = await svc.calculate({ fertilizers: [{ id: f.id, dose: 0.12345 }] });
    for (const [key, value] of Object.entries(actual.totals_mg_l)) {
      assert.equal(value, Number(((f[key] || 0) * 0.12345).toFixed(3)), `${f.name}: ${key}`);
    }
  }
});

test('known mixture, dose units and volume give explicit expected values', async t => {
  const { svc } = setup(t);
  const r = await svc.calculate(mixture);
  assert.equal(r.totals_mg_l.n, 160);
  assert.equal(r.totals_mg_l.p, 50.186);
  assert.equal(r.totals_mg_l.k, 190.946);
  assert.equal(r.totals_mg_l['n-no3'], 57.5);
  assert.deepEqual(r.fertilizers.map(f => f.amount), [5, 7.5]);
  assert.equal(r.water.source, 'none');
  await assert.rejects(svc.calculate({ fertilizers: [{ id: 27, dose: 1, unit: 'ml' }] }), /Expected g/);
  await assert.rejects(svc.calculate({ fertilizers: [{ id: 27, dose: -1 }] }));
  await assert.rejects(svc.calculate({ fertilizers: [{ id: 999999, dose: 1 }] }), /Unknown fertilizer/);
});

test('Green House CalMag is discoverable and converts declared oxide percentages to elemental mg/l', async t => {
  const { req, svc } = setup(t);
  const result = await (await req('/api/fertilizers?search=Green%20House%20Powder%20Feeding%20CalMag')).json();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1000001);
  assert.equal(result[0].unit, 'g');
  const r = await svc.calculate({ fertilizers: [{ id: result[0].id, dose: 1 }], volume_l: 10, use_default_profile: false });
  assert.equal(r.fertilizers[0].amount, 10);
  assert.equal(r.totals_mg_l.n, 135);
  assert.equal(r.totals_mg_l['n-no3'], 131);
  assert.equal(r.totals_mg_l['n-nh4'], 4);
  assert.equal(r.totals_mg_l.ca, 119.405);
  assert.equal(r.totals_mg_l.mg, 36.18);
  assert.equal(r.totals_mg_l['n-nu'], 0);
  assert.equal(r.target_assessment.checks.find(c => c.nutrient === 'n-no3').status, 'within_range');
});

test('profile defaults, explicit selection, replacement, deletion and dilution', async t => {
  const { svc } = setup(t);
  const a = await svc.saveProfile({ name: 'A', water: { ca: 80, mg: 20, no3: 10, ks: 2 } });
  assert.equal(a.is_default, true);
  const b = await svc.saveProfile({ name: 'B', water: { ca: 40, mg: 10 }, is_default: true });
  assert.equal((await svc.profiles()).filter(p => p.is_default).length, 1);
  assert.equal((await svc.calculate(mixture)).water.profile_id, b.id);
  const r = await svc.calculate({ ...mixture, profile_id: a.id, dilution_percent: 50 });
  assert.equal(r.totals_mg_l.ca, 40);
  assert.equal(r.totals_mg_l.n, 161.13);
  assert.equal(r.water.hardness_dh.gh, 7.907);
  assert.equal(r.water.hardness_dh.kh, 2.73);
  assert.equal((await svc.calculate({ ...mixture, use_default_profile: false })).water.source, 'none');
  assert.equal((await svc.calculate({ ...mixture, water: { ca: 7 } })).totals_mg_l.ca, 7);
  await svc.saveProfile({ name: 'A2', water: { ca: 90 } }, a.id);
  await svc.deleteProfile(b.id);
  assert.equal((await svc.profile(a.id)).is_default, true);
  await svc.deleteProfile(a.id);
  assert.equal((await svc.calculate(mixture)).water.source, 'none');
  await assert.rejects(svc.calculate({ ...mixture, profile_id: a.id }), /Unknown water profile/);
  const hardness = await svc.calculate({ fertilizers: [], water: { gh: 14 } });
  assert.equal(hardness.water.hardness_dh.gh, 14);
  assert.ok(hardness.water.unknown_nutrients.includes('ca'));
  assert.ok(hardness.warnings.length);
});

test('REST validation, batch and independent optional auth', async t => {
  const { req } = setup(t, { API_BEARER_TOKEN: 'api-secret', CORS_ORIGINS: 'https://allowed.test' });
  assert.equal((await req('/health')).status, 200);
  assert.equal((await req('/api/fertilizers')).status, 401);
  const headers = { Authorization: 'Bearer api-secret' };
  const batch = await req('/api/calculate/batch', { mixtures: [mixture, { fertilizers: [] }] }, headers);
  assert.equal(batch.status, 200);
  assert.equal((await batch.json())[0].totals_mg_l.n, 160);
  assert.equal((await req('/api/calculate', { fertilizers: [{ id: 27, dose: -1 }] }, headers)).status, 422);
  assert.equal((await req('/api/profiles', { name: 'x', water: {} }, { ...headers, Origin: 'https://evil.test' })).status, 403);
  assert.equal((await req('/api/calculate', mixture, { ...headers, Origin: 'https://allowed.test' })).status, 200);
  assert.equal((await req('/api/calculate', { fertilizers: [], water: { n: 1, no3: 2 } }, headers)).status, 422);
});

test('GraphQL queries and mutations share REST calculations and profile state', async t => {
  const { req } = setup(t);
  const response = await req('/graphql', { query: `query($input: Mixture!) {
    fertilizers(search: "Hakaphos") { id name nutrients { n p k } }
    calculate(input: $input) { totals_mg_l { n p k n_no3 } water { source } }
  }`, variables: { input: mixture } });
  const body = await response.json();
  assert.equal(body.errors, undefined, JSON.stringify(body));
  assert.equal(body.data.calculate.totals_mg_l.n, 160);
  assert.equal(body.data.calculate.totals_mg_l.n_no3, 57.5);
  const saved = await (await req('/graphql', { query: 'mutation { createProfile(input: {name: "GQL", water: {ca: 42}}) {id is_default} }' })).json();
  assert.equal(saved.errors, undefined, JSON.stringify(saved));
  assert.equal((await (await req('/api/calculate', mixture)).json()).totals_mg_l.ca, 42);
  const deleted = await (await req('/graphql', { query: 'mutation($id: ID!) { deleteProfile(id: $id) }', variables: { id: saved.data.createProfile.id } })).json();
  assert.equal(deleted.data.deleteProfile, true);
});

test('official MCP client initializes, lists tools, calculates and writes profiles through protected REST', async t => {
  const { api } = setup(t, { API_BEARER_TOKEN: 'api-secret' });
  const app = mcpApp(restClient('http://local/api', 'api-secret', r => api.fetch(r)), { MCP_BEARER_TOKEN: 'mcp-secret' });
  assert.equal((await app.request('/mcp', { method: 'POST' })).status, 401);
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL('http://local/mcp'), {
    requestInit: { headers: { Authorization: 'Bearer mcp-secret' } },
    fetch: (url, init) => app.fetch(new Request(url, init)),
  });
  await client.connect(transport); t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 7);
  const result = await client.callTool({ name: 'calculate_mixture', arguments: mixture });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(result.structuredContent.result.totals_mg_l.n, 160);
  assert.equal(result.structuredContent.result.target_assessment.deviations.find(c => c.nutrient === 'p').status, 'above');
  const generative = await client.callTool({ name: 'calculate_mixture', arguments: { ...mixture, stage: 'gen' } });
  assert.equal(generative.structuredContent.result.target_assessment.stage_defaulted, false);
  assert.equal(generative.structuredContent.result.target_assessment.checks.find(c => c.nutrient === 'p').status, 'within_range');
  const saved = await client.callTool({ name: 'save_water_profile', arguments: { name: 'MCP', water: { ca: 11 } } });
  assert.equal(saved.isError, undefined, JSON.stringify(saved));
  const calculated = await client.callTool({ name: 'calculate_mixture', arguments: mixture });
  assert.equal(calculated.structuredContent.result.totals_mg_l.ca, 11);
  await client.callTool({ name: 'delete_water_profile', arguments: { id: saved.structuredContent.result.id } });
  const zero = await client.callTool({ name: 'get_fertilizer', arguments: { id: 0 } });
  assert.equal(zero.structuredContent.result.id, 0);
});
