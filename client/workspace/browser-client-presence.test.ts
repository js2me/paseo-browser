import { afterEach, expect, it, vi } from 'vitest';
import type { PluginClientContext } from '@getpaseo/plugin/client';
import { contributeSharedBrowserClient } from './browser-client-presence';
vi.mock('@getpaseo/plugin/client/ui', () => ({ Icon: () => null }));

afterEach(() => vi.useRealTimers());

function renderIcon(icon: unknown) {
  if (typeof icon !== 'function') throw new Error('Missing browser icon');
  icon({ workspaceId:'workspace', host:{id:'host'}, size:18, color:'#fff' });
}

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
    const registered = vi.mocked(client.addHeaderButton).mock.calls[0][0];
    for (let i=0;i<10;i++) { renderIcon(registered.button.icon); renderIcon(pill.button.icon); }
    expect(client.openPanel).not.toHaveBeenCalled();
    if (registered.button.behavior.kind !== 'action') throw new Error('Missing action');
    registered.button.behavior.onPress();
    if (pill.button.behavior.kind !== 'action') throw new Error('Missing pill action');
    pill.button.behavior.onPress();
    expect(client.openPanel).toHaveBeenCalledWith('workspace-browser', { workspaceId: 'workspace', location: 'explorer' });
    expect(client.openPanel).toHaveBeenCalledTimes(2);
    handlers.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'one' } });
    expect(headerRemove).not.toHaveBeenCalled();
    handlers.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'two' } });
    expect(headerRemove).toHaveBeenCalledTimes(1);
  } finally { cleanup(); }
  expect(client.openPanel).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledTimes(1);
});

it('does not advertise pending requests or open panels when sessions appear, disappear or reconnect', async () => {
  vi.useFakeTimers();
  let nativeWorkspaceIds: string[] = [];
  let handlers: any;
  const remove = vi.fn();
  const client = {
    openPanel:vi.fn(), addHeaderButton:vi.fn(() => ({remove})),
    addComposerPill:vi.fn(() => ({remove})),
    rpc:vi.fn(async ({name}: {name:string}) => name === 'native.presence'
      ? {workspaceIds:nativeWorkspaceIds, requestedWorkspaceIds:['workspace']}
      : {workspaceIds:[]}),
    paseo:{agents:{list:vi.fn(async () => ({subscription:{
      release:vi.fn(async () => {}), subscribe:(next:any) => {handlers=next;return vi.fn();},
    }}))}},
  } as unknown as PluginClientContext;
  const cleanup = contributeSharedBrowserClient(client);
  try {
    await vi.advanceTimersByTimeAsync(0);
    handlers.snapshot({entries:[{agent:{id:'agent',workspaceId:'workspace'}}],pageInfo:{hasMore:false}});
    await vi.advanceTimersByTimeAsync(0);
    expect(client.addComposerPill).not.toHaveBeenCalled();
    const header = vi.mocked(client.addHeaderButton).mock.calls[0][0];
    for (const ids of [['workspace'], [], ['workspace']]) {
      nativeWorkspaceIds = ids;
      await vi.advanceTimersByTimeAsync(2000);
      renderIcon(header.button.icon);
    }
    expect(client.addComposerPill).toHaveBeenCalledTimes(2);
    expect(client.openPanel).not.toHaveBeenCalled();
  } finally {cleanup();}
});

it('ignores a native presence response arriving after cleanup', async () => {
  vi.useFakeTimers();
  const native = Promise.withResolvers<{workspaceIds:string[];requestedWorkspaceIds:string[]}>();
  let handlers:any;
  const client = {
    openPanel:vi.fn(), addHeaderButton:vi.fn(() => ({remove:vi.fn()})),
    addComposerPill:vi.fn(() => ({remove:vi.fn()})),
    rpc:vi.fn(async ({name}: {name:string}) => name === 'native.presence'
      ? native.promise : {workspaceIds:[]}),
    paseo:{agents:{list:vi.fn(async () => ({subscription:{
      release:vi.fn(async () => {}), subscribe:(next:any) => {handlers=next;return vi.fn();},
    }}))}},
  } as unknown as PluginClientContext;
  const cleanup=contributeSharedBrowserClient(client);
  await vi.advanceTimersByTimeAsync(0);
  handlers.snapshot({entries:[{agent:{id:'agent',workspaceId:'workspace'}}],pageInfo:{hasMore:false}});
  await vi.advanceTimersByTimeAsync(0);
  cleanup();
  native.resolve({workspaceIds:['workspace'],requestedWorkspaceIds:[]});
  await vi.advanceTimersByTimeAsync(0);
  expect(client.addComposerPill).not.toHaveBeenCalled();
  expect(client.openPanel).not.toHaveBeenCalled();
});
