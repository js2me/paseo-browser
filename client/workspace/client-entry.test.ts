import { expect, it, vi } from 'vitest';
import type { PluginClientContext } from '@getpaseo/plugin/client';
import contribute from '../../index.client';

vi.mock('./browser', () => ({ contributeSharedBrowserClient: vi.fn(() => vi.fn()), SharedBrowserPanel: () => null }));
vi.mock('./sidebar', () => ({ contributeSharedBrowserSidebar: vi.fn(() => vi.fn()) }));
vi.mock('../settings', () => ({ BrowserSettingsScreen: () => null }));

it('boots every client contribution with icons available in Paseo 0.15', async () => {
  // Paseo validates icons synchronously. An unknown icon aborts the whole entry,
  // even though its daemon-side browser tools remain available.
  const supported = new Set(['Globe', 'PanelsTopLeft']);
  const register = vi.fn((contribution: { icon: string }) => {
    if (!supported.has(contribution.icon)) throw new Error(`Unknown host icon: ${contribution.icon}`);
    return vi.fn();
  });
  const client = {
    addSettingsScreen: register,
    addCommandCenterItem: register,
    addWorkspacePanel: register,
  } as unknown as PluginClientContext;
  const cleanup = contribute(client);
  expect(register).toHaveBeenCalledTimes(4);
  await cleanup();
});
