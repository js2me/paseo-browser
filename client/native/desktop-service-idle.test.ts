import { afterEach, expect, it, vi } from "vitest";

const { guests } = vi.hoisted(() => ({ guests: [] as any[] }));
vi.mock("../workspace/web", () => ({
  nativeDesktopBrowserApi: () => ({}),
  createNativeBrowserId: () => `guest-${guests.length}`,
  mountNativeGuest: (_node: unknown, _workspace: string, id: string, _error: unknown, url: string) => {
    const guest = {
      state: () => ({ browserId: id, url }),
      inputEnabled: vi.fn(), present: vi.fn(), dispose: vi.fn(), openDevTools: vi.fn(),
      capture: vi.fn().mockResolvedValue(null), execute: vi.fn().mockResolvedValue({}),
    };
    guests.push(guest);
    return guest;
  },
}));
import { NativeDesktopService } from "./desktop-service";

const services: NativeDesktopService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  guests.length = 0;
  vi.useRealTimers();
});
function fixture() {
  vi.useFakeTimers();
  const state = { streaming: false, controller: null as string | null, commands: [] as any[] };
  const rpc = vi.fn(async (contract: { name: string }, _input?: unknown): Promise<any> => {
    if (contract.name === "native.release") return { released: true };
    if (contract.name === "native.presence") return { workspaceIds: [], requestedWorkspaceIds: [] };
    const commands = state.commands.splice(0);
    return { accepted: true, ...state, commands };
  });
  const service = new NativeDesktopService({ rpc: rpc as any });
  services.push(service);
  return { service, rpc, state };
}

it("disposes parked tabs, stops their heartbeat and restores URLs, IDs and selection", async () => {
  const { service, rpc, state } = fixture();
  const detach = service.attach("workspace", {}, "https://first.test/", () => {});
  await vi.advanceTimersByTimeAsync(0);
  state.commands.push({ id: "new-tab", operation: "tabs.create", input: { url: "https://second.test/" } });
  await vi.advanceTimersByTimeAsync(300);
  detach();
  await vi.advanceTimersByTimeAsync(62_000);
  expect(guests).toHaveLength(2);
  for (const guest of guests) expect(guest.dispose).toHaveBeenCalledTimes(1);
  const calls = rpc.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(rpc).toHaveBeenCalledTimes(calls);
  service.attach("workspace", {}, "about:blank", () => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(guests.slice(2).map((guest) => guest.state())).toEqual([
    { browserId: "guest-0", url: "https://first.test/" },
    { browserId: "guest-1", url: "https://second.test/" },
  ]);
  expect(guests[3].present).toHaveBeenLastCalledWith(expect.any(Object));
});

it.each(["panel", "viewer", "controller", "command"])("retains a workspace with an active %s", async (active) => {
  const { service, rpc, state } = fixture();
  const detach = service.attach("workspace", {}, "https://example.test/", () => {});
  await vi.advanceTimersByTimeAsync(0);
  if (active !== "panel") detach();
  if (active === "viewer") state.streaming = true;
  if (active === "controller") state.controller = "agent";
  if (active === "command") {
    guests[0].execute.mockImplementation(() => new Promise(() => {}));
    state.commands.push({ id: "slow", operation: "evaluate", input: {} });
  }
  await vi.advanceTimersByTimeAsync(65_000);
  expect(guests[0].dispose).not.toHaveBeenCalled();
  expect(rpc.mock.calls.some(([contract]) => contract.name === "native.release")).toBe(false);
});

it("respects relay refusal when remote work arrives during idle collection", async () => {
  const { service, rpc } = fixture();
  const implementation = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (contract, input) => contract.name === "native.release"
    ? { released: false } : implementation(contract, input));
  service.attach("workspace", {}, "https://example.test/", () => {})();
  await vi.advanceTimersByTimeAsync(65_000);
  expect(rpc.mock.calls.some(([contract]) => contract.name === "native.release")).toBe(true);
  expect(guests[0].dispose).not.toHaveBeenCalled();
});

it("does not unload a panel reattached while the relay release is in flight", async () => {
  const { service, rpc } = fixture();
  const implementation = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (contract, input) => {
    if (contract.name !== "native.release") return implementation(contract, input);
    service.attach("workspace", {}, "about:blank", () => {});
    return { released: true };
  });
  service.attach("workspace", {}, "https://example.test/", () => {})();
  await vi.advanceTimersByTimeAsync(65_000);
  expect(guests[0].dispose).not.toHaveBeenCalled();
  expect(guests).toHaveLength(1);
});

it("restores a suspended workspace for a remote request without mounting a panel", async () => {
  const { service, rpc } = fixture();
  service.attach("workspace", {}, "https://example.test/", () => {})();
  await vi.advanceTimersByTimeAsync(62_000);
  expect(guests[0].dispose).toHaveBeenCalledTimes(1);
  const implementation = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (contract, input) => contract.name === "native.presence"
    ? { workspaceIds: [], requestedWorkspaceIds: ["workspace"] }
    : implementation(contract, input));
  service.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(guests).toHaveLength(2);
  expect(guests[1].state()).toEqual({ browserId: "guest-0", url: "https://example.test/" });
  expect(guests[1].present).toHaveBeenLastCalledWith(null);
});

it("ignores a late exchange reply after the service has stopped", async () => {
  const { service, rpc } = fixture();
  let respond!: (value: unknown) => void;
  rpc.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
  service.attach("workspace", {}, "https://example.test/", () => {});
  service.dispose();
  respond({ accepted: true, streaming: false, controller: null,
    commands: [{ id: "late", operation: "tabs.create", input: {} }] });
  await vi.advanceTimersByTimeAsync(65_000);
  expect(guests).toHaveLength(1);
  expect(guests[0].dispose).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(1);
});
