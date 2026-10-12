import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { mixtureSchema, batchSchema, profileSchema } from './domain.mjs';
export function restClient(baseUrl, token = '', request = fetch) {
  return async (method, path, body) => {
    const response = await request(new Request(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    }));
    if (response.status === 204) return { deleted: true };
    const result = await response.json();
    if (!response.ok) throw new Error(`API ${response.status}: ${JSON.stringify(result)}`);
    return result;
  };
}
export function createMcp(call) {
  const server = new McpServer({ name: 'duengerrechner', version: '1.0.0' });
  const register = (name, description, inputSchema, handler, readOnlyHint = true) => {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, destructiveHint: name === 'delete_water_profile', openWorldHint: false } }, async args => {
      try {
        const result = await handler(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result } };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });
  };
  register('search_fertilizers', 'Find fertilizer IDs, dosing units and elemental nutrients in mg per g or ml. Search by name; no search lists the catalog.', z.object({ search: z.string().max(200).optional() }),
    ({ search }) => call('GET', `/fertilizers?search=${encodeURIComponent(search ?? '')}`));
  register('get_fertilizer', 'Read the composition and dosing unit of one fertilizer.', z.object({ id: z.number().int().nonnegative() }), ({ id }) => call('GET', `/fertilizers/${id}`));
  register('calculate_mixture', 'Deterministically calculate a mixture: dose is g/l or ml/l, results are mg/l. Default water profile is used if present; no profiles still permits calculation. Set use_default_profile=false for fertilizer-only results. Hardness alone cannot determine calcium and magnesium. Change doses and call again to compare variants.', mixtureSchema,
    args => call('POST', '/calculate', args));
  register('calculate_batch', 'Calculate up to 50 mixtures in one call. Compare variants or reference schemes; this tool does not choose or optimize doses.', batchSchema,
    args => call('POST', '/calculate/batch', args));
  register('list_water_profiles', 'List stored water profiles and identify the default.', z.object({}), () => call('GET', '/profiles'));
  register('save_water_profile', 'Create a water profile, or replace one by id. Water concentrations: mg/l, gh/kh: degrees German hardness, ks: mmol/l, dilution_percent: nutrient-free water percentage. First profile is default; is_default=true changes the default. Profiles belong to this server instance.', profileSchema.extend({ id: z.string().max(100).optional() }),
    ({ id, ...body }) => call(id ? 'PUT' : 'POST', id ? `/profiles/${encodeURIComponent(id)}` : '/profiles', body), false);
  register('delete_water_profile', 'Delete a stored water profile. If it was default, another remaining profile becomes default.', z.object({ id: z.string().min(1).max(100) }),
    ({ id }) => call('DELETE', `/profiles/${encodeURIComponent(id)}`), false);
  return server;
}
export function createMcpHttpHandler(call) {
  return createMcpHandler(() => createMcp(call), { legacy: 'stateless', responseMode: 'auto', maxRequestBodySize: 256 * 1024 });
}
