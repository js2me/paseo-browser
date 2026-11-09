import type { PluginClientContext } from '@getpaseo/plugin/client';
import { contributeSharedBrowserClient, SharedBrowserPanel } from './client/workspace/browser';
import { contributeSharedBrowserSidebar } from './client/workspace/sidebar';
import { BrowserSettingsScreen } from './client/settings';

export default function contribute(client: PluginClientContext) {
  const remove = client.addSettingsScreen({ id: 'chrome', title: 'Chrome', icon: 'Globe', Component: BrowserSettingsScreen });
  const removeCommand = client.addCommandCenterItem({
    id: 'chrome-settings', title: 'Chrome browser settings', icon: 'Globe', context: 'global',
    onSelect({ openSettings }) { openSettings('chrome'); },
  });
  const panel = client.addWorkspacePanel({ id: 'workspace-browser', title: 'Workspace Browser', icon: 'PanelsTopLeft', locations: ['workspace', 'explorer'], Component: SharedBrowserPanel });
  const command = client.addCommandCenterItem({ id: 'open-workspace-browser', title: 'Open Workspace Browser', icon: 'PanelsTopLeft', context: 'workspace', onSelect({ openPanel }) { openPanel('workspace-browser', { location: 'explorer' }); } });
  const sidebar = contributeSharedBrowserSidebar(client);
  const composer = contributeSharedBrowserClient(client);
  return async () => { command(); panel(); sidebar(); removeCommand(); remove(); await composer(); };
}
