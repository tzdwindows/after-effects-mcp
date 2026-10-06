#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';

async function main() {
  const server = new McpServer({
    name: 'after-effects-mcp',
    version: '1.0.0',
  });

  registerAllTools(server);

  const transport = new StdioServerTransport();

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  console.error('After Effects MCP Server running on stdio.');
}

main().catch((err) => {
  console.error('Fatal error starting After Effects MCP server:', err);
  process.exit(1);
});
