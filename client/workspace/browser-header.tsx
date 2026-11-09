import type { PluginButtonIconProps } from '@getpaseo/plugin/client';
import { Icon } from '@getpaseo/plugin/client/ui';
import { useRpc } from '@getpaseo/plugin/client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { listOpenBrowserWorkspacesRpc } from '../../shared/workspace/browser';
import type { BrowserPanelAutoOpen } from './auto-open';

/** Paseo mounts a workspace header's icon for the displayed workspace, not background agents. */
export function createBrowserHeaderIcon(autoOpen: BrowserPanelAutoOpen) {
  return function BrowserHeaderIcon({ workspaceId, host, size, color }: PluginButtonIconProps) {
    const readPresence = useRpc(listOpenBrowserWorkspacesRpc);
    const presence = useQuery({
      queryKey: ['workspace-browser', 'header-presence', host.id],
      queryFn: async () => (await readPresence({})).workspaceIds,
      refetchInterval: 1_000,
      retry: false,
    });
    const hasBrowser = presence.data?.includes(workspaceId);
    useEffect(() => {
      if (hasBrowser === undefined) return;
      try { autoOpen.reveal(workspaceId, hasBrowser); }
      catch (error) { console.error('Could not open the workspace browser panel', error); }
    }, [workspaceId, hasBrowser]);
    return <Icon name="PanelsTopLeft" size={size} color={color} />;
  };
}
