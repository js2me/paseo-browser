import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  nativeControlRpc,
  nativeExchangeRpc,
  nativePresenceRpc,
  nativeReleaseRpc,
  type NativeState,
  type NativeCommand,
  type NativeFrame,
} from "../../shared/native/contracts";
import {
  mountNativeGuest,
  nativeDesktopBrowserApi,
  createNativeBrowserId,
  type NativeGuestController,
} from "../workspace/web";
type Snapshot = { state: NativeState | null; controller: string | null; error: string | null };
type Listener = (snapshot: Snapshot) => void;
type Desktop = {
  guest: NativeGuestController;
  guests: Map<string, NativeGuestController>;
  anchor: unknown;
  listeners: Set<Listener>;
  snapshot: Snapshot;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
};
const IDLE_WORKSPACE_MS = 60_000;
const MAX_SAVED_WORKSPACES = 128;
type SavedWorkspace = { tabs: Array<{ id: string; url: string }>; selected: string };
/** Park briefly between panels, then release idle Chromium guests and retain only URLs. */
export class NativeDesktopService {
  readonly clientId = `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private workspaces = new Map<string, Desktop>();
  private savedWorkspaces = new Map<string, SavedWorkspace>();
  private stopped = false;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private client: Pick<PluginClientContext, "rpc">) {}
  /** Host remote requests even when this workspace has never been shown on desktop. */
  start() {
    if (this.stopped || this.presenceTimer || !nativeDesktopBrowserApi()) return;
    const poll = async () => {
      try {
        const presence = await this.client.rpc(nativePresenceRpc, {});
        if (this.stopped) return;
        for (const workspaceId of presence.requestedWorkspaceIds) {
          if (this.workspaces.has(workspaceId) || presence.workspaceIds.includes(workspaceId)) continue;
          const detach = this.attach(workspaceId, null, "about:blank", () => {});
          detach();
        }
      } catch (error) {
        if (!this.stopped) console.error("Native browser startup failed", error);
      }
      if (!this.stopped) this.presenceTimer = setTimeout(() => void poll(), 1000);
    };
    this.presenceTimer = setTimeout(() => void poll(), 0);
  }
  openDevTools(workspaceId: string) {
    const desktop = this.workspaces.get(workspaceId);
    if (!desktop || desktop.stopped) throw Error("Native browser is not ready");
    desktop.guest.openDevTools();
  }
  private createGuest(
    workspaceId: string,
    node: unknown,
    url: string,
    onError: (message: string) => void,
    id = createNativeBrowserId(),
  ) {
    const guest = mountNativeGuest(node, workspaceId, id, onError, url);
    if (!guest) throw Error("Native Chromium requires the Paseo desktop application");
    return { id, guest };
  }
  private async execute(workspaceId: string, desktop: Desktop, command: NativeCommand) {
    const tabs = () =>
      [...desktop.guests].map(([browserId, guest]) => ({
        browserId,
        url: guest.state()?.url ?? "about:blank",
        title: guest.state()?.title ?? "New tab",
      }));
    if (command.operation === "tabs.list")
      return { tabs: tabs(), selected: desktop.guest.state()?.browserId };
    if (command.operation === "tabs.create") {
      if (desktop.guests.size >= 8) throw Error("Native browser tab limit reached");
      const created = this.createGuest(
        workspaceId,
        desktop.anchor,
        String(command.input.url ?? "about:blank"),
        (message) => {
          desktop.snapshot.error = message;
        },
      );
      desktop.guest.present(null);
      desktop.guests.set(created.id, created.guest);
      desktop.guest = created.guest;
      return { tabId: created.id };
    }
    if (command.operation === "tabs.select") {
      const guest = desktop.guests.get(String(command.input.tabId));
      if (!guest) throw Error("Native tab is unavailable");
      desktop.guest.present(null);
      desktop.guest = guest;
      guest.present(desktop.anchor);
      return { tabId: command.input.tabId };
    }
    if (command.operation === "tabs.close") {
      const current = [...desktop.guests].find(([, guest]) => guest === desktop.guest);
      if (!current) throw Error("Native tab is unavailable");
      if (desktop.guests.size === 1) {
        const created = this.createGuest(workspaceId, desktop.anchor, "about:blank", (message) => {
          desktop.snapshot.error = message;
        });
        desktop.guests.set(created.id, created.guest);
      }
      desktop.guests.delete(current[0]);
      current[1].dispose();
      desktop.guest = desktop.guests.values().next().value!;
      desktop.guest.present(desktop.anchor);
      return { closed: true };
    }
    return desktop.guest.execute(command);
  }
  attach(workspaceId: string, node: unknown, initialUrl: string, listener: Listener) {
    if (this.stopped) return () => {};
    let desktop = this.workspaces.get(workspaceId);
    if (!desktop) {
      const listeners = new Set<Listener>();
      const snapshot: Snapshot = { state: null, controller: null, error: null };
      const publish = () => {
        for (const listener of listeners) listener({ ...snapshot });
      };
      const onError = (error: string) => {
        snapshot.error = error;
        publish();
      };
      const saved = this.savedWorkspaces.get(workspaceId);
      const restored = new Map<string, NativeGuestController>();
      try {
        for (const tab of saved?.tabs ?? []) {
          const created = this.createGuest(workspaceId, null, tab.url, onError, tab.id);
          restored.set(created.id, created.guest);
        }
        if (!restored.size) {
          const created = this.createGuest(workspaceId, node, initialUrl, onError);
          restored.set(created.id, created.guest);
        }
      } catch (error) {
        for (const guest of restored.values()) guest.dispose();
        throw error;
      }
      this.savedWorkspaces.delete(workspaceId);
      desktop = {
        guest: (saved && restored.get(saved.selected)) || restored.values().next().value!,
        guests: restored,
        anchor: node,
        listeners,
        snapshot,
        timer: null,
        stopped: false,
      };
      this.workspaces.set(workspaceId, desktop);
      const owned = desktop;
      let sequence = 0;
      let streaming = false;
      let results: Array<{ id: string; result?: unknown; error?: string }> = [];
      let captureTask: Promise<void> | null = null;
      let capturedFrame: NativeFrame | null = null;
      let captureError: string | null = null;
      let lastActiveAt = Date.now();
      let executing = 0;
      const pump = async () => {
        if (owned.stopped) return;
        try {
          const guest = owned.guest;
          guest.inputEnabled(true);
          snapshot.state = guest.state();
          if (snapshot.state)
            snapshot.state.tabs = [...owned.guests].map(([browserId, tab]) => ({
              browserId,
              url: tab.state()?.url ?? "about:blank",
              title: tab.state()?.title ?? "New tab",
            }));
          const frame = capturedFrame;
          capturedFrame = null;
          if (owned.stopped) return;
          const completed = results;
          results = [];
          let reply;
          try {
            reply = await this.client.rpc(nativeExchangeRpc, {
              clientId: this.clientId,
              workspaceId,
              state: snapshot.state,
              frame,
              results: completed,
              error: captureError,
            });
          } catch (error) {
            results = [...completed, ...results];
            throw error;
          }
          if (owned.stopped) return;
          if (!reply.accepted) {
            snapshot.error = "This native browser is hosted by another desktop.";
            publish();
            owned.stopped = true;
            for (const tab of owned.guests.values()) tab.dispose();
            this.workspaces.delete(workspaceId);
            return;
          }
          snapshot.controller = reply.controller;
          snapshot.error = captureError;
          streaming = reply.streaming;
          if (owned.listeners.size || streaming || reply.controller || reply.commands.length ||
            completed.length || executing) lastActiveAt = Date.now();
          if (!owned.listeners.size && !streaming && !reply.controller &&
            !reply.commands.length && !completed.length && !executing &&
            Date.now() - lastActiveAt >= IDLE_WORKSPACE_MS) {
            const { released } = await this.client.rpc(nativeReleaseRpc, {
              workspaceId, clientId: this.clientId,
            });
            if (owned.stopped) return;
            if (released && !owned.listeners.size) {
              const tabs = [...owned.guests].map(([id, guest]) => ({
                id, url: guest.state()?.url ?? "about:blank",
              }));
              const selected = [...owned.guests].find(([, guest]) => guest === owned.guest)![0];
              if (this.savedWorkspaces.size >= MAX_SAVED_WORKSPACES)
                this.savedWorkspaces.delete(this.savedWorkspaces.keys().next().value!);
              this.savedWorkspaces.set(workspaceId, { tabs, selected });
              owned.stopped = true;
              capturedFrame = null;
              for (const guest of owned.guests.values()) guest.dispose();
              owned.guests.clear();
              owned.anchor = null;
              this.workspaces.delete(workspaceId);
              return;
            }
          }
          publish();
          for (const command of reply.commands) {
            executing++;
            void this.execute(workspaceId, owned, command).then(
              (result) => { if (!owned.stopped) results.push({ id: command.id, result }); },
              (error) => { if (!owned.stopped) results.push({ id: command.id, error: String(error) }); },
            ).finally(() => { executing--; });
          }
          // A capture can wait for a compositor paint (including on about:blank).
          // It must never hold command dispatch or the desktop ownership heartbeat.
          if (streaming && snapshot.state && !captureTask) {
            const source = owned.guest;
            captureTask = source.capture(++sequence).then(
              (frame) => {
                if (owned.stopped || owned.guest !== source) return;
                capturedFrame = frame;
                captureError = null;
              },
              (error) => { captureError = String(error).slice(0, 2048); },
            ).finally(() => { captureTask = null; });
          }
        } catch (error) {
          if (!owned.stopped) {
            snapshot.error = String(error);
            publish();
          }
        }
        if (!owned.stopped)
          owned.timer = setTimeout(
            () => void pump(),
            streaming ? 66 : owned.listeners.size ? 150 : 1500,
          );
      };
      void pump();
    }
    const owned = desktop;
    owned.anchor = node;
    owned.guest.present(node);
    owned.listeners.add(listener);
    listener({ ...owned.snapshot });
    return () => {
      owned.listeners.delete(listener);
      if (owned.listeners.size) return;
      owned.anchor = null;
      owned.guest.present(null);
      if (owned.snapshot.controller === this.clientId)
        void this.client
          .rpc(nativeControlRpc, { workspaceId, viewerId: this.clientId, action: "release" })
          .catch(() => {});
    };
  }
  dispose() {
    this.stopped = true;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    for (const desktop of this.workspaces.values()) {
      desktop.stopped = true;
      if (desktop.timer) clearTimeout(desktop.timer);
      for (const guest of desktop.guests.values()) guest.dispose();
      desktop.listeners.clear();
    }
    this.workspaces.clear();
    this.savedWorkspaces.clear();
  }
}
