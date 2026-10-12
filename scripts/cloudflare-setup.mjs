// Uses deployment credentials from the process environment, never from public assets.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const subdomain = process.env.WORKERS_SUBDOMAIN;
if (!account || !token || !subdomain) throw new Error('Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and WORKERS_SUBDOMAIN');
if (!/^[a-z0-9][a-z0-9-]*$/.test(subdomain)) throw new Error('Invalid Workers subdomain');
const config = JSON.parse(readFileSync(existsSync('wrangler.jsonc') ? 'wrangler.jsonc' : 'wrangler.example.jsonc', 'utf8'));
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.success) {
    if (response.status === 404 && method === 'GET' && path === '/workers/subdomain') return null;
    throw new Error(`Cloudflare ${method} ${path}: HTTP ${response.status}; ${JSON.stringify(data.errors)}`);
  }
  return data.result;
}
const existing = await api('/workers/subdomain');
if (existing?.subdomain && existing.subdomain !== subdomain) throw new Error(`Account already uses ${existing.subdomain}. Refusing to rename an account-wide subdomain.`);
if (!existing?.subdomain) await api('/workers/subdomain', 'PUT', { subdomain });
const binding = config.d1_databases[0];
const databases = await api('/d1/database?per_page=100');
let database = databases.find(db => db.name === binding.database_name);
if (!database) database = await api('/d1/database', 'POST', { name: binding.database_name });
if (!database.uuid) throw new Error('D1 database UUID missing');
binding.database_id = database.uuid;
config.account_id = account;
writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
console.log(`Configured: https://${config.name}.${subdomain}.workers.dev; D1: ${binding.database_name}`);
