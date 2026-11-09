/** One reveal per live browser, scoped to a visible workspace header. */
export function createBrowserPanelAutoOpen(open: (workspaceId: string) => void) {
  const revealed = new Set<string>();
  let disposed = false;
  return {
    reveal(workspaceId: string, hasBrowser: boolean) {
      if (disposed) return;
      if (!hasBrowser) { revealed.delete(workspaceId); return; }
      if (revealed.has(workspaceId)) return;
      // Mark before dispatch: host state updates can synchronously remount the header.
      revealed.add(workspaceId);
      try { open(workspaceId); }
      catch (error) { revealed.delete(workspaceId); throw error; }
    },
    presence(workspaceIds: readonly string[]) {
      const live = new Set(workspaceIds);
      for (const id of revealed) if (!live.has(id)) revealed.delete(id);
    },
    dispose() { disposed = true; revealed.clear(); },
  };
}
export type BrowserPanelAutoOpen = ReturnType<typeof createBrowserPanelAutoOpen>;
