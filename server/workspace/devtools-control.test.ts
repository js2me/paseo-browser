import { expect, it } from 'vitest';
import { SessionManager } from './browser-policy';
import type { JsonValue } from './runtime-protocol';

it('queues human takeover behind an in-flight DevTools call, then rejects the former agent lease', async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let publications = 0;
  const manager = new SessionManager({
    validateWorkspace: async () => true,
    client: {
      connect: async () => ({ epoch: 1 }),
      ensureWorkspace: async (workspaceId) => ({ workspaceId, runtimeId: 'r'.repeat(32), createdAt: 1 }),
      archiveWorkspace: async () => {}, closeWorkspace: async () => {}, disconnect: () => {},
      requestWorkspace: async (_workspace, operation): Promise<JsonValue> => {
        if (operation === 'identity') return { userAgent: 'fixture' };
        if (operation === 'state') return { url: 'https://fixture.invalid/', title: 'fixture', inputGeneration: '1:1', canGoBack: false, canGoForward: false };
        if (operation === 'devtools') { publications++; entered.resolve(); await finish.promise; return { content: [] }; }
        return null;
      },
    },
  });
  try {
    await manager.connect();
    const agent = await manager.attach('workspace', 'Agent');
    const human = await manager.attach('workspace', 'Human');
    const lease = await manager.acquireControl(agent.viewerToken);
    const pending = manager.runDevtools(agent.viewerToken, lease.controlToken, { name: 'evaluate_script' });
    await entered.promise;
    let acquired = false;
    const takeover = manager.acquireControl(human.viewerToken, true).then((value) => { acquired = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(acquired).toBe(false);
    finish.resolve(); await pending; await takeover;
    expect(acquired).toBe(true);
    await expect(manager.runDevtools(agent.viewerToken, lease.controlToken, { name: 'evaluate_script' })).rejects.toThrow(/lease/);
    expect(publications).toBe(1);
  } finally { finish.resolve(); manager.disconnect(); }
});
