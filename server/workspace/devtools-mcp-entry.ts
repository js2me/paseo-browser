import { BROWSER_AGENT_INSTRUCTIONS } from '../../shared/agent-guidance';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AgentSupervisorClient } from './supervisor-client';
import { resolveSupervisorPaths } from './supervisor';
import type { JsonValue } from './runtime-protocol';
import catalog from './devtools-tools.json';
import { advancedTools } from './advanced-tools';

const tools = [...catalog.tools, ...advancedTools];

async function main() {
  const ticket = process.env.PASEO_BROWSER_WORKSPACE_TICKET;
  const workspaceRoot = process.env.PASEO_BROWSER_WORKSPACE_ROOT;
  if (!ticket || !workspaceRoot) throw new Error('Workspace browser credentials and working directory are required');
  const client = new AgentSupervisorClient({ ticket, paths: resolveSupervisorPaths(process.env.PASEO_HOME ?? join(homedir(), '.paseo')) });
  await client.open();
  const server = new Server({ name: 'paseo-browser-devtools', version: '0.3.0' }, { capabilities: { tools: {} }, instructions: BROWSER_AGENT_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((tool) => ({
    ...tool,
    description: `${tool.description ?? ''}\nOperates on the shared workspace browser. First use shared_browser_acquire_control. DevTools requires exclusive workspace control; it waits for an in-flight tool and refuses while another viewer controls any tab.`,
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      if (!tools.some((tool) => tool.name === params.name)) throw new Error('Unknown Chrome tool');
      const result = await client.request('devtools', { name: params.name, arguments: (params.arguments ?? {}) as JsonValue, workspaceRoot });
      return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  });
  process.once('exit', () => client.disconnect());
  await server.connect(new StdioServerTransport());
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
