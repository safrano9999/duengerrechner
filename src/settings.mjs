import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tokenValue } from './auth.mjs';
export function readConfig(file) {
  try {
    return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).map(l => {
      const i = l.indexOf('='); if (i < 1) throw new Error(`Invalid configuration in ${file}`);
      const key = l.slice(0, i).trim(); let value = l.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [key, ['blank', 'null'].includes(value) ? '' : value];
    }));
  } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
export function settings(env = process.env) {
  const conf = { ...readConfig(env.CONFIG_FILE ?? 'config.conf'), ...readConfig(env.ENV_FILE ?? '.env'), ...env };
  const container = conf.CONTAINER_MODE === '1';
  const port = (key, fallback) => {
    const n = Number(conf[key] || fallback);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`Invalid ${key}`);
    return n;
  };
  const apiPort = container ? 8080 : port('API_PORT', 8080);
  const mcpPort = container ? 8000 : port('MCP_PORT', 8000);
  if (apiPort === mcpPort) throw new Error('API_PORT and MCP_PORT must differ');
  return { ...conf, container, apiPort, mcpPort,
    apiHost: container ? '0.0.0.0' : conf.API_HOST || '127.0.0.1',
    mcpHost: container ? '0.0.0.0' : conf.MCP_HOST || '127.0.0.1',
    API_BEARER_TOKEN: tokenValue(conf.API_BEARER_TOKEN), MCP_BEARER_TOKEN: tokenValue(conf.MCP_BEARER_TOKEN),
    database: container ? '/data/profiles.sqlite' : resolve(conf.PROFILES_DB || './data/profiles.sqlite'),
    apiUrl: container ? 'http://127.0.0.1:8080/api' : conf.API_URL || `http://${conf.API_HOST === '::' ? '[::1]' : conf.API_HOST && conf.API_HOST !== '0.0.0.0' ? conf.API_HOST : '127.0.0.1'}:${apiPort}/api`,
  };
}
