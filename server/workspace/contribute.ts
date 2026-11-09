import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  cleanupBrowserServer,
  handleAcquireControl,
  handleApplyDevicePreset,
  handleAttachBrowser,
  handleBeginBrowserGesture,
  handleCaptureBrowser,
  handleCloseBrowser,
  handleCloseBrowserTab,
  handleCreateBrowserTab,
  handleDetachBrowser,
  handleEndBrowserGesture,
  handleListBrowserTabs,
  handleListOpenBrowserWorkspaces,
  handleNavigateBrowser,
  handleReadBrowserVideo,
  handleReleaseControl,
  handleReopenBrowser,
  handleResizeBrowser,
  handleSendBrowserInput,
  handleSetCaptureDensity,
  handleUpdateBrowserGesture,
  handleWorkspaceArchived,
  revokeAgentBrowserAccess,
} from "./browser";
import {
  acquireControlRpc,
  applyDevicePresetRpc,
  attachBrowserRpc,
  beginBrowserGestureRpc,
  captureBrowserRpc,
  closeBrowserRpc,
  closeBrowserTabRpc,
  createBrowserTabRpc,
  detachBrowserRpc,
  endBrowserGestureRpc,
  listBrowserTabsRpc,
  listOpenBrowserWorkspacesRpc,
  navigateBrowserRpc,
  releaseControlRpc,
  reopenBrowserRpc,
  resizeBrowserRpc,
  sendBrowserInputRpc,
  setCaptureDensityRpc,
  updateBrowserGestureRpc,
} from "../../shared/workspace/browser";
import { browserDisplayPreferences } from "../../shared/workspace/browser-display-preferences";
import { readBrowserVideoRpc } from "../../shared/workspace/browser-video";

export function contributeWorkspace(server: PluginServerContext) {
  server.registerSettings(browserDisplayPreferences);
  server.handle(attachBrowserRpc, handleAttachBrowser);
  server.handle(detachBrowserRpc, handleDetachBrowser);
  server.handle(closeBrowserRpc, handleCloseBrowser);
  server.handle(closeBrowserTabRpc, handleCloseBrowserTab);
  server.handle(createBrowserTabRpc, handleCreateBrowserTab);
  server.handle(listBrowserTabsRpc, handleListBrowserTabs);
  server.handle(reopenBrowserRpc, handleReopenBrowser);
  server.handle(captureBrowserRpc, handleCaptureBrowser);
  server.handle(setCaptureDensityRpc, handleSetCaptureDensity);
  server.handle(readBrowserVideoRpc, handleReadBrowserVideo);
  server.handle(listOpenBrowserWorkspacesRpc, handleListOpenBrowserWorkspaces);
  server.handle(acquireControlRpc, handleAcquireControl);
  server.handle(releaseControlRpc, handleReleaseControl);
  server.handle(beginBrowserGestureRpc, handleBeginBrowserGesture);
  server.handle(updateBrowserGestureRpc, handleUpdateBrowserGesture);
  server.handle(endBrowserGestureRpc, handleEndBrowserGesture);
  server.handle(navigateBrowserRpc, handleNavigateBrowser);
  server.handle(resizeBrowserRpc, handleResizeBrowser);
  server.handle(applyDevicePresetRpc, handleApplyDevicePreset);
  server.handle(sendBrowserInputRpc, handleSendBrowserInput);
  const removeArchive = server.addHook("workspace.archive.after", async ({ workspace }) => handleWorkspaceArchived(workspace.id));
  const removeAgent = server.addHook("agent.archive.after", async ({ agent }) => revokeAgentBrowserAccess(agent.id));
  return () => { removeArchive(); removeAgent(); return cleanupBrowserServer(); };
}
