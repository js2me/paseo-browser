import { browserDevtoolsSchemas, browserDevtoolsDescriptions, runBrowserDevtools } from "./browser-devtools";
import { z } from "zod";

const target = { targetId: z.string().min(1).optional() };
export const browserActionSchemas = {
  ...browserDevtoolsSchemas,
  browser_storage: z.object({
    ...target,
    area: z.enum(["local", "session"]),
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("get"), key: z.string().optional() }),
      z.object({ kind: z.literal("set"), key: z.string(), value: z.string() }),
      z.object({ kind: z.literal("remove"), key: z.string() }),
      z.object({ kind: z.literal("clear") }),
    ]),
  }),
  browser_dialog: z.object({ ...target, accept: z.boolean(), promptText: z.string().optional() }),
  browser_emulate: z.object({
    ...target,
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("viewport"), width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384), deviceScaleFactor: z.number().min(0).max(8).default(1), mobile: z.boolean().default(false) }),
      z.object({ kind: z.literal("timezone"), timezoneId: z.string() }),
      z.object({ kind: z.literal("geolocation"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().nonnegative().default(1) }),
      z.object({ kind: z.literal("media"), colorScheme: z.enum(["light", "dark", "no-preference"]), reducedMotion: z.enum(["reduce", "no-preference"]).default("no-preference") }),
      z.object({ kind: z.literal("reset") }),
    ]),
  }),
  browser_network: z.object({
    ...target,
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("conditions"), offline: z.boolean().default(false), latency: z.number().nonnegative().default(0), downloadThroughput: z.number().min(-1).default(-1), uploadThroughput: z.number().min(-1).default(-1) }),
      z.object({ kind: z.literal("headers"), headers: z.record(z.string(), z.string()) }),
      z.object({ kind: z.literal("cache"), disabled: z.boolean() }),
      z.object({ kind: z.literal("block"), urls: z.array(z.string()) }),
    ]),
  }),
};
export const browserActionDescriptions = {
  ...browserDevtoolsDescriptions,
  browser_storage: "Read, set, remove or clear localStorage/sessionStorage in the page's current origin. get without key returns all entries. Requires control. Workspace mode requires a page targetId; native mode uses the selected tab. Values may contain secrets.",
  browser_dialog: "Accept or dismiss the current JavaScript alert, confirm, prompt or beforeunload dialog; optionally provide promptText. Requires control and a desktop CDP bridge in native mode. Workspace mode requires page targetId. Workspace sessions enable Page on attachment; establish the session before triggering a dialog. Native mode requires Page.enable via cdp_send. Read cdp_events for dialog events. Dialogs remain open until answered; other page commands may block.",
  browser_emulate: "Set device viewport, timezone, geolocation or color scheme/reduced motion. reset clears these overrides. Geolocation may also require Browser.grantPermissions. Requires control; workspace mode requires page targetId; native mode requires desktop CDP bridge.",
  browser_network: "Set offline/throttling conditions (latency in ms, throughput bytes/sec, -1 unlimited), extra request headers, cache disabled or blocked URL patterns (empty array unblocks). Requires control; workspace mode requires page targetId; native mode requires desktop CDP bridge. Settings persist for the target until changed or closed.",
};

type Send = (method: string, params: Record<string, unknown>) => Promise<any>;
export function isBrowserAction(name: string): name is keyof typeof browserActionSchemas {
  return Object.hasOwn(browserActionSchemas, name);
}
/** Shared command implementation: both adapters retain their own lease and target checks. */
export async function runBrowserAction(name: keyof typeof browserActionSchemas, args: unknown, send: Send): Promise<unknown> {
  if (name === "browser_inspect" || name === "browser_dom" || name === "browser_css")
    return runBrowserDevtools(name, args, send);
  if (name === "browser_storage") {
    const { area, action } = browserActionSchemas.browser_storage.parse(args);
    const expression = `(() => { const store = ${area === "local" ? "localStorage" : "sessionStorage"}; const action = ${JSON.stringify(action)}; switch (action.kind) { case "get": return action.key === undefined ? Object.fromEntries(Object.keys(store).map(key => [key, store.getItem(key)])) : store.getItem(action.key); case "set": store.setItem(action.key, action.value); break; case "remove": store.removeItem(action.key); break; case "clear": store.clear(); } return null; })()`;
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Storage operation failed");
    return result.result?.value ?? null;
  }
  if (name === "browser_dialog") {
    const { targetId: _, ...params } = browserActionSchemas.browser_dialog.parse(args);
    return send("Page.handleJavaScriptDialog", params);
  }
  if (name === "browser_network") {
    const { action } = browserActionSchemas.browser_network.parse(args);
    await send("Network.enable", {});
    const { kind, ...params } = action;
    const methods = { conditions: "Network.emulateNetworkConditions", headers: "Network.setExtraHTTPHeaders", cache: "Network.setCacheDisabled", block: "Network.setBlockedURLs" };
    return send(methods[kind], kind === "cache" ? { cacheDisabled: action.disabled } : params);
  }
  const { action } = browserActionSchemas.browser_emulate.parse(args);
  const { kind, ...params } = action;
  if (kind === "viewport") return send("Emulation.setDeviceMetricsOverride", params);
  if (kind === "timezone") return send("Emulation.setTimezoneOverride", params);
  if (kind === "geolocation") return send("Emulation.setGeolocationOverride", params);
  if (action.kind === "media") return send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: action.colorScheme }, { name: "prefers-reduced-motion", value: action.reducedMotion }] });
  await send("Emulation.clearDeviceMetricsOverride", {});
  await send("Emulation.clearGeolocationOverride", {});
  await send("Emulation.setTimezoneOverride", { timezoneId: "" });
  return send("Emulation.setEmulatedMedia", { features: [] });
}
