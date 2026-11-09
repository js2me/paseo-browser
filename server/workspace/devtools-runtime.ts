import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import runtime from '../runtime.json';
import type { JsonValue } from './runtime-protocol';
import { WorkspaceCdp } from './cdp-runtime';
import { advancedToolSchemas } from './advanced-tools';

/** Stays on the supervisor; no browser debugging endpoint is sent to an agent. */
export class WorkspaceDevtools {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connecting: Promise<Client> | null = null;
  private cdp: WorkspaceCdp;
  constructor(private readonly endpoint: () => Promise<string>, private readonly workspaceRoot: string) { this.cdp = new WorkspaceCdp(endpoint); }
  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      const transport = new StdioClientTransport({
        command: runtime.nodePath,
        args: [runtime.entry, `--wsEndpoint=${await this.endpoint()}`, '--no-usage-statistics', '--no-performance-crux', `--filesystemRoot=${this.workspaceRoot}`],
        env: { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1', CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1' },
        stderr: 'ignore',
      });
      const client = new Client({ name: 'paseo-browser-workspace', version: '0.3.0' });
      this.transport = transport;
      try { await client.connect(transport); this.client = client; return client; }
      catch (error) { await transport.close(); throw error; }
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }
  async call(name: string, args: Record<string, unknown>): Promise<JsonValue> {
    if (Object.hasOwn(advancedToolSchemas, name)) {
      const result = await this.cdp.call(name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    const client = await this.connect();
    // Never retry mutations: a broken transport may have delivered the operation.
    try { return await client.callTool({ name, arguments: args }, undefined, { timeout: 20_000 }) as JsonValue; }
    catch (error) { await this.close(); throw error; }
  }
  async close() { this.cdp.close(); await this.client?.close(); await this.transport?.close(); this.client = null; this.transport = null; }
}
