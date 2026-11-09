import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { NativeRelay } from "../server/native/relay";
import { createPrivateVirtualDisplay } from "../server/workspace/virtual-display";

const binary = process.env.PASEO_ELECTRON_BINARY;
if (!binary) throw Error("Set PASEO_ELECTRON_BINARY to an Electron executable");
const checkout = resolve(process.env.PASEO_CHECKOUT ?? "../paseo");
const directory = await mkdtemp(join(tmpdir(), "paseo-native-smoke-"));
const relay = new NativeRelay();
await relay.listen();
const output = await build({
  entryPoints: ["tests/native/panel.jsx"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  alias: {
    "react-native": "react-native-web",
    "@getpaseo/plugin/client": resolve("tests/ui/host-hooks.jsx"),
  },
});
const errors: string[] = [];
let hideRequested = false;
const rpc: any = {
  "native.exchange": (input: any) => relay.exchange(input),
  "native.watch": (input: any) =>
    relay.watch(input.workspaceId, input.viewerId, input.afterSequence),
  "native.control": (input: any) =>
    relay.control(input.workspaceId, input.viewerId, true, input.action),
  "native.action": async (input: any) => ({
    result: await relay.command(input.workspaceId, input.viewerId, input.operation, input.input),
  }),
};
const http = createServer(async (req, res) => {
  try {
    if (req.url === "/desktop-test-command") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ hide: hideRequested }));
      hideRequested = false;
      return;
    }
    if (req.url === "/app.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(output.outputFiles[0].contents);
      return;
    }
    if (req.url === "/rpc") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { name, input } = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(await rpc[name](input)));
      return;
    }
    if (req.url === "/fixture") {
      res.end(
        '<!doctype html><title>Native session</title><h1>Real native Chromium</h1><button onclick="this.textContent=\'Native click\'">Click me</button><output></output><script>function tick(t){document.querySelector("output").textContent=Math.floor(t);requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>',
      );
      return;
    }
    res.end(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;display:flex;flex-direction:column}</style><div id="root"></div><script src="/app.js"></script>',
    );
  } catch (error) {
    errors.push(String(error));
    res
      .writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
const address = http.address();
assert.ok(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}`;
await writeFile(
  join(directory, "preload.cjs"),
  `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('paseoDesktop',{browser:{profilePartition:'persist:paseo-browser',registerAttachedBrowser:input=>ipcRenderer.invoke('register',input),unregisterWorkspaceBrowser:id=>ipcRenderer.invoke('unregister',id),captureNativeFrame:input=>ipcRenderer.invoke('paseo:browser:native-frame',input),sendNativeCommand:input=>ipcRenderer.invoke('paseo:browser:native-command',input),readNativeEvents:input=>ipcRenderer.invoke('paseo:browser:native-events',input),executeAutomationCommand:input=>ipcRenderer.invoke('paseo:browser:execute-automation-command',input)}});`,
);
const main = `import {app,BrowserWindow,ipcMain,session,webContents} from 'electron';
import {registerBrowserAutomationIpc} from ${JSON.stringify(join(checkout, "packages/desktop/src/features/browser-automation/ipc.ts"))};
import {registerAttachedPaseoBrowser,unregisterPaseoBrowserFromHost} from ${JSON.stringify(join(checkout, "packages/desktop/src/features/browser-webviews/index.ts"))};
app.setPath('userData',${JSON.stringify(join(directory, "profile"))});app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{registerBrowserAutomationIpc();
ipcMain.handle('register',(event,input)=>{const ok=registerAttachedPaseoBrowser({...input,sender:event.sender,profileSession:session.fromPartition('persist:paseo-browser'),findWebContents:id=>webContents.fromId(id)});if(!ok)throw Error('Guest registration failed');});
ipcMain.handle('unregister',(event,id)=>unregisterPaseoBrowserFromHost(event.sender.id,id));
const window=new BrowserWindow({show:true,width:1280,height:900,webPreferences:{webviewTag:true,preload:${JSON.stringify(join(directory, "preload.cjs"))},sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
window.webContents.on('console-message',(...args)=>console.log('RENDERER',...args.slice(1)));window.webContents.on('did-fail-load',(...args)=>console.log('LOAD FAILED',...args.slice(1)));setTimeout(async()=>console.log('STATE',await window.webContents.executeJavaScript('JSON.stringify({text:document.body.innerText,html:document.body.innerHTML.slice(0,1500),host:!!globalThis.paseoDesktop})')),2000);await window.loadURL(${JSON.stringify(url)});setInterval(async()=>{const result=await(await fetch(${JSON.stringify(url + "/desktop-test-command")})).json();if(result.hide){await window.webContents.executeJavaScript('globalThis.nativeTestHide()');window.hide();}},100);});
`;
await build({
  stdin: { contents: main, resolveDir: process.cwd(), sourcefile: "native-main.ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  outfile: join(directory, "main.mjs"),
});
const display = await createPrivateVirtualDisplay();
assert.ok(display, "Native test needs Xvfb");
const env: NodeJS.ProcessEnv = { ...process.env, ...display.launchEnvironment };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  binary,
  [join(directory, "main.mjs"), "--no-sandbox", "--disable-gpu", "--ozone-platform=x11"],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
child.on("error", (error) => {
  log += "SPAWN ERROR " + String(error);
});
child.on("exit", (code, signal) => {
  log += "EXIT " + code + " " + signal;
});
child.stdout.on("data", (data) => (log += String(data)));
child.stderr.on("data", (data) => (log += String(data)));
let mobile: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
let mcp: Client | undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  for (let i = 0; i < 400 && !relay.watch("native-test", "test-native-monitor", 0).state; i++) {
    if (child.exitCode !== null) throw Error(log);
    await pause(100);
  }
  assert.ok(relay.watch("native-test", "test-native-monitor", 0).state, log);
  const ticket = relay.ticket("native-test", "agent");
  mcp = new Client({ name: "native-smoke", version: "1" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("node_modules/tsx/dist/cli.mjs"), resolve("server/native/mcp-entry.ts")],
      env: { PASEO_BROWSER_NATIVE_URL: ticket.url, PASEO_BROWSER_NATIVE_TOKEN: ticket.token },
      stderr: "inherit",
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result: any = await mcp!.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  await call("native_browser_open", { url: `${url}/fixture` });
  await call("shared_browser_acquire_control");
  await call("browser_cookies", {
    action: "set",
    cookies: [{ name: "native_session", value: "same-profile", url, httpOnly: true }],
  });
  const cookies = await call("browser_cookies", { action: "get" });
  assert.equal(
    cookies.cookies.find((cookie: any) => cookie.name === "native_session").httpOnly,
    true,
  );
  assert.equal(
    await call("evaluate_script", { function: '() => document.querySelector("h1").textContent' }),
    "Real native Chromium",
  );
  assert.ok(
    !(await call("evaluate_script", { function: "() => document.cookie" })).includes(
      "native_session",
    ),
  );
  const snapshot = await call("native_browser_automation", { name: "snapshot" });
  assert.match(JSON.stringify(snapshot), /Real native Chromium/);
  const screenshot: any = await mcp.callTool({
    name: "native_browser_automation",
    arguments: { name: "screenshot", args: {} },
  });
  assert.ok(!screenshot.isError, JSON.stringify(screenshot));
  assert.equal(screenshot.content[0].type, "image");
  await call("cdp_send", { method: "Runtime.enable" });
  const scopedCookies=await call("cdp_send",{method:"Storage.getCookies"});assert.ok(scopedCookies.cookies.some((cookie:any)=>cookie.name==='native_session'));
  const outside:any=await mcp.callTool({name:"cdp_send",arguments:{method:"Network.getAllCookies",params:{browserContextId:"other-context"}}});assert.equal(outside.isError,true);
  const targets = await call("cdp_send", { method: "Target.getTargets" });
  assert.equal(targets.targetInfos.length, 1);
  assert.ok(targets.targetInfos[0].url.startsWith(url));
  const firstTabs = await call("shared_browser_tabs");
  assert.equal(firstTabs.tabs.length, 1);
  await call("shared_browser_tab_open", { url: url + "/fixture" });
  assert.equal((await call("shared_browser_tabs")).tabs.length, 2);
  await call("shared_browser_tab_close");
  assert.equal((await call("shared_browser_tabs")).tabs.length, 1);
  const button = await call("evaluate_script", {
    function:
      '() => {const r=document.querySelector("button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}',
  });
  await call("shared_browser_release_control");
  mobile = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
  const page = await mobile.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(url);
  await page.waitForSelector('[aria-label="Live native browser"]', { timeout: 15_000 });
  await page.waitForFunction("Array.from(document.images).some(image=>image.naturalWidth>0)");
  hideRequested = true;
  await pause(500);
  const start = Date.now();
  const sequences = new Set<number>();const paintedFrames=new Set<string>();
  while (Date.now() - start < 3_000) {
    const frame = relay.watch("native-test", "test-native-monitor", 0).frame;
    if (frame){sequences.add(frame.sequence);paintedFrames.add(frame.data);}
    await pause(30);
  }
  assert.ok(paintedFrames.size>=15,`Native frames repeated stale pixels: ${paintedFrames.size}`);
  assert.ok(sequences.size >= 15, `Expected fresh MJPEG frames, got ${sequences.size}. ${log}`);
  await page.click("text/Take control");
  await page.waitForFunction('document.body.textContent.includes("Release")');
  const denied: any = await mcp.callTool({
    name: "evaluate_script",
    arguments: { function: '() => document.title="WRONG"' },
  });
  assert.equal(denied.isError, true);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: resolve("artifacts/native-mobile.png") });
  const mirror = await page.$('[aria-label="Live native browser"]');
  assert.ok(mirror);
  const bounds = await mirror.boundingBox();
  assert.ok(bounds);
  const current = relay.watch("native-test", "test-native-monitor", 0);
  assert.ok(current.frame && current.state);
  const scale = Math.min(bounds.width / current.frame.width, bounds.height / current.frame.height);
  const tapX =
    bounds.x +
    (bounds.width - current.frame.width * scale) / 2 +
    ((button.x * current.frame.width) / current.state.width) * scale;
  const tapY =
    bounds.y +
    (bounds.height - current.frame.height * scale) / 2 +
    ((button.y * current.frame.height) / current.state.height) * scale;
  await page.mouse.click(tapX, tapY);
  await pause(500);

  await page.click("text/Release");
  await call("shared_browser_acquire_control");
  assert.equal(
    await call("evaluate_script", {
      function: '() => document.querySelector("button").textContent',
    }),
    "Native click",
  );
  await call("shared_browser_release_control");
  const white=await page.evaluate(`(()=>{const image=document.images[0];const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const bytes=context.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]>230&&bytes[i+1]>230&&bytes[i+2]>230)count++;return count/(bytes.length/4);})()`);
  assert.ok(Number(white)>0.5,`Parked native page lost its painted content: white fraction=${white}`);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: native Electron WebView, native snapshots/screenshots/tabs, CDP/HttpOnly cookies, parked-pane mobile mirror and touch;  ${sequences.size} fresh frames/3s; human control fences agent tools.`,
  );
} catch (error) {
  console.error(log.slice(-10_000));
  throw error;
} finally {
  await mcp?.close();
  await mobile?.close();
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
  await display.stop();
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  await relay.close();
  await rm(directory, { recursive: true, force: true });
}
