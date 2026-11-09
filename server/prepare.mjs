// Runs on the daemon host during dependency installation, outside Paseo's bundler.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const entry = resolve(dirname(require.resolve('chrome-devtools-mcp/package.json')), 'build/src/bin/chrome-devtools-mcp.js');
writeFileSync(new URL('./runtime.json', import.meta.url), JSON.stringify({ entry, nodePath: process.execPath }) + '\n');

// Tool discovery does not launch Chrome. Save exact schemas for the workspace adapter.
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
const client = new Client({ name: 'paseo-browser-prepare', version: '0.2.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [entry, '--no-usage-statistics', '--no-performance-crux'], stderr: 'ignore', env: { CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1', CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1' } });
try {
  await client.connect(transport);
  writeFileSync(new URL('./workspace/devtools-tools.json', import.meta.url), JSON.stringify(await client.listTools(), null, 2) + '\n');
} finally { await client.close(); await transport.close(); }
