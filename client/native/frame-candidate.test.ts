import { expect, it } from "vitest";
import { nativeFrameCandidate } from "./frame-candidate";
import { createBrowserFrameBuffer } from "../workspace/browser-frame-buffer";
import type { NativeFrame } from "../../shared/native/contracts";
const frame = (sequence: number, pixels = String(sequence)): NativeFrame => ({
  sequence, data: `data:image/jpeg;base64,${pixels}`, capturedAt: 1000 + sequence,
  width: 1280, height: 800, generation: 7, browserId: "native-tab",
});

it("retains the decoded native frame while replacements load or fail", () => {
  const buffer = createBrowserFrameBuffer();
  const first = buffer.offer(nativeFrameCandidate(frame(1), "workspace/viewer"));
  expect(first.front).toBeNull();
  buffer.settle(first.layers[first.pending!]!.ticket, true, () => true);
  const pending = buffer.offer(nativeFrameCandidate(frame(2), "workspace/viewer"));
  expect(pending.layers[pending.front!]!.candidate.frame.frameId).toBe("1");
  buffer.offer(nativeFrameCandidate(frame(3), "workspace/viewer"));
  const failed = buffer.settle(pending.layers[pending.pending!]!.ticket, false, () => true);
  expect(failed.layers[failed.front!]!.candidate.frame.frameId).toBe("1");
  const ready = buffer.settle(failed.layers[failed.pending!]!.ticket, true, () => true);
  expect(ready.layers[ready.front!]!.candidate.frame.frameId).toBe("3");
});

it("updates native input authority without reloading identical JPEG pixels", () => {
  const buffer = createBrowserFrameBuffer();
  const first = buffer.offer(nativeFrameCandidate(frame(1, "same"), "workspace/viewer"));
  buffer.settle(first.layers[first.pending!]!.ticket, true, () => true);
  const original = buffer.snapshot().layers[buffer.snapshot().front!]!;
  const next = buffer.offer(nativeFrameCandidate(frame(2, "same"), "workspace/viewer"));
  expect(next.pending).toBeNull();
  expect(next.layers[next.front!]!.source).toBe(original.source);
  expect(next.layers[next.front!]!.candidate.frame).toMatchObject({
    frameId: "2", sessionId: "native-tab", navigationGeneration: 7,
  });
});
