import { describe, it, expect } from "vitest";
import { runBrowserAction } from "./browser-actions";

describe("browser actions shared by native and workspace adapters", () => {
  it("treats storage keys and values as data, including code-like strings", async () => {
    const key = '\"); throw Error("injected"); //';
    const value = 'line\n"quoted"';
    const store = new Map<string, string>();
    const localStorage = { setItem: (k: string, v: string) => store.set(k, v) };
    await runBrowserAction("browser_storage", { area: "local", action: { kind: "set", key, value } }, async (_, params) => {
      Function("localStorage", `return ${params.expression}`)(localStorage);
      return { result: { value: null } };
    });
    expect(store.get(key)).toBe(value);
  });
  it("reports page exceptions instead of returning an empty successful result", async () => {
    await expect(runBrowserAction("browser_storage", { area: "session", action: { kind: "get" } }, async () => ({ exceptionDetails: { text: "Access denied" } }))).rejects.toThrow("Access denied");
  });
  it("enables networking and maps cache arguments to CDP", async () => {
    const calls: unknown[] = [];
    await runBrowserAction("browser_network", { action: { kind: "cache", disabled: true } }, async (...args) => { calls.push(args); return {}; });
    expect(calls).toEqual([["Network.enable", {}], ["Network.setCacheDisabled", { cacheDisabled: true }]]);
  });
  it("resets all emulation overrides", async () => {
    const calls: unknown[] = [];
    await runBrowserAction("browser_emulate", { action: { kind: "reset" } }, async (...args) => { calls.push(args); return {}; });
    expect(calls).toEqual([["Emulation.clearDeviceMetricsOverride", {}], ["Emulation.clearGeolocationOverride", {}], ["Emulation.setTimezoneOverride", { timezoneId: "" }], ["Emulation.setEmulatedMedia", { features: [] }]]);
  });
  it("validates before dispatching invalid coordinates", async () => {
    let sent = false;
    await expect(runBrowserAction("browser_emulate", { action: { kind: "geolocation", latitude: 100, longitude: 0 } }, async () => { sent = true; })).rejects.toThrow();
    expect(sent).toBe(false);
  });
  it("passes prompt replies without leaking target selection into CDP params", async () => {
    const calls: unknown[] = [];
    await runBrowserAction("browser_dialog", { targetId: "page", accept: true, promptText: "hello" }, async (...args) => { calls.push(args); return {}; });
    expect(calls).toEqual([["Page.handleJavaScriptDialog", { accept: true, promptText: "hello" }]]);
  });
});
