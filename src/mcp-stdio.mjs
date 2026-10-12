import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcp, restClient } from './mcp.mjs';
import { settings } from './settings.mjs';
const config = settings();
const server = createMcp(restClient(config.apiUrl, config.API_BEARER_TOKEN));
await server.connect(new StdioServerTransport());
