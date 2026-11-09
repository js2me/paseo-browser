import { expect, it, vi } from 'vitest';
import type { PluginClientContext } from '@getpaseo/plugin/client';
import type { BrowserPanelAutoOpen } from './auto-open';
import { contributeSharedBrowserClient } from './browser-client-presence';
const state = vi.hoisted(() => ({ auto: null as BrowserPanelAutoOpen | null }));
vi.mock('./browser-header', () => ({ createBrowserHeaderIcon: (auto: BrowserPanelAutoOpen) => { state.auto = auto; return () => null; } }));

it('registers one header per workspace and targets Explorer without opening background workspaces', async () => {
  const headerRemove = vi.fn();
  const pillRemove = vi.fn();
  const release = vi.fn(async () => {});
  let handlers: any;
  const client = {
    openPanel: vi.fn(),
    addHeaderButton: vi.fn(() => ({ remove: headerRemove })),
    addComposerPill: vi.fn(() => ({ remove: pillRemove })),
    rpc: vi.fn(async () => ({ workspaceIds: ['workspace'], requestedWorkspaceIds: [] })),
    paseo: { agents: { list: vi.fn(async () => ({ subscription: {
      release,
      subscribe: (next: any) => { handlers = next; return vi.fn(); },
    } })) } },
  } as unknown as PluginClientContext;
  const cleanup = contributeSharedBrowserClient(client);
  try {
    await vi.waitFor(() => expect(handlers).toBeDefined());
    handlers.snapshot({ entries: [{ agent: { id: 'one', workspaceId: 'workspace' } }, { agent: { id: 'two', workspaceId: 'workspace' } }], pageInfo: { hasMore: false } });
    await vi.waitFor(() => expect(client.addHeaderButton).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(client.addComposerPill).toHaveBeenCalledTimes(2));
    expect(client.openPanel).not.toHaveBeenCalled();
    const pill = vi.mocked(client.addComposerPill).mock.calls[0][0];
    expect(pill.button.icon).toBe(vi.mocked(client.addHeaderButton).mock.calls[0][0].button.icon);
    // The composer icon also performs this reveal when mobile hides the header.
    state.auto!.reveal('workspace', true);
    expect(client.openPanel).toHaveBeenCalledWith('workspace-browser', { workspaceId: 'workspace', location: 'explorer' });
    const registered = vi.mocked(client.addHeaderButton).mock.calls[0][0];
    if (registered.button.behavior.kind !== 'action') throw new Error('Missing action');
    registered.button.behavior.onPress();
    expect(client.openPanel).toHaveBeenCalledTimes(2);
    handlers.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'one' } });
    expect(headerRemove).not.toHaveBeenCalled();
    handlers.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'two' } });
    expect(headerRemove).toHaveBeenCalledTimes(1);
  } finally { cleanup(); }
  state.auto!.reveal('another', true);
  expect(client.openPanel).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledTimes(1);
});
