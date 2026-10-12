import { cpSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
rmSync('dist/site', { recursive: true, force: true });
mkdirSync('dist/site', { recursive: true });
// An explicit allowlist prevents credentials and server sources entering public assets.
for (const path of ['index.html', 'js', 'css', 'assets']) cpSync(path, `dist/site/${path}`, { recursive: true });
copyFileSync('backend.example.json', 'dist/site/backend.example.json');
const api = process.env.PUBLIC_API_URL, mcp = process.env.PUBLIC_MCP_URL;
if (api || mcp) writeFileSync('dist/site/backend.json', JSON.stringify({ api_url: api, mcp_url: mcp }));
else if (existsSync('backend.json')) copyFileSync('backend.json', 'dist/site/backend.json');
writeFileSync('dist/site/.nojekyll', '');
