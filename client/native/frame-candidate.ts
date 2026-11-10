import type { NativeFrame } from "../../shared/native/contracts";
import type { FrameCandidate } from "../workspace/browser-frame-buffer";

/** Reuse the decoded-frame handoff used by the legacy viewer for native broadcasts. */
export function nativeFrameCandidate(frame: NativeFrame, viewerToken: string): FrameCandidate {
  const dataBase64 = frame.data.slice("data:image/jpeg;base64,".length);
  return {
    viewerToken,
    mutationEpoch: 0,
    frame: {
      sessionId: frame.browserId,
      frameId: String(frame.sequence),
      mimeType: "image/jpeg",
      transport: "cdp-screencast",
      dataBase64,
      byteLength: Math.floor(dataBase64.length * 3 / 4),
      width: frame.width,
      height: frame.height,
      navigationGeneration: frame.generation,
      viewportGeneration: 0,
      capturedAt: new Date(frame.capturedAt).toISOString(),
    },
  };
}
