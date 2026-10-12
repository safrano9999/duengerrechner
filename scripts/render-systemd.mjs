import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd();
if (/[\n\r%]/.test(root)) throw new Error('Unsupported systemd path');
const quote = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
const target = 'duengerrechner.service';
const text = `[Unit]
Description=Düngerrechner REST, GraphQL and MCP
After=network.target

[Service]
Type=simple
WorkingDirectory=${quote(root)}
EnvironmentFile=-${quote(resolve('.env'))}
Environment="PATH=${process.env.PATH.replaceAll('"', '\\"')}"
ExecStart=${quote(resolve('.venv/bin/python'))} ${quote(resolve('scripts/start-baremetal.py'))}
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
writeFileSync(target, text, { mode: 0o600 });
console.log(`Written: ${target}`);
