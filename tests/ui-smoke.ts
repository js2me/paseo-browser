import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createRuntimeOwner } from '../server/workspace/runtime-owner';
import { startSupervisorServer, resolveSupervisorPaths } from '../server/workspace/supervisor';
import { agentCursorExpression } from '../shared/native/agent-cursor';
import { randomBytes } from "node:crypto";
import { AgentSupervisorClient, SupervisorClient } from '../server/workspace/supervisor-client';
import { resolveBrowserRuntimeRoot } from '../server/workspace/runtime-path';

const assets = resolveBrowserRuntimeRoot(process.env.PASEO_HOME ?? join(homedir(), '.paseo'));
const home = await mkdtemp(join(tmpdir(), 'paseo-browser-ui-'));
process.env.PASEO_HOME = home;
process.env.PASEO_BROWSER_WORKSPACE_AGENT_BROWSER_BINARY = join(assets, 'node_modules/.bin/agent-browser');
process.env.PASEO_BROWSER_WORKSPACE_CHROMIUM_EXECUTABLE = '/usr/bin/google-chrome';
const output = await build({ entryPoints: ['tests/ui/panel.jsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', global:'globalThis' }, alias: {
  'react-native': 'react-native-web',
  '@getpaseo/plugin/client/ui': resolve('tests/ui/host-ui.jsx'),
  '@getpaseo/plugin/client': resolve('tests/ui/host-hooks.jsx'),
} });
const methods: Record<string,string> = { attach:'attach', detach:'detach', 'tabs.list':'tabs.list', 'tabs.create':'tabs.create', 'tabs.close':'tabs.close', close:'close', reopen:'reopen', capture:'capture', 'control.acquire':'acquire-control', 'control.release':'release-control', navigate:'navigate', 'viewport.resize':'viewport', 'capture.density':'capture.density', 'device.apply':'device', input:'input', 'gesture.begin':'gesture.begin', 'gesture.update':'gesture.update', 'gesture.end':'gesture.end', 'video.read':'video.read', presence:'list' };
let bridge: SupervisorClient;
let failedRpc = false;
const http = createServer(async (req, res) => {
  try {
    if (req.url === '/app.js') { res.setHeader('Content-Type','application/javascript'); res.end(output.outputFiles[0].contents); return; }
    if (req.url === '/rpc') {
      let body=''; for await (const chunk of req) body += chunk;
      const { name, input } = JSON.parse(body);
      const operation = methods[name.replace(/^shared-browser\./,'')];
      if (!operation) throw new Error(`Missing test RPC ${name}`);
      const result = await bridge.requestBrowser(operation, input);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result)); return;
    }
    res.setHeader('Content-Type','text/html');
    if (req.url === '/fixture') { res.end('<!doctype html><title>Shared Chrome preview</title><style>body{margin:0;background:#f5f3ff;font:18px system-ui;color:#312e81}main{margin:60px auto;max-width:620px;background:white;padding:40px;border-radius:20px}h1{font-size:38px}button{background:#4f46e5;color:white;border:0;padding:14px 24px;border-radius:8px}</style><main><h1>One browser. Every device.</h1><p>This real Chrome page is shared by desktop, mobile and agents.</p><button onclick="this.textContent=\'Clicked in Chrome\'">Test interaction</button></main>'); return; }
    res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;display:flex;flex-direction:column}</style><div id="root"></div><script src="/app.js"></script>');
  } catch(error) { res.statusCode=400; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:String(error)})); if (!String(error).includes('Viewer token')) console.error(error); failedRpc=true; }
});
await new Promise<void>((r)=>http.listen(0,'127.0.0.1',r)); const address=http.address(); assert.ok(address && typeof address==='object');
const url=`http://127.0.0.1:${address.port}`;
const running = await startSupervisorServer(await createRuntimeOwner({initialUrl:`${url}/fixture`}), resolveSupervisorPaths(home));
bridge = new SupervisorClient({bridgeId:'ui-test',paths:resolveSupervisorPaths(home)});await bridge.connect();
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const errors:string[]=[];
const artifactDir=resolve('artifacts'); await mkdir(artifactDir,{recursive:true});
try {
  const seeded = await bridge.requestBrowser<{viewerToken:string}>('attach', {workspaceId:'ui-workspace',viewerLabel:'Agent-opened browser fixture'});
  await bridge.requestBrowser('detach', {viewerToken:seeded.viewerToken});
  for (const [name,width,height,theme] of [['desktop-dark',1440,1000,'dark'],['mobile-dark',390,844,'dark'],['desktop-light',1280,900,'light'],['mobile-light',390,844,'light']] as const) {
    const page=await browser.newPage(); page.on('pageerror',(error)=>errors.push(String(error)));
    await page.setViewport({width,height,deviceScaleFactor:1});
    await page.goto(`${url}/?theme=${theme}&auto=${name.endsWith('-auto')?'1':'0'}`);
    if (name.endsWith('-auto')) await page.waitForFunction('document.body.textContent.includes("Agent conversation")');
    await page.waitForFunction('Array.from(document.images).some(image=>image.naturalWidth>0)',{timeout:25_000});
    await page.waitForSelector('[aria-label="Shared control with agents"]', { timeout: 10_000 });
    assert.equal(await page.$('[aria-label="Take control"]'), null);
    assert.equal(await page.$('[aria-label="Release"]'), null);
    // Automatic capture density settles after the first decoded frame.
    await page.waitForFunction('Array.from(document.images).some(image=>image.naturalWidth===2560)', { timeout: 10_000 });
    const ticket = randomBytes(32).toString('base64url');
    await bridge.issueAgentTicket(ticket);
    await bridge.bindAgentTicket(ticket, `ui-agent-${name}`, 'ui-workspace');
    const agent = new AgentSupervisorClient({ ticket, paths: resolveSupervisorPaths(home) });
    await agent.open();
    try {
      await agent.request('capture', {});
      const moved = await agent.request('input', { event: { kind: 'move', point: { x: 420, y: 240, width: 1280, height: 800 } } });
      assert.ok((moved as any).state.agentCursor);
      try { await page.waitForSelector('[aria-label="Agent cursor"]', { timeout: 10_000 }); } catch (error) { await page.screenshot({ path: join(artifactDir, 'cursor-failure.png') }); console.log(await page.evaluate('document.body.innerText')); throw error; }
    } finally { agent.disconnect(); }
    await page.screenshot({path:join(artifactDir,`${name}.png`)});
    const overflow=await page.evaluate('document.documentElement.scrollWidth>innerWidth+2'); assert.equal(overflow,false,`${name}: page overflows`);
    await page.close();
    console.log(`PASS: ${name}, live Chrome frame, shared agent input, visible cursor and no horizontal overflow.`);
  }
  const cursorPage = await browser.newPage();
  await cursorPage.goto(`${url}/fixture`);
  const point = await cursorPage.$eval('button', button => {
    const rect = button.getBoundingClientRect(); return { x: rect.x + 10, y: rect.y + 10 };
  });
  await cursorPage.evaluate(agentCursorExpression(point.x, point.y));
  assert.equal(await cursorPage.evaluate(({ x, y }) => (globalThis as any).document.elementFromPoint(x, y)?.tagName, point), 'BUTTON');
  await cursorPage.mouse.click(point.x, point.y);
  assert.equal(await cursorPage.$eval('button', button => button.textContent), 'Clicked in Chrome');
  await cursorPage.screenshot({ path: join(artifactDir, 'native-agent-cursor.png') });
  await cursorPage.close();
  assert.deepEqual(errors,[]); assert.equal(failedRpc,false,'UI RPC errors');
} finally {
  await browser.close(); bridge.disconnect(); await running.close(); http.closeAllConnections();
  await new Promise<void>((r)=>http.close(()=>r())); await rm(home,{recursive:true,force:true});
}
