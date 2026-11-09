import { afterEach, expect, it, vi } from "vitest";

const { guests } = vi.hoisted(() => ({ guests: [] as any[] }));
vi.mock("../workspace/web", () => ({
  createNativeBrowserId: () => `guest-${guests.length}`,
  mountNativeGuest: () => {
    const guest = {
      state: () => ({ browserId: `guest-${guests.indexOf(guest)}`, url: "about:blank" }),
      inputEnabled: vi.fn(), present: vi.fn(), dispose: vi.fn(), openDevTools: vi.fn(),
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
