import { afterEach, expect, it } from "vitest";
import { NativeRelay } from "./relay";
const relays: NativeRelay[] = [];
afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
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
it("dispatches once, queues human takeover behind native execution, then fences queued agent actions", async () => {
  const relay = fixture();
  exchange(relay);
  await relay.control("workspace", "agent", false, "acquire");
  const first = relay.command("workspace", "agent", "evaluate", { expression: "1" });
  const queued = relay.command("workspace", "agent", "evaluate", { expression: "2" }).then(
    () => null,
    (error) => error.message,
  );
  const command = exchange(relay).commands[0];
  expect(command.input).toEqual({ expression: "1" });
  expect(exchange(relay).commands).toEqual([]);
  let tookControl = false;
  const takeover = relay.control("workspace", phone, true, "acquire").then(() => {
    tookControl = true;
  });
  await Promise.resolve();
  expect(tookControl).toBe(false);
  exchange(relay, [{ id: command.id, result: 1 }]);
  expect(await first).toBe(1);
  await takeover;
  exchange(relay);
  expect(await queued).toMatch(/control changed/);
  await expect(
    relay.command("workspace", "agent", "cdp_send", { method: "Network.enable" }),
  ).rejects.toThrow(/control/);
  await expect(
    relay.command("workspace", "agent", "open", { url: "https://wrong.test" }),
  ).rejects.toThrow(/controlled/);
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
