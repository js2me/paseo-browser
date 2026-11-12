import { isBrowserAction, runBrowserAction } from "../../shared/browser-actions";
/**
 * Web-only input and video adapters for the native View's DOM host node. No DOM globals or
 * handlers leak into the cross-platform panel. Non-passive wheel/touch listeners
 * capture only a controlled image canvas; document mouse listeners preserve drags outside
 * its rectangle and visibility/blur immediately cancels held remote input.
 */
import { Platform } from "react-native";
import type { BrowserCursor } from "../../shared/workspace/browser";
import type { createBrowserCanvasInput } from "./browser-canvas-input";

type CanvasInput = ReturnType<typeof createBrowserCanvasInput>;
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface DomTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}
interface DomEvent {
  clientX?: number;
  clientY?: number;
  button?: number;
  detail?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  touches?: ArrayLike<DomTouch>;
  sourceCapabilities?: { firesTouchEvents?: boolean };
  preventDefault(): void;
  stopPropagation(): void;
}
export interface BrowserCanvasNode {
  getBoundingClientRect(): Rect;
  addEventListener(
    type: string,
    listener: (event: DomEvent) => void,
    options?: { passive: boolean },
  ): void;
  removeEventListener(type: string, listener: (event: DomEvent) => void): void;
  style: { cursor: string; touchAction: string };
  ownerDocument: {
    hidden: boolean;
    addEventListener(
      type: string,
      listener: (event: DomEvent) => void,
      options?: { passive?: boolean; capture?: boolean },
    ): void;
    removeEventListener(
      type: string,
      listener: (event: DomEvent) => void,
      options?: { capture?: boolean },
    ): void;
    defaultView: {
      addEventListener(type: string, listener: () => void): void;
      removeEventListener(type: string, listener: () => void): void;
    } | null;
  };
}

/** Bind real web envelopes only on web; native touch uses the responder adapter. */
export function bindBrowserCanvasWeb(
  node: BrowserCanvasNode,
  input: CanvasInput,
  enabled: () => boolean,
  onCursorVisibility: (visible: boolean) => void,
) {
  if (Platform.OS !== "web") return () => {};
  const previousTouchAction = node.style.touchAction;
  node.style.touchAction = "none";
  const listeners = new Map<string, (event: DomEvent) => void>();
  const point = (x = 0, y = 0) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(rect.width, x - rect.left)),
      y: Math.max(0, Math.min(rect.height, y - rect.top)),
      width: rect.width,
      height: rect.height,
    };
  };
  const listen = (type: string, listener: (event: DomEvent) => void) => {
    listeners.set(type, listener);
    node.addEventListener(type, listener, { passive: false });
  };
  const consume = (event: DomEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  // Snapshot actual pointer modifiers even when the key was pressed before
  // this canvas acquired focus. Do not fabricate remote keyboard edges.
  const modifiers = (event: DomEvent) =>
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0);
  let touchActive = false;
  const mouse = (type: "move" | "down" | "up", event: DomEvent) => {
    // Consumed touch events suppress compatibility mouse events in browsers.
    // Chromium also explicitly identifies them; never forward a second tap.
    if (touchActive || event.sourceCapabilities?.firesTouchEvents || !enabled()) {
      return;
    }
    const location = point(event.clientX, event.clientY);
    if (!location) return;
    onCursorVisibility(true);
    const button = event.button === 2 ? "right" : event.button === 1 ? "middle" : "left";
    const count = event.detail === 2 ? 2 : 1;
    if (type === "down") {
      if (input.mouseDown(location, button, count, modifiers(event))) consume(event);
    } else if (type === "up") {
      if (input.mouseUp(location, button, count, modifiers(event))) consume(event);
    } else {
      const held = input.isHoldingMouse();
      input.mouseMove(location, modifiers(event));
      if (held) consume(event);
    }
  };
  // MouseEvent.detail carries physical double-click counts. PointerEvent.detail
  // commonly stays zero. Only mouse events publish input, avoiding duplicate edges.
  listen("mousedown", (event) => mouse("down", event));
  listen("mousemove", (event) => mouse("move", event));
  listen("mouseup", (event) => mouse("up", event));
  listen("mouseleave", () => {
    onCursorVisibility(false);
    input.leave();
    node.style.cursor = "default";
  });
  listen("pointercancel", () => input.cancel());
  const isOutside = (event: DomEvent) => {
    const rect = node.getBoundingClientRect();
    return (
      event.clientX === undefined ||
      event.clientY === undefined ||
      event.clientX < rect.left ||
      event.clientX > rect.left + rect.width ||
      event.clientY < rect.top ||
      event.clientY > rect.top + rect.height
    );
  };
  const outsideMove = (event: DomEvent) => {
    if (input.isHoldingMouse()) {
      mouse("move", event);
      onCursorVisibility(!isOutside(event));
    }
  };
  const outsideUp = (event: DomEvent) => {
    if (input.isHoldingMouse()) {
      mouse("up", event);
      const outside = isOutside(event);
      onCursorVisibility(!outside);
      if (outside) input.leave();
    }
  };
  node.ownerDocument.addEventListener("mousemove", outsideMove);
  node.ownerDocument.addEventListener("mouseup", outsideUp);
  listen("contextmenu", (event) => {
    if (enabled()) consume(event);
  });
  listen("wheel", (event) => {
    if (!enabled()) return;
    const location = point(event.clientX, event.clientY);
    if (!location) return;
    // Wheel deltaMode is local CSS pixels, lines, or pages. Line-mode uses the
    // browser's conventional 16 CSS-pixel step; page mode uses this image's size.
    const multiplierX = event.deltaMode === 2 ? location.width : event.deltaMode === 1 ? 16 : 1;
    const multiplierY = event.deltaMode === 2 ? location.height : event.deltaMode === 1 ? 16 : 1;
    if (
      input.wheel(
        location,
        (event.deltaX ?? 0) * multiplierX,
        (event.deltaY ?? 0) * multiplierY,
        modifiers(event),
      )
    ) {
      consume(event);
    }
  });
  const documentTouchListeners = new Map<string, (event: DomEvent) => void>();
  for (const phase of ["start", "move", "end", "cancel"] as const) {
    // An observe-only overlay has pointerEvents:none. Track only contacts that
    // start over its image (without consuming them), so acquiring control mid-
    // contact cannot turn a later move/second finger into a remote fresh press.
    const trackUncontrolledContact = (event: DomEvent) => {
      const rect = node.getBoundingClientRect();
      const touches = Array.from(event.touches ?? []);
      const overImage = touches.some(
        (touch) =>
          touch.clientX >= rect.left &&
          touch.clientX <= rect.left + rect.width &&
          touch.clientY >= rect.top &&
          touch.clientY <= rect.top + rect.height,
      );
      if (input.isTouchQuarantined() || (!enabled() && overImage)) {
        const points = touches
          .map((touch) => {
            const location = point(touch.clientX, touch.clientY);
            return location ? { ...location, id: touch.identifier } : null;
          })
          .filter((item) => item !== null);
        input.touch(phase, points);
      }
    };
    documentTouchListeners.set(`touch${phase}`, trackUncontrolledContact);
    node.ownerDocument.addEventListener(`touch${phase}`, trackUncontrolledContact, {
      capture: true,
      passive: true,
    });
    listen(`touch${phase}`, (event) => {
      touchActive = phase !== "cancel" && (event.touches?.length ?? 0) > 0;
      const points = Array.from(event.touches ?? []).map((touch) => {
        const location = point(touch.clientX, touch.clientY);
        return location ? { ...location, id: touch.identifier } : null;
      });
      if (points.some((item) => !item)) {
        input.cancel();
        return;
      }
      const accepted = input.touch(
        phase,
        points.filter((item) => item !== null),
      );
      if (accepted && enabled()) {
        consume(event);
      }
    });
  }
  const cancel = () => {
    onCursorVisibility(false);
    touchActive = false;
    input.cancel();
    node.style.cursor = "default";
  };
  const visibility = () => {
    if (node.ownerDocument.hidden) cancel();
  };
  node.ownerDocument.addEventListener("visibilitychange", visibility);
  node.ownerDocument.defaultView?.addEventListener("blur", cancel);
  return () => {
    cancel();
    for (const [type, listener] of listeners) {
      node.removeEventListener(type, listener);
    }
    for (const [type, listener] of documentTouchListeners) {
      node.ownerDocument.removeEventListener(type, listener, { capture: true });
    }
    node.ownerDocument.removeEventListener("visibilitychange", visibility);
    node.ownerDocument.removeEventListener("mousemove", outsideMove);
    node.ownerDocument.removeEventListener("mouseup", outsideUp);
    node.ownerDocument.defaultView?.removeEventListener("blur", cancel);
    node.style.touchAction = previousTouchAction;
  };
}

/** Cursor enums originate from the guarded remote response, never custom URLs. */
export function setBrowserCanvasCursor(node: unknown, cursor: BrowserCursor | null): void {
  if (Platform.OS === "web" && node && typeof node === "object" && "style" in node) {
    (node as BrowserCanvasNode).style.cursor = cursor ?? "default";
  }
}

/** Public web codec boundary. Native clients never read browser constructors. */
export function supportsBrowserVideo(): boolean {
  if (Platform.OS !== "web") return false;
  return typeof VideoDecoder !== "undefined" && typeof EncodedVideoChunk !== "undefined";
}

declare const VideoDecoder: {
  new (callbacks: {
    output(frame: import("./browser-video-decoder").DecodedBrowserVideoFrame): void;
    error(error: unknown): void;
  }): import("./browser-video-decoder").BrowserVideoCodec & {
    addEventListener(type: "dequeue", listener: () => void): void;
  };
};
declare const EncodedVideoChunk: {
  new (input: { type: "key" | "delta"; timestamp: number; data: Uint8Array }): unknown;
};
declare function atob(data: string): string;

interface VideoCanvasElement {
  width: number;
  height: number;
  style: { width: string; height: string; display: string };
  getContext(kind: "2d"): {
    drawImage(frame: unknown, x: number, y: number): void;
  } | null;
  remove(): void;
}
export interface BrowserVideoCanvasNode {
  getClientRects(): ArrayLike<unknown>;
  appendChild(child: VideoCanvasElement): void;
  ownerDocument: {
    createElement(kind: "canvas"): VideoCanvasElement;
    hidden?: boolean;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    defaultView: {
      IntersectionObserver: new (callback: (entries: { isIntersecting: boolean }[]) => void) => {
        observe(node: BrowserVideoCanvasNode): void;
        disconnect(): void;
      };
      requestAnimationFrame(callback: () => void): number;
      cancelAnimationFrame(id: number): void;
      addEventListener(type: string, listener: () => void): void;
      removeEventListener(type: string, listener: () => void): void;
    } | null;
  };
}

/** Decode validated packet bytes without a per-character callback or intermediate
 * binary string on modern clients. Older web clients retain an exact byte loop.
 * This web adapter is never evaluated as a native phone video implementation. */
export function decodeBrowserVideoBytes(data: string): Uint8Array {
  const bytes = Uint8Array as typeof Uint8Array & { fromBase64?(value: string): Uint8Array };
  if (typeof bytes.fromBase64 === "function") return bytes.fromBase64(data);

  const binary = atob(data);
  const decoded = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    decoded[index] = binary.charCodeAt(index);
  }
  return decoded;
}

/** Create one retained canvas; every decoded VideoFrame is drawn before its authority is admitted. */
export function createBrowserVideoEnvironment(node: BrowserVideoCanvasNode) {
  if (!supportsBrowserVideo()) return null;
  const canvas = node.ownerDocument.createElement("canvas");
  const context = canvas.getContext("2d");
  const view = node.ownerDocument.defaultView;
  if (!context || !view) return null;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  node.appendChild(canvas);
  const environment: import("./browser-video-decoder").BrowserVideoDecodeEnvironment = {
    createDecoder(callbacks) {
      const decoder = new VideoDecoder(callbacks);
      decoder.addEventListener("dequeue", callbacks.dequeue);
      return decoder;
    },
    createChunk: (input) => new EncodedVideoChunk(input),
    decodeBase64(data) {
      return decodeBrowserVideoBytes(data);
    },
    scheduleDraw(draw) {
      const id = view.requestAnimationFrame(draw);
      return () => view.cancelAnimationFrame(id);
    },
    draw(frame) {
      if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
      if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
      context.drawImage(frame, 0, 0);
    },
  };
  return { environment, dispose: () => canvas.remove() };
}

/** Observe the actual canvas document, including page-cache suspension. The
 * initial callback is synchronous; cleanup never synthesizes a resume. */
export function bindBrowserVideoVisibility(
  node: BrowserVideoCanvasNode,
  onActive: (active: boolean) => void,
) {
  const document = node.ownerDocument;
  const view = document.defaultView;
  let suspended = false;
  let intersecting = node.getClientRects().length > 0;
  const changed = () => onActive(!document.hidden && !suspended && intersecting);
  const observer = view
    ? new view.IntersectionObserver((entries) => {
        intersecting = entries.some((entry) => entry.isIntersecting);
        changed();
      })
    : null;
  observer?.observe(node);
  const hide = () => {
    suspended = true;
    changed();
  };
  const show = () => {
    suspended = false;
    changed();
  };
  document.addEventListener("visibilitychange", changed);
  view?.addEventListener("pagehide", hide);
  view?.addEventListener("pageshow", show);
  changed();
  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", changed);
    view?.removeEventListener("pagehide", hide);
    view?.removeEventListener("pageshow", show);
  };
}

// Native plugin webviews use the same validated guest registration as Paseo's built-in panes.
interface NativeDesktopBrowserApi {
  nativeBridgeVersion?: number;
  profilePartition: string;
  registerAttachedBrowser(input: {
    browserId: string;
    workspaceId: string;
    webContentsId: number;
  }): Promise<unknown>;
  unregisterWorkspaceBrowser(browserId: string): Promise<unknown>;
  executeAutomationCommand(
    input: unknown,
  ): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
  captureNativeFrame?(input: {
    browserId: string;
    workspaceId: string;
    notBefore?: number;
  }): Promise<{ data: string; width: number; height: number; capturedAt: number } | null>;
  sendNativeCommand?(input: {
    browserId: string;
    workspaceId: string;
    method: string;
    params: Record<string, unknown>;
  }): Promise<unknown>;
  readNativeEvents?(input: {
    browserId: string;
    workspaceId: string;
    method?: string;
    clear?: boolean;
  }): Promise<unknown>;
}
export function nativeDesktopBrowserApi(): NativeDesktopBrowserApi | null {
  if (Platform.OS !== "web") return null;
  const host = (globalThis as unknown as { paseoDesktop?: { browser?: NativeDesktopBrowserApi } })
    .paseoDesktop?.browser;
  return host && typeof host.registerAttachedBrowser === "function" ? host : null;
}
interface NativeGuest {
  style: Record<string, string>;
  getBoundingClientRect(): { width: number; height: number };
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, listener: () => void): void;
  remove(): void;
  getWebContentsId(): number;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  openDevTools(options: { mode: "detach"; activate: boolean }): void;
  executeJavaScript(code: string): Promise<unknown>;
  capturePage(): Promise<{
    getSize(): { width: number; height: number };
    toJPEG(quality: number): Uint8Array;
    resize(size: { width: number }): {
      getSize(): { width: number; height: number };
      toJPEG(quality: number): Uint8Array;
    };
  }>;
  sendInputEvent(input: Record<string, unknown>): void;
  insertText(text: string): Promise<void>;
  focus(): void;
}

/** Encode a stock desktop's main-process screenshot for remote viewers only. */
async function encodeNativeScreenshot(document: unknown, browserId: string, value: unknown) {
  const image = value as {
    browserId?: string; mimeType?: string; dataBase64?: string; width?: number; height?: number;
  } | null;
  if (!image || image.browserId !== browserId || image.mimeType !== "image/png" ||
    typeof image.dataBase64 !== "string" || image.dataBase64.length > 32_000_000 ||
    !/^[A-Za-z0-9+/=]+$/.test(image.dataBase64))
    throw Error("Desktop returned an invalid browser screenshot");
  type ScreenshotImage = {
    src: string; naturalWidth: number; naturalHeight: number; decode(): Promise<void>;
  };
  type ScreenshotCanvas = {
    width: number; height: number;
    getContext(kind: "2d"): {
      fillStyle: string;
      fillRect(x: number, y: number, width: number, height: number): void;
      drawImage(image: ScreenshotImage, x: number, y: number, width: number, height: number): void;
    } | null;
    toDataURL(type: string, quality: number): string;
  };
  const captureDocument = document as {
    createElement(kind: "canvas"): ScreenshotCanvas;
    defaultView?: { Image?: new () => ScreenshotImage };
  };
  const Image = captureDocument.defaultView?.Image ??
    (globalThis as unknown as { Image: new () => ScreenshotImage }).Image;
  const decoded = new Image();
  decoded.src = `data:image/png;base64,${image.dataBase64}`;
  await decoded.decode();
  const { naturalWidth: sourceWidth, naturalHeight: sourceHeight } = decoded;
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 || sourceHeight <= 0 || sourceWidth * sourceHeight > 64_000_000)
    throw Error("Desktop screenshot dimensions are invalid");
  const scale = Math.min(1, 1280 / sourceWidth, 960 / sourceHeight);
  const canvas = captureDocument.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw Error("Desktop screenshot encoder is unavailable");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.65);
  if (data.length > 1_100_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data))
    throw Error("Desktop screenshot exceeds the mobile frame size limit");
  return { data, width: canvas.width, height: canvas.height, capturedAt: Date.now() };
}
export interface NativeGuestController {
  openDevTools(): void;
  state(): import("../../shared/native/contracts").NativeState | null;
  capture(sequence: number): Promise<import("../../shared/native/contracts").NativeFrame | null>;
  execute(command: import("../../shared/native/contracts").NativeCommand): Promise<unknown>;
  inputEnabled(enabled: boolean): void;
  present(node: unknown | null): void;
  dispose(): void;
}
export function mountNativeGuest(
  node: unknown,
  workspaceId: string,
  browserId: string,
  onError: (error: string) => void,
  initialUrl = "about:blank",
): NativeGuestController | null {
  const api = nativeDesktopBrowserApi();
  if (!api) return null;
  type Anchor = {
    ownerDocument: {
      createElement(tag: string): NativeGuest;
      body: { appendChild(guest: NativeGuest): void };
    };
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  };
  let host = node as Anchor | null;
  const document = host?.ownerDocument ??
    (globalThis as unknown as { document?: Anchor["ownerDocument"] }).document;
  if (!document) return null;
  const guest = document.createElement("webview");
  guest.setAttribute("partition", api.profilePartition);
  guest.setAttribute("src", /^https?:\/\//.test(initialUrl) ? initialUrl : "about:blank");
  guest.setAttribute("allowpopups", "");
  guest.style.backgroundColor = "#ffffff";
  guest.style.flex = "1";
  guest.style.width = "100%";
  guest.style.height = "100%";
  guest.style.pointerEvents = "none";
  let ready = false;
  let disposed = false;
  let generation = 0;
  let size = { width: 1280, height: 800 };
  let lastCapture = 0;
  let lastFrameReceivedAt = 0;
  let lastStillAttemptAt = -Infinity;
  let lastDesktopScreenshotAt = -Infinity;
  let streamRead: Promise<void> | null = null;
  let streamFrame: { data: string; width: number; height: number; capturedAt: number } | null = null;
  let changedAt = 0;
  const register = async () => {
    try {
      await api.registerAttachedBrowser({
        browserId,
        workspaceId,
        webContentsId: guest.getWebContentsId(),
      });
      if (!disposed) ready = true;
    } catch (error) {
      onError(String(error));
    }
  };
  guest.addEventListener("dom-ready", () => void register());
  guest.addEventListener("did-navigate", () => {
    generation++;
    changedAt = Date.now() + 50;
  });
  let inputEnabled = false;
  let lastBounds = { width: 1280, height: 800 };
  const position = () => {
    const bounds = host?.getBoundingClientRect();
    const visible = Boolean(bounds && bounds.width > 0 && bounds.height > 0);
    if (bounds && visible)
      lastBounds = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    Object.assign(guest.style, {
      position: "fixed",
      left: visible ? `${bounds!.left}px` : "0px",
      top: visible ? `${bounds!.top}px` : "0px",
      width: `${lastBounds.width}px`,
      height: `${lastBounds.height}px`,
      zIndex: visible ? "1" : "-1",
      clipPath: "none",
      pointerEvents: visible && inputEnabled ? "auto" : "none",
    });
  };
  position();
  document.body.appendChild(guest);
  const state = () => {
    if (!ready || disposed) return null;
    try {
      position();
      const bounds = guest.getBoundingClientRect();
      const next = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
      if (next.width !== size.width || next.height !== size.height) {
        generation++;
        changedAt = Date.now() + 50;
      }
      size = next;
      return {
        browserId,
        url: guest.getURL(),
        title: guest.getTitle(),
        width: size.width,
        height: size.height,
        generation,
        canGoBack: guest.canGoBack(),
        canGoForward: guest.canGoForward(),
        cdp:
          typeof api.sendNativeCommand === "function" &&
          typeof api.readNativeEvents === "function",
      };
    } catch {
      return null;
    }
  };
  const cdp = async (method: string, params: Record<string, unknown> = {}) => {
    if (!api.sendNativeCommand)
      throw Error(
        "Full DevTools access requires a Paseo Desktop version with the native DevTools API. Update Paseo Desktop; no plugin patch is needed.",
      );
    return api.sendNativeCommand({ browserId, workspaceId, method, params });
  };
  return {
    state,
    openDevTools() {
      if (!ready || disposed) throw Error("Native browser is not ready");
      guest.openDevTools({ mode: "detach", activate: true });
    },
    async capture(sequence) {
      if (!ready || disposed) return null;
      const before = generation;
      if (!api.captureNativeFrame || !api.sendNativeCommand) {
        // Stock Paseo already captures its native guest in the main process. This
        // lower-rate path never replaces the desktop WebView with a stream.
        const now = Date.now();
        if (now < changedAt || now - lastDesktopScreenshotAt < 200) return null;
        lastDesktopScreenshotAt = now;
        const reply = await api.executeAutomationCommand({
          type: "browser.automation.execute.request",
          requestId: `native-broadcast-${browserId}-${sequence}`,
          workspaceId,
          command: { command: "screenshot", args: { browserId, fullPage: false } },
        });
        if (disposed || before !== generation) return null;
        if (!reply.ok) throw Error(reply.error?.message ?? "Desktop screenshot failed");
        const frame = await encodeNativeScreenshot(document, browserId, reply.result);
        if (disposed || before !== generation) return null;
        return { ...frame, sequence, generation, browserId };
      }
      if (!streamRead) {
        streamRead = api.captureNativeFrame({ browserId, workspaceId, notBefore: changedAt }).then(
          (frame) => { if (!disposed && before === generation) streamFrame = frame; },
          () => { /* The bounded still capture below can recover from a stalled stream. */ },
        ).finally(() => { streamRead = null; });
        await Promise.resolve();
      }
      let frame = streamFrame;
      if (disposed || before !== generation) return null;
      if (!frame || frame.capturedAt <= lastCapture || frame.capturedAt <= changedAt) {
        // Screencast emits paints, not a periodic video: a still page may never
        // produce a frame newer than the navigation/resize freshness fence.
        // Capture through main-process CDP; renderer capturePage is unsafe in Electron.
        const now = Date.now();
        if (now < changedAt || now - lastFrameReceivedAt < 1000 || now - lastStillAttemptAt < 1000)
          return null;
        lastStillAttemptAt = now;
        const scale = Math.min(1, 1280 / size.width, 960 / size.height);
        if (!Number.isFinite(scale) || scale <= 0) return null;
        const result = await cdp("Page.captureScreenshot", {
          format: "jpeg",
          quality: 65,
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { x: 0, y: 0, width: size.width, height: size.height, scale },
        }) as { data?: unknown };
        if (disposed || before !== generation) return null;
        if (typeof result.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(result.data) || result.data.length > 1_099_900)
          throw Error("Native still frame is invalid or exceeds the image size limit");
        frame = {
          data: `data:image/jpeg;base64,${result.data}`,
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
          capturedAt: Date.now(),
        };
      }
      lastCapture = frame.capturedAt;
      lastFrameReceivedAt = Date.now();
      return { ...frame, sequence, generation, browserId };
    },
    async execute(command) {
      if (!ready || disposed) throw Error("Native browser is not ready");
      const input = command.input;
      if (command.operation === "tabs.list") return { tabs: [state()] };
      if (command.operation === "open" || command.operation === "navigate") {
        const url = new URL(String(input.url));
        if (!["http:", "https:"].includes(url.protocol))
          throw Error("Only HTTP(S) URLs are supported");
        await guest.loadURL(url.href);
        return state();
      }
      if (command.operation === "back") {
        guest.goBack();
        return state();
      }
      if (command.operation === "forward") {
        guest.goForward();
        return state();
      }
      if (command.operation === "reload") {
        guest.reload();
        return state();
      }
      if (command.operation === "evaluate")
        return guest.executeJavaScript(String(input.expression));
      if (command.operation === "input") {
        if (input.browserId !== browserId)
          throw Error("Browser tab changed; wait for its current frame");
        if (input.generation !== generation)
          throw Error("Page changed; wait for a fresh frame before interacting");
        if (input.kind === "type") {
          if (typeof input.text !== "string" || input.text.length > 4000)
            throw Error("Invalid browser text");
          if (!api.sendNativeCommand) {
            guest.focus();
            return guest.insertText(input.text);
          }
          return cdp("Input.insertText", { text: input.text });
        }
        if (input.kind === "key") {
          if (
            input.key !== "Enter" &&
            input.key !== "Tab" &&
            input.key !== "Backspace" &&
            input.key !== "Escape"
          )
            throw Error("Unsupported key");
          const code = { Enter: 13, Tab: 9, Backspace: 8, Escape: 27 }[input.key];
          if (!api.sendNativeCommand) {
            guest.focus();
            guest.sendInputEvent({ type: "keyDown", keyCode: input.key });
            guest.sendInputEvent({ type: "keyUp", keyCode: input.key });
            return {};
          }
          await cdp("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: input.key,
            windowsVirtualKeyCode: code,
          });
          return cdp("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: input.key,
            windowsVirtualKeyCode: code,
          });
        }
        if (typeof input.x !== "number" || typeof input.y !== "number")
          throw Error("Invalid input coordinates");
        const x = Math.round(input.x);
        const y = Math.round(input.y);
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          y < 0 ||
          x > size.width ||
          y > size.height
        )
          throw Error("Invalid input coordinates");
        if (!api.sendNativeCommand) {
          guest.focus();
          guest.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
          guest.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
          return {};
        }
        await cdp("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        await cdp("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        return {};
      }
      if (isBrowserAction(command.operation))
        return runBrowserAction(command.operation, input, async (method, params) => {
          if (method === "Runtime.evaluate")
            return { result: { value: await guest.executeJavaScript(String(params.expression)) } };
          return cdp(method, params);
        });
      if (command.operation === "cdp_send")
        return cdp(String(input.method), (input.params ?? {}) as Record<string, unknown>);
      if (command.operation === "cdp_events") {
        if (!api.readNativeEvents) throw Error("Update Paseo Desktop to a version with the native DevTools API");
        return api.readNativeEvents({
          browserId,
          workspaceId,
          method: typeof input.method === "string" ? input.method : undefined,
          clear: input.clear !== false,
        });
      }
      if (command.operation === "browser_cookies") {
        if (input.action === "get") return cdp("Network.getAllCookies");
        if (input.action === "set") return cdp("Network.setCookies", { cookies: input.cookies });
        if (input.action === "clear") return cdp("Network.clearBrowserCookies");
        if (input.action === "delete") {
          const { action: _, ...params } = input;
          return cdp("Network.deleteCookies", params);
        }
        throw Error("Unknown cookie action");
      }
      if (command.operation === "automation") {
        const result = await api.executeAutomationCommand({
          type: "browser.automation.execute.request",
          requestId: command.id,
          workspaceId,
          ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
          command: {
            command: input.name,
            args: { ...((input.args as Record<string, unknown>) ?? {}), browserId },
          },
        });
        if (!result.ok) throw Error(result.error?.message ?? "Native automation failed");
        return result.result;
      }
      throw Error(`Unknown native browser operation: ${command.operation}`);
    },
    inputEnabled(enabled) {
      inputEnabled = enabled;
      position();
    },
    present(node) {
      host = node as Anchor | null;
      position();
    },
    dispose() {
      disposed = true;
      ready = false;
      guest.remove();
      void api.unregisterWorkspaceBrowser(browserId).catch(() => {});
    },
  };
}

/** React Native Web Pressable preserves MouseEvent client coordinates, not locationX/Y. */
export function nativeTouchPoint(event: unknown, node: unknown): { x: number; y: number } | null {
  const source = (
    event as {
      nativeEvent?: { clientX?: number; clientY?: number; locationX?: number; locationY?: number };
    }
  ).nativeEvent;
  if (!source) return null;
  if (Platform.OS === "web") {
    const target = node as { getBoundingClientRect?(): { left: number; top: number } } | null;
    const rect = target?.getBoundingClientRect?.();
    if (rect && typeof source.clientX === "number" && typeof source.clientY === "number")
      return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }
  return typeof source.locationX === "number" && typeof source.locationY === "number"
    ? { x: source.locationX, y: source.locationY }
    : null;
}

export function createNativeBrowserId(): string {
  const crypto = (globalThis as unknown as { crypto?: { randomUUID?(): string } }).crypto;
  return crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
