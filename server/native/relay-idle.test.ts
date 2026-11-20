import { afterEach, expect, it, vi } from "vitest";
import { NativeRelay } from "./relay";

const relays: NativeRelay[] = [];
afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
  vi.useRealTimers();
});
const owner = "desktop-owner-123456";
function fixture() {
  vi.useFakeTimers();
  const relay = new NativeRelay();
  relays.push(relay);
  relay.exchange({ clientId: owner, workspaceId: "workspace", state: null, frame: null, results: [] });
  return relay;
}
it("releases idle ownership immediately and admits a fresh remote request", async () => {
  const relay = fixture();
  expect(relay.release("workspace", "other")).toEqual({ released: false });
  expect(relay.release("workspace", owner)).toEqual({ released: true });
  expect(relay.presence().workspaceIds).toEqual([]);
  const opening = relay.command("workspace", "agent", "open", {});
  expect(relay.presence().requestedWorkspaceIds).toEqual(["workspace"]);
  await relay.close();
  await expect(opening).rejects.toThrow("stopped");
});
it("does not release ownership while a viewer is watching", () => {
  const relay = fixture();
  relay.watch("workspace", "phone", 0);
  expect(relay.release("workspace", owner)).toEqual({ released: false });
});
it("does not release ownership with queued commands", async () => {
  const relay = fixture();
  const opening = relay.command("workspace", "agent", "open", {});
  expect(relay.release("workspace", owner)).toEqual({ released: false });
  await relay.close();
  await expect(opening).rejects.toThrow("stopped");
});
