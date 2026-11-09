import type { PluginServerContext } from '@getpaseo/plugin/server';
import { browserSettings } from './shared/settings';
import { browserServer, shouldAttach } from './server/browser';
import runtime from './server/runtime.json';
import { withBrowserGuidance } from './shared/agent-guidance';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { contributeWorkspace } from './server/workspace/contribute';
import { issueAgentTicket, bindAgentTicket, revokeAgentBrowserAccess } from './server/workspace/browser';
import { resolveBrowserRuntimeRoot } from './server/workspace/runtime-path';

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(browserSettings);
  // The daemon may run inside Electron: use a real Node executable for stdio MCP.
  const nodePath = runtime.nodePath;
  const workspaceCleanup = contributeWorkspace(server);
  const removeCreateHook = server.addHook('agent.create.before', async ({ request }) => {
    const current = await settings.read();
    if (current.status !== 'ready' || !current.values.enabled || request.config.internal ||
        !current.values.providers.includes(request.config.provider)) return;
    return { ...request, config: { ...request.config, systemPrompt: withBrowserGuidance(request.config.systemPrompt) } };
  });
  const removeHook = server.addHook('agent.open.before', async ({ request }) => {
    const current = await settings.read();
    if (current.status !== 'ready') throw new Error('Chrome settings are invalid. Open Chrome browser settings in Paseo.');
    if (!shouldAttach(current.values, request)) return;
    if (current.values.mode === 'workspace') {
      if (!request.workspaceId) return;
      const home = process.env.PASEO_HOME ?? join(homedir(), '.paseo');
      const root = resolveBrowserRuntimeRoot(home);
      await revokeAgentBrowserAccess(request.agentId);
      const ticket = randomBytes(32).toString('base64url');
      await issueAgentTicket(ticket);
      await bindAgentTicket(ticket, request.agentId, request.workspaceId);
      const env = { PASEO_HOME: home, PASEO_BROWSER_WORKSPACE_TICKET: ticket, PASEO_BROWSER_WORKSPACE_ROOT: request.cwd };
      return { ...request, mcpServers: {
        ...request.mcpServers,
        'paseo-browser': { type: 'stdio', command: nodePath, args: [join(root, 'shared-browser-mcp.cjs')], env },
        'paseo-browser-devtools': { type: 'stdio', command: nodePath, args: [join(root, 'devtools-mcp.cjs')], env },
      } };
    }
    return {
      ...request,
      mcpServers: { ...request.mcpServers, 'paseo-browser': browserServer(current.values, nodePath, request.cwd) },
    };
  });
  return () => { removeCreateHook(); removeHook(); return workspaceCleanup(); };
}
