import { afterEach, expect, it, vi } from "vitest";

const { guests } = vi.hoisted(() => ({ guests: [] as any[] }));
vi.mock("../workspace/web", () => ({
  nativeDesktopBrowserApi: () => ({}),
  createNativeBrowserId: () => `guest-${guests.length}`,
  mountNativeGuest: () => {
    const guest = {
      state: () => ({ browserId: `guest-${guests.indexOf(guest)}`, url: "about:blank" }),
      inputEnabled: vi.fn(), present: vi.fn(), dispose: vi.fn(), openDevTools: vi.fn(),
      capture: vi.fn().mockResolvedValue(null),
    };
    guests.push(guest);
    return guest;
  },
}));
import { NativeDesktopService } from "./desktop-service";

afterEach(() => { vi.useRealTimers(); guests.length = 0; });

it("opens DevTools on the selected tab and requires human control", async () => {
  vi.useFakeTimers();
  let controller: string | null = null;
  let commands: any[] = [];
  const service = new NativeDesktopService({ rpc: vi.fn(async () => {
    const next = commands; commands = [];
    return { accepted: true, controller, streaming: false, commands: next };
  }) as any });
  expect(() => service.openDevTools("workspace")).toThrow("not ready");
  service.attach("workspace", {}, "about:blank", () => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(() => service.openDevTools("workspace")).toThrow("Take control");
  controller = service.clientId;
  await vi.advanceTimersByTimeAsync(150);
  service.openDevTools("workspace");
  expect(guests[0].openDevTools).toHaveBeenCalledTimes(1);
  commands = [{ id: "create", operation: "tabs.create", input: {} }];
  await vi.advanceTimersByTimeAsync(150);
  service.openDevTools("workspace");
  expect(guests[1].openDevTools).toHaveBeenCalledTimes(1);
  expect(guests[0].openDevTools).toHaveBeenCalledTimes(1);
  controller = "other-agent";
  await vi.advanceTimersByTimeAsync(150);
  expect(() => service.openDevTools("workspace")).toThrow("Take control");
  service.dispose();
  expect(() => service.openDevTools("workspace")).toThrow("not ready");
});


it("starts and parks a remotely requested workspace without mounting a panel", async () => {
  vi.useFakeTimers();
  const rpc = vi.fn(async (contract: {name: string}) => contract.name === "native.presence"
    ? { workspaceIds: [], requestedWorkspaceIds: ["remote-workspace"] }
    : { accepted: true, controller: null, streaming: true, commands: [] });
  const service = new NativeDesktopService({ rpc: rpc as any });
  service.start(); service.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(guests).toHaveLength(1);
  expect(guests[0].present).toHaveBeenCalledWith(null);
  await vi.advanceTimersByTimeAsync(2100);
  expect(guests).toHaveLength(1);
  service.dispose();
  const calls = rpc.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(rpc).toHaveBeenCalledTimes(calls);
});

it.each([true, false])("keeps commands and heartbeats running while capture stalls (CDP: %s)", async (cdp) => {
  vi.useFakeTimers();
  let commands: any[] = [];
  const rpc = vi.fn(async () => {
    const next = commands; commands = [];
    return { accepted: true, controller: null, streaming: true, commands: next };
  });
  const service = new NativeDesktopService({ rpc: rpc as any });
  service.attach("workspace", {}, "about:blank", () => {});
  const guest = guests[0];
  guest.state = () => ({ browserId: "guest-0", cdp });
  guest.capture = vi.fn(() => new Promise(() => {}));
  guest.execute = vi.fn().mockResolvedValue({ opened: true });
  await vi.advanceTimersByTimeAsync(150);
  commands = [{ id: "open", operation: "navigate", input: {url:"https://example.com"} }];
  await vi.advanceTimersByTimeAsync(6000);
  expect(guest.execute).toHaveBeenCalledWith(expect.objectContaining({ id: "open" }));
  expect(rpc.mock.calls.length).toBeGreaterThan(20);
  expect(guest.capture).toHaveBeenCalledTimes(1);
  service.dispose();
});
