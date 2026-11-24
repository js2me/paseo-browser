import { afterEach, expect, it, vi } from "vitest";
import { NativeRelay } from "./relay";
const relays: NativeRelay[] = [];
afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
  vi.useRealTimers();
});
const state = {
  browserId: "native-one",
  url: "https://example.test/",
  title: "Shared native page",
  width: 1280,
  height: 800,
  generation: 1,
  canGoBack: false,
  canGoForward: false,
  cdp: true,
};
const desktop = "desktop-owner-123456";
const phone = "phone-viewer-123456";
function fixture(now?: () => number) {
  const relay = new NativeRelay(now);
  relays.push(relay);
  return relay;
}
function exchange(
  relay: NativeRelay,
  results: Array<{ id: string; result?: unknown; error?: string }> = [],
) {
  return relay.exchange({
    clientId: desktop,
    workspaceId: "workspace",
    state,
    frame: null,
    results,
  });
}
it("broadcasts the exact registered native guest and requests capture only while a viewer is watching", () => {
  const relay = fixture(() => 1000);
  expect(exchange(relay).streaming).toBe(false);
  expect(relay.watch("workspace", phone, 0).state).toEqual(state);
  const frame = {
    sequence: 1,
    capturedAt: 1000,
    data: "data:image/jpeg;base64,/9j/",
    width: 1280,
    height: 800,
    generation: 1,
    browserId: "native-one",
  };
  expect(
    relay.exchange({ clientId: desktop, workspaceId: "workspace", state, frame, results: [] })
      .streaming,
  ).toBe(true);
  expect(relay.watch("workspace", phone, 0).frame).toEqual(frame);
  expect(relay.watch("workspace", phone, 1).frame).toBeNull();
  const other = relay.exchange({
    clientId: "other-desktop-123456",
    workspaceId: "workspace",
    state: { ...state, browserId: "independent" },
    frame: null,
    results: [],
  });
  expect(other.accepted).toBe(false);
  expect(relay.watch("workspace", phone, 0).state?.browserId).toBe("native-one");
});
it("orders agent and human commands without acquiring or transferring control", async () => {
  const relay = fixture();
  exchange(relay);
  const first = relay.command("workspace", "agent", "evaluate", { expression: "1" });
  const human = relay.command("workspace", phone, "navigate", { url: "https://example.test" });
  const last = relay.command("workspace", "agent", "evaluate", { expression: "2" });
  const command = exchange(relay).commands[0];
  expect(command.input).toEqual({ expression: "1" });
  expect(exchange(relay).commands).toEqual([]);
  const second = exchange(relay, [{ id: command.id, result: 1 }]).commands[0];
  expect(await first).toBe(1);
  expect(second.operation).toBe("navigate");
  const third = exchange(relay, [{ id: second.id, result: {} }]).commands[0];
  await human;
  expect(third.input).toEqual({ expression: "2" });
  exchange(relay, [{ id: third.id, result: 2 }]);
  expect(await last).toBe(2);
});
it("binds a short cursor call to the page selected when the command is queued", async () => {
  const relay = fixture();
  await expect(relay.command("workspace", "agent", "cursor", { x: 10, y: 20 }))
    .rejects.toThrow("No native page is ready");
  exchange(relay);
  const cursor = relay.command("workspace", "agent", "cursor", { ref: "@e1", action: "click" });
  const command = relay.exchange({
    clientId: desktop, workspaceId: "workspace", state: { ...state, generation: 2 },
    frame: null, results: [],
  }).commands[0];
  expect(command.input).toEqual({
    ref: "@e1", action: "click", browserId: state.browserId, generation: state.generation,
  });
  exchange(relay, [{ id: command.id, result: {} }]);
  await cursor;
});
it("invalidates a lost desktop and never replays a published mutation on another desktop", async () => {
  let now = 1000;
  const relay = fixture(() => now);
  exchange(relay);
  await relay.control("workspace", "agent", false, "acquire");
  const result = relay.command("workspace", "agent", "evaluate", {}).then(
    () => null,
    (error) => error.message,
  );
  expect(exchange(relay).commands).toHaveLength(1);
  now += 5001;
  expect(relay.watch("workspace", phone, 0).connected).toBe(false);
  expect(await result).toMatch(/may have completed/);
  expect(exchange(relay).commands).toEqual([]);
});

it("reopens a local Desktop only for an explicit undispatched site opening", async () => {
  vi.useFakeTimers();
  const wake=vi.fn().mockResolvedValue(true);
  const relay=new NativeRelay(Date.now,wake);relays.push(relay);
  await relay.command("workspace","agent","status");
  await vi.advanceTimersByTimeAsync(3000);
  expect(wake).not.toHaveBeenCalled();
  const opening=relay.command("workspace","agent","open",{url:"https://example.test/"});
  await vi.advanceTimersByTimeAsync(1999);expect(wake).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(wake).toHaveBeenCalledOnce();
  const command=exchange(relay).commands[0];
  expect(command.operation).toBe("open");
  expect(exchange(relay).commands).toEqual([]);
  exchange(relay,[{id:command.id,result:{opened:true}}]);await opening;
});

it("does not launch a GUI for mobile presence or while a connected Desktop cold-starts a tab", async () => {
  vi.useFakeTimers();
  const wake=vi.fn().mockResolvedValue(true);
  const relay=new NativeRelay(()=>1000,wake);relays.push(relay);
  relay.watch("workspace",phone,0);relay.presence();
  await vi.advanceTimersByTimeAsync(3000);expect(wake).not.toHaveBeenCalled();
  exchange(relay);
  const opening=relay.command("workspace","agent","open",{url:"https://example.test/"});
  await vi.advanceTimersByTimeAsync(2500);expect(wake).not.toHaveBeenCalled();
  const command=exchange(relay).commands[0];
  exchange(relay,[{id:command.id,result:{opened:true}}]);await opening;
  await vi.advanceTimersByTimeAsync(4000);expect(wake).not.toHaveBeenCalled();
});

it("waits for a closed Desktop's last heartbeat to expire before reopening it", async () => {
  vi.useFakeTimers();
  const wake=vi.fn().mockResolvedValue(true);
  const relay=new NativeRelay(Date.now,wake);relays.push(relay);
  exchange(relay);
  const opening=relay.command("workspace","agent","open",{url:"https://example.test/"});
  await vi.advanceTimersByTimeAsync(5000);expect(wake).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);expect(wake).toHaveBeenCalledOnce();
  const command=exchange(relay).commands[0];
  expect(command.operation).toBe("open");
  expect(exchange(relay).commands).toEqual([]);
  exchange(relay,[{id:command.id,result:{opened:true}}]);
  expect(await opening).toEqual({opened:true});
});
it("scopes HTTP credentials to their agent and workspace and refuses unauthenticated requests", async () => {
  const relay = fixture();
  await relay.listen();
  exchange(relay);
  const ticket = relay.ticket("workspace", "agent");
  expect((await fetch(ticket.url, { method: "POST", body: "{}" })).status).toBe(401);
  const reply = await fetch(ticket.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${ticket.token}` },
    body: JSON.stringify({ operation: "status" }),
  });
  expect(await reply.json()).toEqual({ result: { state, connected: true, controller: null } });
  const other = relay.ticket("other-workspace", "other-agent");
  const result = await fetch(other.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${other.token}` },
    body: JSON.stringify({ operation: "status" }),
  });
  expect(await result.json()).toEqual({
    result: { state: null, connected: false, controller: null },
  });
});

it("waits for the native guest to be ready before dispatching the first navigation", async () => {
  const relay = fixture();
  const pending = relay.command("workspace", "agent", "open", { url: "https://example.test/" });
  expect(
    relay.exchange({
      clientId: desktop,
      workspaceId: "workspace",
      state: null,
      frame: null,
      results: [],
    }).commands,
  ).toEqual([]);
  const command = exchange(relay).commands[0];
  expect(command.operation).toBe("open");
  exchange(relay, [{ id: command.id, result: { opened: true } }]);
  expect(await pending).toEqual({ opened: true });
});

it('uses host receipt time for remote desktop frames instead of assuming synchronized machine clocks',()=>{
 const relay=fixture(()=>1_000_000);exchange(relay);
 const frame={sequence:1,capturedAt:100,data:'data:image/jpeg;base64,/9j/',width:1280,height:800,generation:1,browserId:'native-one'};
 relay.exchange({clientId:desktop,workspaceId:'workspace',state,frame,results:[]});
 expect(relay.watch('workspace',phone,0).frame).toEqual(frame);
});

it('does not renew frame freshness from desktop heartbeats or rejected frame replays', () => {
  let now = 10_000;
  const relay = fixture(() => now);
  const frame = { sequence: 1, capturedAt: now, data: 'data:image/jpeg;base64,/9j/', width: 1280, height: 800, generation: 1, browserId: 'native-one' };
  relay.exchange({ clientId: desktop, workspaceId: 'workspace', state, frame, results: [] });
  now += 1600;
  exchange(relay);
  expect(relay.watch('workspace', phone, 0).frame).toBeNull();
  relay.exchange({ clientId: desktop, workspaceId: 'workspace', state, frame, results: [] });
  expect(relay.watch('workspace', phone, 0).frame).toBeNull();
  relay.exchange({ clientId: desktop, workspaceId: 'workspace', state, frame: { ...frame, sequence: 2 }, results: [] });
  expect(relay.watch('workspace', phone, 0).frame?.sequence).toBe(2);
});


it('announces mobile viewer demand before a desktop browser exists', () => {
  let now = 10_000;
  const relay = fixture(() => now);
  relay.watch('phone-only-workspace', phone, 0);
  expect(relay.presence()).toEqual({ workspaceIds: [], requestedWorkspaceIds: ['phone-only-workspace'] });
  now += 3000;
  expect(relay.presence().requestedWorkspaceIds).toEqual([]);
});

it("allows event reads and dialog replies while an earlier command waits, retaining ordinary action ordering", async () => {
  const relay = fixture();
  exchange(relay);
  await relay.control("workspace", "agent", false, "acquire");
  const evaluating = relay.command("workspace", "agent", "cdp_send", { method: "Runtime.evaluate" });
  const evaluation = exchange(relay).commands[0];
  const navigating = relay.command("workspace", "agent", "navigate", {});
  const reading = relay.command("workspace", "agent", "cdp_events", {});
  const events = exchange(relay).commands[0];
  expect(events.operation).toBe("cdp_events");
  exchange(relay, [{ id: events.id, result: { events: [] } }]);
  await reading;
  const inspecting = relay.command("workspace", "agent", "cdp_send", { method: "Debugger.evaluateOnCallFrame", params: { callFrameId: "frame", expression: "local" } });
  const inspection = exchange(relay).commands[0];
  expect(inspection.input.method).toBe("Debugger.evaluateOnCallFrame");
  exchange(relay, [{ id: inspection.id, result: { result: { value: 42 } } }]);
  expect(await inspecting).toEqual({ result: { value: 42 } });
  const replying = relay.command("workspace", "agent", "browser_dialog", { accept: false });
  const reply = exchange(relay).commands[0];
  expect(reply.operation).toBe("browser_dialog");
  exchange(relay, [{ id: reply.id, result: {} }]);
  await replying;
  const next = exchange(relay, [{ id: evaluation.id, result: {} }]).commands[0];
  await evaluating;
  expect(next.operation).toBe("navigate");
  exchange(relay, [{ id: next.id, result: {} }]);
  await navigating;
});

it("keeps commands ordered while legacy control calls remain compatible", async () => {
  const relay = fixture();
  exchange(relay);
  await relay.control("workspace", "agent", false, "acquire");
  const evaluating = relay.command("workspace", "agent", "cdp_send", { method: "Runtime.evaluate" });
  const evaluation = exchange(relay).commands[0];
  const inspecting = relay.command("workspace", "agent", "cdp_send", { method: "Debugger.evaluateOnCallFrame" });
  const inspection = exchange(relay).commands[0];
  expect(inspection.input.method).toBe("Debugger.evaluateOnCallFrame");
  const takeover = relay.control("workspace", phone, true, "acquire");
  exchange(relay, [{ id: evaluation.id, result: 42 }]);
  await evaluating;
  await Promise.resolve();
  expect(relay.watch("workspace", phone, 0).controller).toBe(phone);
  expect(exchange(relay).commands).toEqual([]);
  exchange(relay, [{ id: inspection.id, result: {} }]);
  await inspecting;
  expect(await takeover).toEqual({ controller: phone });
});

it("keeps timed-out execution tracked while participants continue to share control", async () => {
  vi.useFakeTimers();
  const relay = fixture(() => 1000);
  exchange(relay);
  await relay.control("workspace", "agent", false, "acquire");
  const result = relay.command("workspace", "agent", "cdp_send", { method: "Runtime.evaluate" })
    .catch((error: Error) => error.message);
  const command = exchange(relay).commands[0];
  let tookControl = false;
  const takeover = relay.control("workspace", phone, true, "acquire").then((result) => {
    tookControl = true;
    return result;
  });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await result).toContain("timed out");
  expect(tookControl).toBe(true);
  expect(relay.watch("workspace", phone, 0).controller).toBe(phone);
  expect(exchange(relay).commands).toEqual([]);
  exchange(relay, [{ id: command.id, result: { finished: true } }]);
  expect(await takeover).toEqual({ controller: phone });
});

it("removes an undispatched timeout without blocking human control", async () => {
  vi.useFakeTimers();
  const relay = fixture(() => 1000);
  exchange(relay);
  await relay.control("workspace", "agent", false, "acquire");
  const result = relay.command("workspace", "agent", "navigate", { url: "https://example.test" })
    .catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await result).toContain("timed out");
  expect(await relay.control("workspace", phone, true, "acquire")).toEqual({ controller: phone });
  expect(exchange(relay).commands).toEqual([]);
});

it.each([
  ["browser_dialog", { accept: false }],
  ["cdp_send", { method: "Debugger.resume" }],
])("dispatches %s from a participant while paused execution blocks ordinary queued work", async (operation, input) => {
  vi.useFakeTimers();
  let now = 1000;
  const relay = fixture(() => now);
  exchange(relay);
  await relay.control("workspace", "agent", false, "acquire");
  const evaluating = relay.command("workspace", "agent", "cdp_send", { method: "Runtime.evaluate" })
    .catch((error: Error) => error.message);
  const evaluation = exchange(relay).commands[0];
  const takeover = relay.control("workspace", phone, true, "acquire");
  for (let heartbeat = 0; heartbeat < 8; heartbeat++) {
    now += 4000;
    await vi.advanceTimersByTimeAsync(4000);
    expect(exchange(relay).commands).toEqual([]);
  }
  expect(await evaluating).toContain("timed out");
  const navigating = relay.command("workspace", "agent", "navigate", {})
    .catch((error: Error) => error.message);
  const replying = relay.command("workspace", "agent", operation, input);
  const reply = exchange(relay).commands[0];
  expect(reply.operation).toBe(operation);
  expect(reply.input).toEqual(input);
  exchange(relay, [{ id: evaluation.id, result: {} }]);
  await Promise.resolve();
  expect(relay.watch("workspace", phone, 0).controller).toBeNull();
  const next = exchange(relay, [{ id: reply.id, result: {} }]).commands[0];
  await replying;
  expect(await takeover).toEqual({ controller: phone });
  expect(next.operation).toBe("navigate");
  exchange(relay, [{ id: next.id, result: {} }]);
  expect(await navigating).toEqual({});
});
