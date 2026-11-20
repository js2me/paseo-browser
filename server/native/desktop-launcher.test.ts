import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
import { createLocalDesktopLauncher, localDesktopLaunch } from "./desktop-launcher";
const runtime = {platform:"linux", executable:"/opt/paseo/Paseo.bin", electron:true,
  env:{DISPLAY:":0",ELECTRON_RUN_AS_NODE:"1",NODE_OPTIONS:"--require=worker.cjs",PASEO_ELECTRON_FLAGS:"--disable-gpu"}};
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it("reopens the hosting Desktop in GUI mode while retaining explicit Chromium flags", () => {
  const launch=localDesktopLaunch(runtime)!;
  expect(launch.executable).toBe(runtime.executable);
  expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(launch.env.NODE_OPTIONS).toBeUndefined();
  expect(launch.env.PASEO_ELECTRON_FLAGS).toBe("--disable-gpu --ozone-platform=x11");
  expect(runtime.env.ELECTRON_RUN_AS_NODE).toBe("1");
  expect(localDesktopLaunch({...runtime,env:{DISPLAY:":0",PASEO_ELECTRON_FLAGS:"--ozone-platform=wayland"}})!.env.PASEO_ELECTRON_FLAGS).toBe("--ozone-platform=wayland");
});
it("does not launch Node, unrelated Electron executables or a headless daemon", () => {
  expect(localDesktopLaunch({...runtime,electron:false})).toBeNull();
  expect(localDesktopLaunch({...runtime,executable:"/usr/bin/electron"})).toBeNull();
  expect(localDesktopLaunch({...runtime,env:{}})).toBeNull();
  expect(localDesktopLaunch({...runtime,platform:"darwin"})).toBeNull();
});
it("limits simultaneous requests to one Desktop launch and reports launch errors", async () => {
  vi.useFakeTimers();
  const children:any[]=[];
  spawn.mockImplementation(() => {const child=Object.assign(new EventEmitter(),{unref:vi.fn()});children.push(child);return child;});
  const launch=createLocalDesktopLauncher(runtime);
  const first=launch();
  expect(await launch()).toBe(false);
  children[0].emit("spawn");
  expect(await first).toBe(true);
  expect(children[0].unref).toHaveBeenCalledOnce();
  expect(spawn).toHaveBeenCalledWith(runtime.executable,[],expect.objectContaining({detached:true,stdio:"ignore"}));
  await vi.advanceTimersByTimeAsync(30_000);
  const next=launch();
  const failure=expect(next).rejects.toThrow("display unavailable");
  children[1].emit("error",new Error("display unavailable"));
  await failure;
});
