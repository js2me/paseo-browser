import { expect, it, vi } from 'vitest';
import type { PluginServerContext } from '@getpaseo/plugin/server';
import { browserSchema } from '../../shared/settings';
import contribute from '../../index.server';
import { issueAgentTicket, bindAgentTicket, revokeAgentBrowserAccess } from './browser';

vi.mock('./browser', async (original) => ({
  ...await original<typeof import('./browser')>(),
  issueAgentTicket: vi.fn(async () => {}),
  bindAgentTicket: vi.fn(async () => {}),
  revokeAgentBrowserAccess: vi.fn(async () => {}),
  cleanupBrowserServer: vi.fn(async () => {}),
}));

it('injects both workspace-bound MCP adapters on resume and refresh, excluding history and opt-out agents', async () => {
  let hook: ((event: { request: any }) => Promise<any>) | undefined;
  const server = {
    registerSettings: () => ({ read: async () => ({ status: 'ready', values: browserSchema.parse({}) }) }),
    handle: () => {},
    addHook: (name: string, handler: typeof hook) => { if (name === 'agent.open.before') hook = handler; return () => {}; },
  } as unknown as PluginServerContext;
  const cleanup = contribute(server);
  const request = { agentId: 'agent', workspaceId: 'workspace', cwd: '/project', provider: 'codex', purpose: 'interactive', reason: 'resume', labels: {}, env: { ORIGINAL: 'kept' }, tools: [], mcpServers: { existing: { type: 'http', url: 'https://example.com' } } };
  try {
    for (const reason of ['resume', 'refresh']) {
      const output = await hook!({ request: { ...request, reason } });
      expect(output.env).toEqual(request.env);
      expect(output.mcpServers.existing).toEqual(request.mcpServers.existing);
      const shared = output.mcpServers['paseo-browser'];
      const devtools = output.mcpServers['paseo-browser-devtools'];
      expect(shared.type).toBe('stdio');
      expect(devtools.type).toBe('stdio');
      expect(devtools.env.PASEO_BROWSER_WORKSPACE_TICKET).toBe(shared.env.PASEO_BROWSER_WORKSPACE_TICKET);
      expect(devtools.env.PASEO_BROWSER_WORKSPACE_ROOT).toBe('/project');
      expect(bindAgentTicket).toHaveBeenLastCalledWith(shared.env.PASEO_BROWSER_WORKSPACE_TICKET, 'agent', 'workspace');
    }
    expect(revokeAgentBrowserAccess).toHaveBeenCalledTimes(2);
    expect(issueAgentTicket).toHaveBeenCalledTimes(2);
    await expect(hook!({ request: { ...request, purpose: 'history' } })).resolves.toBeUndefined();
    await expect(hook!({ request: { ...request, labels: { 'paseo-browser/enabled': 'false' } } })).resolves.toBeUndefined();
    expect(issueAgentTicket).toHaveBeenCalledTimes(2);
  } finally { await cleanup(); }
});

it('preserves user instructions and adds idempotent browser routing for newly created supported agents', async () => {
  let createHook: ((event: { request: any }) => Promise<any>) | undefined;
  const server = {
    registerSettings: () => ({ read: async () => ({ status: 'ready', values: browserSchema.parse({}) }) }),
    handle: () => {},
    addHook: (name: string, handler: typeof createHook) => { if (name === 'agent.create.before') createHook = handler; return () => {}; },
  } as unknown as PluginServerContext;
  const cleanup = contribute(server);
  try {
    const request = { config: { provider: 'codex', cwd: '/project', systemPrompt: 'Follow project conventions.' }, env: { ORIGINAL: 'kept' } };
    const changed = await createHook!({ request });
    expect(changed.config.systemPrompt).toContain('Follow project conventions.');
    expect(changed.config.systemPrompt).toContain('paseo-browser-devtools');
    expect(changed.config.systemPrompt).toContain('CUA/cua_repl');
    expect(changed.env).toEqual(request.env);
    const again = await createHook!({ request: changed });
    expect(again.config.systemPrompt).toBe(changed.config.systemPrompt);
    await expect(createHook!({ request: { config: { ...request.config, internal: true } } })).resolves.toBeUndefined();
    await expect(createHook!({ request: { config: { ...request.config, provider: 'unsupported' } } })).resolves.toBeUndefined();
  } finally { await cleanup(); }
});
