/** Capture the real plugin in an isolated Electron host and a compact web client. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { NativeRelay } from '../server/native/relay';
import { createPrivateVirtualDisplay } from '../server/workspace/virtual-display';

const binary = process.env.PASEO_ELECTRON_BINARY;
assert.ok(binary, 'Set PASEO_ELECTRON_BINARY to an Electron executable');
const directory = await mkdtemp(join(tmpdir(), 'paseo-listing-media-'));
const relay = new NativeRelay();
await relay.listen();
const bundle = await build({
  entryPoints: ['tests/native/panel.jsx'], bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  alias: { 'react-native': 'react-native-web', '@getpaseo/plugin/client': resolve('tests/ui/host-hooks.jsx') },
});
const rpc: Record<string, (input: any) => unknown> = {
  'native.exchange': input => relay.exchange(input),
  'native.watch': input => relay.watch(input.workspaceId, input.viewerId, input.afterSequence),
  'native.control': input => relay.control(input.workspaceId, input.viewerId, true, input.action),
  'native.action': async input => ({ result: await relay.command(input.workspaceId, input.viewerId, input.operation, input.input) }),
};
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents); return;
    }
    if (req.url === '/rpc') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { name, input } = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await rpc[name](input))); return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/demo') {
      res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser workspace</title>
      <style>*{box-sizing:border-box}body{margin:0;background:#eff3f9;color:#142039;font:16px system-ui}main{max-width:920px;margin:48px auto;padding:0 28px}.tag{font-size:12px;letter-spacing:2px;color:#526581}h1{font-size:44px;letter-spacing:-2px;margin:12px 0}p{color:#526581;line-height:1.6}.cards{display:flex;gap:16px;margin:32px 0}.card{flex:1;background:white;border:1px solid #d9e1ee;border-radius:14px;padding:22px}h2{font-size:18px;margin:0 0 12px}button{background:#2858dd;color:white;border:0;border-radius:8px;padding:12px 18px;font:inherit}input{padding:12px;border:1px solid #b8c6dc;border-radius:8px;font:inherit;width:230px}output{display:block;margin-top:18px;color:#1a6b4e}@media(max-width:650px){h1{font-size:32px}.cards{display:block}.card{margin-bottom:12px}}</style>
      <main><div class="tag">PASEO BROWSER · DEMO WORKSPACE</div><h1>Your browser, shared.</h1><p>A native Chromium tab on desktop. The same page on your phone.<br>Agents and people work with the same tabs and cookies.</p><div class="cards"><section class="card"><h2>Native on desktop</h2><p>Interact with the page directly and open Chromium DevTools.</p></section><section class="card"><h2>Visible on mobile</h2><p>Follow the desktop session and take control when you need it.</p></section></div><section class="card"><h2>Try the shared page</h2><p>Type a message and run an action in the same browser session.</p><input aria-label="Demo message" value="Hello from Paseo"><button onclick="document.querySelector('output').textContent=document.querySelector('input').value">Run action</button><output>Ready for people and agents.</output></section><p><small>Live demo · <span id="clock"></span></small></p></main><script>function tick(t){document.getElementById("clock").textContent=(t/1000).toFixed(1)+" s";requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>`); return;
    }
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;display:flex;flex-direction:column}</style><div id="root"></div><script src="/app.js"></script>');
  } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(error) })); }
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const address = server.address(); assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
await writeFile(join(directory, 'registry.cjs'), `exports.getPaseoBrowserWebContentsForHostWindow=(id,host)=>{const record=globalThis.nativeGuests.get(id);return record?.host===host?record.contents:null};exports.getPaseoBrowserWorkspaceId=id=>globalThis.nativeGuests.get(id)?.workspaceId;`);
await writeFile(join(directory, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('paseoDesktop',{browser:{profilePartition:'persist:listing-demo',registerAttachedBrowser:input=>ipcRenderer.invoke('register',input),unregisterWorkspaceBrowser:id=>ipcRenderer.invoke('unregister',id),captureNativeFrame:input=>ipcRenderer.invoke('paseo:browser:native-frame',input),sendNativeCommand:input=>ipcRenderer.invoke('paseo:browser:native-command',input),readNativeEvents:input=>ipcRenderer.invoke('paseo:browser:native-events',input)}});`);
await build({
  stdin: { contents: `const {app,BrowserWindow,ipcMain,webContents}=require('electron');const {registerNativeBrowserBridgeIpc}=require(${JSON.stringify(resolve('integrations/paseo/native-bridge.cjs'))});globalThis.nativeGuests=new Map();app.setPath('userData',${JSON.stringify(join(directory,'profile'))});ipcMain.handle('register',(event,input)=>{globalThis.nativeGuests.set(input.browserId,{host:event.sender.id,contents:webContents.fromId(input.webContentsId),workspaceId:input.workspaceId});});ipcMain.handle('unregister',(_event,id)=>globalThis.nativeGuests.delete(id));app.whenReady().then(async()=>{registerNativeBrowserBridgeIpc();const window=new BrowserWindow({width:1280,height:900,show:true,webPreferences:{webviewTag:true,preload:${JSON.stringify(join(directory,'preload.cjs'))},contextIsolation:true,nodeIntegration:false}});await window.loadURL(${JSON.stringify(url)});});app.on('window-all-closed',()=>app.quit());`, resolveDir: process.cwd(), sourcefile: 'listing-main.cjs' },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'main.cjs'),
  plugins: [{ name: 'isolated-guest-registry', setup(builder) {
    builder.onResolve({ filter: /browser-webviews\/index\.js$/ }, () => ({ path: join(directory, 'registry.cjs') }));
  } }],
});
const display = await createPrivateVirtualDisplay(); assert.ok(display, 'Xvfb is required');
const env: NodeJS.ProcessEnv = { ...process.env, ...display.launchEnvironment }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(binary, [join(directory, 'main.cjs'), '--no-sandbox', '--disable-gpu', '--ozone-platform=x11', '--remote-debugging-port=0'], { env, stdio: ['ignore','pipe','pipe'] });
let endpoint = ''; let log = '';
child.stderr.on('data', data => { log += String(data); endpoint ||= String(data).match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? ''; });
child.stdout.on('data', data => { log += String(data); });
let desktop: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
let mobile: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
try {
  for (let i=0; i<200 && !endpoint; i++) await pause(100);
  assert.ok(endpoint, log);
  desktop = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  const page = await desktop.waitForTarget(target => target.url() === url + '/').then(target => target.page()); assert.ok(page);
  for (let i=0; i<200 && !relay.watch('native-test','listing-monitor',0).state; i++) await pause(100);
  assert.ok(relay.watch('native-test','listing-monitor',0).state, log);
  relay.control('native-test','listing-agent',true,'acquire');
  await relay.command('native-test','listing-agent','navigate',{ url: url + '/demo' });
  relay.control('native-test','listing-agent',true,'release');
  await page.click('text/Take control');
  await page.waitForSelector('[aria-label="Open Chrome DevTools"]:not([aria-disabled="true"])');
  await pause(1000);
  await mkdir(resolve('assets'), { recursive: true });
  await page.screenshot({ path: resolve('assets/native-desktop.png') });
  await page.click('text/Release');
  mobile = await puppeteer.launch({ executablePath: process.env.PASEO_CHROME_BINARY ?? '/usr/bin/google-chrome', headless: true });
  const phone = await mobile.newPage(); await phone.setViewport({ width:390, height:844 });
  await phone.goto(url);
  try { await phone.waitForSelector('[aria-label="Live native browser"]', {timeout:15000}); } catch(error) { console.error(await phone.evaluate('document.body.innerText'), relay.watch('native-test','listing-debug',0), log); throw error; }
  await phone.waitForFunction('Array.from(document.images).some(image=>image.naturalWidth>0)');
  assert.equal(await phone.$('[aria-label="Open Chrome DevTools"]'), null);
  await phone.screenshot({ path: resolve('assets/native-mobile.png') });
  console.log('Captured native desktop and same-session mobile screenshots.');
} finally {
  await mobile?.close(); desktop?.disconnect(); child.kill('SIGTERM'); await relay.close();
  server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r()));
  await display.stop(); await rm(directory,{recursive:true,force:true});
}
