import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMcp, restClient } from './mcp.mjs';
import { settings } from './settings.mjs';
const config = settings();
serveStdio(() => createMcp(restClient(config.apiUrl, config.API_BEARER_TOKEN)));
