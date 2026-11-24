import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import { mountNativeGuest } from "./web";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function fixture(bridge = true) {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const listeners = new Map<string, () => void>();
  const captureNativeFrame = vi.fn().mockResolvedValue(null);
  const sendNativeCommand = vi.fn().mockResolvedValue({ data: "c3RpbGw=" });
  const executeAutomationCommand = vi.fn().mockResolvedValue({ ok: true, result: {
    browserId: "browser", mimeType: "image/png", dataBase64: "cG5n", width: 1600, height: 1000,
  } });
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const canvas = { width: 0, height: 0,
    getContext: () => ({ fillStyle: "", drawImage, fillRect }),
    toDataURL: vi.fn().mockReturnValue("data:image/jpeg;base64,c3RvY2s="),
  };
  const decode = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("Image", class {
    naturalWidth = 1600; naturalHeight = 1000; src = ""; decode = decode;
  });
  vi.stubGlobal("paseoDesktop", { browser: {
    profilePartition: "persist:test",
    registerAttachedBrowser: vi.fn().mockResolvedValue({}),
    unregisterWorkspaceBrowser: vi.fn().mockResolvedValue({}),
    executeAutomationCommand,
    ...(bridge ? { captureNativeFrame, sendNativeCommand } : {}),
  } });
  const guest = {
    style: {}, setAttribute: vi.fn(), remove: vi.fn(),
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    getWebContentsId: () => 42,
    getBoundingClientRect: () => ({ width: 1600, height: 1000 }),
    getURL: () => "https://example.com", getTitle: () => "Static page",
    canGoBack: () => false, canGoForward: () => false,
    loadURL: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn(), sendInputEvent: vi.fn(), insertText: vi.fn().mockResolvedValue(undefined),
  };
  const controller = mountNativeGuest({
    ownerDocument: { createElement: (kind: string) => kind === "canvas" ? canvas : guest,
      body: { appendChild: vi.fn() } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 1000 }),
  }, "workspace", "browser", vi.fn())!;
  listeners.get("dom-ready")!(); await Promise.resolve(); controller.state();
  vi.setSystemTime(10_100);
  return { controller, listeners, captureNativeFrame, sendNativeCommand,
    executeAutomationCommand, canvas, drawImage, fillRect, decode, guest };
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

it("falls back to a still while screencast startup is pending, without multiplying stream requests", async () => {
  const { controller, captureNativeFrame, sendNativeCommand } = await fixture();
  captureNativeFrame.mockImplementation(() => new Promise(() => {}));
  expect(await controller.capture(1)).toMatchObject({ sequence: 1 });
  vi.setSystemTime(11_200);
  expect(await controller.capture(2)).toMatchObject({ sequence: 2 });
  expect(captureNativeFrame).toHaveBeenCalledTimes(1);
  expect(sendNativeCommand).toHaveBeenCalledTimes(2);
});

it("broadcasts the same native guest on stock Paseo without a CDP bridge", async () => {
  const { controller, executeAutomationCommand, canvas, fillRect, drawImage, guest } = await fixture(false);
  expect(controller.state()?.cdp).toBe(false);
  expect(await controller.capture(1)).toMatchObject({
    browserId: "browser", data: "data:image/jpeg;base64,c3RvY2s=", width: 1280, height: 800,
  });
  expect(executeAutomationCommand).toHaveBeenCalledWith(expect.objectContaining({
    workspaceId: "workspace", command: { command: "screenshot", args: { browserId: "browser", fullPage: false } },
  }));
  expect(fillRect).toHaveBeenCalledWith(0, 0, 1280, 800);
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 800);
  expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.65);
  expect(guest.remove).not.toHaveBeenCalled();
  vi.setSystemTime(10_250);
  expect(await controller.capture(2)).toBeNull();
  vi.setSystemTime(10_300);
  expect(await controller.capture(3)).not.toBeNull();
  expect(executeAutomationCommand).toHaveBeenCalledTimes(2);
});

it("discards stock screenshots from a replaced page, a disposed guest or another browser", async () => {
  const { controller, listeners, executeAutomationCommand, decode } = await fixture(false);
  decode.mockImplementationOnce(async () => listeners.get("did-navigate")!());
  expect(await controller.capture(1)).toBeNull();
  vi.setSystemTime(10_400);
  executeAutomationCommand.mockResolvedValueOnce({ ok: true, result: {
    browserId: "other", mimeType: "image/png", dataBase64: "cG5n",
  } });
  await expect(controller.capture(2)).rejects.toThrow("invalid browser screenshot");
  vi.setSystemTime(10_700);
  decode.mockImplementationOnce(async () => controller.dispose());
  expect(await controller.capture(3)).toBeNull();
});

it("supports mobile taps, text and keys through the native guest without CDP", async () => {
  const { controller, guest } = await fixture(false);
  const input = async (values: Record<string, unknown>) => controller.execute({
    id: "input", operation: "input", input: {
      browserId: "browser", generation: controller.state()!.generation, ...values,
    },
  });
  await input({ kind: "tap", x: 123, y: 234 });
  expect(guest.sendInputEvent.mock.calls).toEqual([
    [{type:"mouseDown", x:123, y:234, button:"left", clickCount:1}],
    [{type:"mouseUp", x:123, y:234, button:"left", clickCount:1}],
  ]);
  await input({ kind: "type", text: "hello" });
  expect(guest.insertText).toHaveBeenCalledExactlyOnceWith("hello");
  await input({ kind: "key", key: "Enter" });
  expect(guest.sendInputEvent).toHaveBeenLastCalledWith({type:"keyUp", keyCode:"Enter"});
  await expect(input({kind:"tap", x:0, y:0, generation:-1})).rejects.toThrow("Page changed");
  await expect(input({kind:"tap", x:-1, y:0})).rejects.toThrow("Invalid input coordinates");
});

it.each([true, false])("moves the agent cursor without clicking and fences stale pages (CDP=%s)", async (bridge) => {
  const { controller, guest, sendNativeCommand } = await fixture(bridge);
  const executeJavaScript = vi.fn().mockResolvedValue(undefined);
  Object.assign(guest, { executeJavaScript });
  const input = { browserId: "browser", generation: controller.state()!.generation, x: 42, y: 75, action: "move" };
  await controller.execute({ id: "cursor", operation: "cursor", input });
  expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining("__paseoAgentCursor"));
  if (bridge) expect(sendNativeCommand).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 42, y: 75, button: "none" },
  }));
  else expect(guest.sendInputEvent).toHaveBeenCalledExactlyOnceWith({ type: "mouseMove", x: 42, y: 75 });
  await expect(controller.execute({ id: "old", operation: "cursor", input: { ...input, generation: -1 } })).rejects.toThrow("Page changed");
  await expect(controller.execute({ id: "outside", operation: "cursor", input: { ...input, x: 99999 } })).rejects.toThrow("coordinates");
  expect(executeJavaScript).toHaveBeenCalledTimes(1);
});

it("keeps the latest cursor position without waiting for a paused page", async () => {
  const { controller, guest, sendNativeCommand } = await fixture();
  const overlay = Promise.withResolvers<void>();
  const executeJavaScript = vi.fn().mockReturnValue(overlay.promise);
  Object.assign(guest, { executeJavaScript });
  const input = { browserId: "browser", generation: controller.state()!.generation, x: 42, y: 75, action: "move" };
  await controller.execute({ id: "first", operation: "cursor", input });
  await controller.execute({ id: "second", operation: "cursor", input: { ...input, x: 100 } });
  await controller.execute({ id: "third", operation: "cursor", input: { ...input, x: 110 } });
  expect(sendNativeCommand).toHaveBeenCalledTimes(3);
  expect(executeJavaScript).toHaveBeenCalledTimes(1);
  overlay.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(executeJavaScript).toHaveBeenCalledTimes(2);
  expect(executeJavaScript).toHaveBeenLastCalledWith(expect.stringContaining("'left', 110"));
});

it("discards queued cursor positions when the page changes", async () => {
  const { controller, guest, listeners } = await fixture();
  const overlay = Promise.withResolvers<void>();
  const executeJavaScript = vi.fn().mockReturnValue(overlay.promise);
  Object.assign(guest, { executeJavaScript });
  const input = { browserId: "browser", generation: controller.state()!.generation, x: 42, y: 75, action: "move" };
  await controller.execute({ id: "first", operation: "cursor", input });
  await controller.execute({ id: "second", operation: "cursor", input: { ...input, x: 100 } });
  listeners.get("did-navigate")!();
  overlay.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(executeJavaScript).toHaveBeenCalledTimes(1);
});

it.each(["open", "navigate"])("normalizes address-bar URLs before native %s", async (operation) => {
  const { controller, guest } = await fixture();
  for (const [input, expected] of [
    ["vk.ru", "https://vk.ru/"],
    ["  vk.ru/feed?q=test#news  ", "https://vk.ru/feed?q=test#news"],
    ["localhost:3000/path", "https://localhost:3000/path"],
    ["http://localhost:3000/path", "http://localhost:3000/path"],
    ["https://example.com/", "https://example.com/"],
    ["about:blank", "about:blank"],
  ]) {
    await controller.execute({ id: "navigation", operation, input: { url: input } });
    expect(guest.loadURL).toHaveBeenLastCalledWith(expected);
  }
  expect(guest.loadURL).toHaveBeenCalledTimes(6);
  for (const url of ["", "https://", "not a website", "javascript:alert(1)", "file:///etc/passwd"]) {
    await expect(controller.execute({ id: "invalid", operation, input: { url } })).rejects.toThrow(/HTTP|HTTPS/);
  }
  expect(guest.loadURL).toHaveBeenCalledTimes(6);
});
