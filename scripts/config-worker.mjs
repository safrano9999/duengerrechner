import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { readConfig } from '../src/settings.mjs';
const prompt = createInterface({ input: process.stdin, output: process.stdout });
const conf = readConfig('config.conf');
const config = JSON.parse(readFileSync(existsSync('wrangler.jsonc') ? 'wrangler.jsonc' : 'wrangler.example.jsonc', 'utf8'));
async function ask(label, current) { return process.stdin.isTTY ? (await prompt.question(`${label} [${current}]: `)).trim() || current : current; }
try {
  config.name = await ask('Worker name', config.name);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.name)) throw new Error('Invalid Worker name');
  config.d1_databases[0].database_id = await ask('D1 database UUID (create with wrangler d1 create first)', config.d1_databases[0].database_id);
  if (!/^[0-9a-f-]{36}$/i.test(config.d1_databases[0].database_id)) throw new Error('Invalid database UUID');
  config.vars.CORS_ORIGINS = conf.CORS_ORIGINS || '';
  writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  console.log('Written: wrangler.jsonc. Tokens stay in .env; upload them as Worker secrets, never as public vars.');
} finally { prompt.close(); }
