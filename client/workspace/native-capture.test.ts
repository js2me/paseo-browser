import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import { mountNativeGuest } from "./web";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const listeners = new Map<string, () => void>();
  const captureNativeFrame = vi.fn().mockResolvedValue(null);
  const sendNativeCommand = vi.fn().mockResolvedValue({ data: "c3RpbGw=" });
  vi.stubGlobal("paseoDesktop", { browser: {
    profilePartition: "persist:test",
    registerAttachedBrowser: vi.fn().mockResolvedValue({}),
    unregisterWorkspaceBrowser: vi.fn().mockResolvedValue({}),
    captureNativeFrame, sendNativeCommand,
  } });
  const guest = {
    style: {}, setAttribute: vi.fn(), remove: vi.fn(),
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    getWebContentsId: () => 42,
    getBoundingClientRect: () => ({ width: 1600, height: 1000 }),
    getURL: () => "https://example.com", getTitle: () => "Static page",
    canGoBack: () => false, canGoForward: () => false,
  };
  const controller = mountNativeGuest({
    ownerDocument: { createElement: () => guest, body: { appendChild: vi.fn() } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 1000 }),
  }, "workspace", "browser", vi.fn())!;
  listeners.get("dom-ready")!(); await Promise.resolve(); controller.state();
  vi.setSystemTime(10_100);
  return { controller, listeners, captureNativeFrame, sendNativeCommand };
}

it("delivers still pages without a repaint and bounds fallback frequency and dimensions", async () => {
  const { controller, sendNativeCommand } = await fixture();
  const frame = await controller.capture(1);
  expect(frame).toMatchObject({ data: "data:image/jpeg;base64,c3RpbGw=", width: 1280, height: 800, sequence: 1 });
  expect(sendNativeCommand).toHaveBeenCalledWith(expect.objectContaining({ method: "Page.captureScreenshot", params: expect.objectContaining({ clip: { x: 0, y: 0, width: 1600, height: 1000, scale: 0.8 } }) }));
  vi.setSystemTime(10_500);
  expect(await controller.capture(2)).toBeNull();
  expect(sendNativeCommand).toHaveBeenCalledTimes(1);
  vi.setSystemTime(11_100);
  expect(await controller.capture(3)).not.toBeNull();
  expect(sendNativeCommand).toHaveBeenCalledTimes(2);
});

it("uses fresh screencast frames without screenshot overhead", async () => {
  const { controller, captureNativeFrame, sendNativeCommand } = await fixture();
  captureNativeFrame.mockResolvedValue({ capturedAt: 10_100, width: 1280, height: 800, data: "data:image/jpeg;base64,c3RyZWFt" });
  expect(await controller.capture(1)).toMatchObject({ capturedAt: 10_100 });
  expect(sendNativeCommand).not.toHaveBeenCalled();
});

it("drops screenshots taken across navigation and rejects oversized images", async () => {
  const { controller, listeners, sendNativeCommand } = await fixture();
  sendNativeCommand.mockImplementationOnce(async () => { listeners.get("did-navigate")!(); return { data: "b2xk" }; });
  expect(await controller.capture(1)).toBeNull();
  vi.setSystemTime(11_200);
  sendNativeCommand.mockResolvedValue({ data: "A".repeat(1_100_000) });
  await expect(controller.capture(2)).rejects.toThrow("size limit");
});
