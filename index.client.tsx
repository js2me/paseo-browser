import { useSettings, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { browserSettings } from "./shared/settings";
import { NativeDesktopService } from "./client/native/desktop-service";
import { NativeBrowserPanel } from "./client/native/panel";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeSharedBrowserClient, SharedBrowserPanel } from "./client/workspace/browser";
import { contributeSharedBrowserSidebar } from "./client/workspace/sidebar";
import { BrowserSettingsScreen } from "./client/settings";

export function WorkspaceBrowserPanel(
  props: PluginWorkspacePanelProps & { service?: NativeDesktopService },
) {
  const settings = useSettings(browserSettings);
  if (settings.status !== "ready") return null;
  return settings.values.mode === "hybrid" ? (
    <NativeBrowserPanel {...props} />
  ) : (
    <SharedBrowserPanel {...props} />
  );
}

export default function contribute(client: PluginClientContext) {
  const native = new NativeDesktopService(client);
  const BrowserPanel = (props: PluginWorkspacePanelProps) => (
    <WorkspaceBrowserPanel {...props} service={native} />
  );
  const remove = client.addSettingsScreen({
    id: "chrome",
    title: "Chrome",
    icon: "Globe",
    Component: BrowserSettingsScreen,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "chrome-settings",
    title: "Chrome browser settings",
    icon: "Globe",
    context: "global",
    onSelect({ openSettings }) {
      openSettings("chrome");
    },
  });
  const panel = client.addWorkspacePanel({
    id: "workspace-browser",
    title: "Workspace Browser",
    icon: "PanelsTopLeft",
    locations: ["workspace", "explorer"],
    Component: BrowserPanel,
  });
  const command = client.addCommandCenterItem({
    id: "open-workspace-browser",
    title: "Open Workspace Browser",
    icon: "PanelsTopLeft",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("workspace-browser", { location: "explorer" });
    },
  });
  const sidebar = contributeSharedBrowserSidebar(client);
  const composer = contributeSharedBrowserClient(client);
  native.start();
  return async () => {
    native.dispose();
    command();
    panel();
    sidebar();
    removeCommand();
    remove();
    await composer();
  };
}
