import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import { mountNativeGuest } from "./web";

afterEach(() => vi.unstubAllGlobals());

it("opens real guest DevTools detached only while the guest is ready and alive", async () => {
  const listeners = new Map<string, () => void>();
  const openDevTools = vi.fn();
  const guest = {
    style: {},
    setAttribute: vi.fn(),
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    getWebContentsId: () => 42,
    openDevTools,
    remove: vi.fn(),
  };
  const registerAttachedBrowser = vi.fn().mockResolvedValue({});
  vi.stubGlobal("paseoDesktop", {
    browser: {
      profilePartition: "persist:paseo-browser",
      registerAttachedBrowser,
      unregisterWorkspaceBrowser: vi.fn().mockResolvedValue({}),
    },
  });
  const controller = mountNativeGuest({
    ownerDocument: { createElement: () => guest, body: { appendChild: vi.fn() } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  }, "workspace", "browser", vi.fn())!;
  expect(() => controller.openDevTools()).toThrow("not ready");
  listeners.get("dom-ready")!();
  await Promise.resolve();
  expect(registerAttachedBrowser).toHaveBeenCalledWith({
    browserId: "browser", workspaceId: "workspace", webContentsId: 42,
  });
  controller.openDevTools();
  expect(openDevTools).toHaveBeenCalledExactlyOnceWith({ mode: "detach", activate: true });
  controller.dispose();
  expect(() => controller.openDevTools()).toThrow("not ready");
});
