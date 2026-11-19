import { spawn } from "node:child_process";
import { basename } from "node:path";

type DesktopRuntime = {
  platform: string;
  executable: string;
  electron: boolean;
  env: NodeJS.ProcessEnv;
};

/** Only reopen the known local Linux Desktop that is already hosting the daemon. */
export function localDesktopLaunch(runtime: DesktopRuntime) {
  if (runtime.platform !== "linux" || !runtime.electron ||
    !["Paseo", "Paseo.bin"].includes(basename(runtime.executable)) ||
    (!runtime.env.DISPLAY && !runtime.env.WAYLAND_DISPLAY)) return null;
  const env = { ...runtime.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  if (env.DISPLAY && !env.PASEO_ELECTRON_FLAGS?.includes("--ozone-platform="))
    env.PASEO_ELECTRON_FLAGS = [env.PASEO_ELECTRON_FLAGS, "--ozone-platform=x11"].filter(Boolean).join(" ");
  return { executable: runtime.executable, env };
}

export function createLocalDesktopLauncher(runtime: DesktopRuntime = {
    platform: process.platform, executable: process.execPath,
    electron: Boolean(process.versions.electron), env: process.env,
  }) {
  const launch = localDesktopLaunch(runtime);
  let lastAttemptAt = -Infinity;
  return async () => {
    // A burst of browser requests must not create a burst of Desktop windows.
    if (!launch || Date.now() - lastAttemptAt < 30_000) return false;
    lastAttemptAt = Date.now();
    console.info("[paseo-browser] Reopening local Desktop for an explicit browser opening");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.executable, [], { env: launch.env, detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    });
    return true;
  };
}
