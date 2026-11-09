import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRuntimeOwner } from '../server/workspace/runtime-owner';
import { startSupervisorServer, resolveSupervisorPaths } from '../server/workspace/supervisor';
import { SupervisorClient } from '../server/workspace/supervisor-client';
import { resolveBrowserRuntimeRoot } from '../server/workspace/runtime-path';
import type { BrowserState } from '../shared/workspace/browser';

const assets = resolveBrowserRuntimeRoot(process.env.PASEO_HOME ?? join(homedir(), '.paseo'));
const home = await mkdtemp(join(tmpdir(), 'paseo-browser-workspace-smoke-'));
process.env.PASEO_HOME = home;
process.env.PASEO_BROWSER_WORKSPACE_AGENT_BROWSER_BINARY = join(assets, 'node_modules/.bin/agent-browser');
process.env.PASEO_BROWSER_WORKSPACE_CHROMIUM_EXECUTABLE = '/usr/bin/google-chrome';
const http = createServer((req, res) => {
  if (req.url === '/cookie-check') { res.end(req.headers.cookie ?? ''); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Workspace fixture</title><label>Name<input></label><button>Submit</button><output></output><script>
    document.querySelector('button').onclick=()=>{document.querySelector('output').textContent=document.querySelector('input').value; console.log('workspace-click'); fetch('/api');};
  </script>`);
});
await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
const address = http.address(); assert.ok(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
const workspaceId = 'smoke-workspace';
let running: Awaited<ReturnType<typeof startSupervisorServer>> | undefined;
let bridge: SupervisorClient | undefined;
const clients: Client[] = [];
async function start() {
  running = await startSupervisorServer(await createRuntimeOwner({ initialUrl: url }), resolveSupervisorPaths(home));
  bridge = new SupervisorClient({ bridgeId: 'test-bridge', paths: resolveSupervisorPaths(home) });
  await bridge.connect();
}
async function agent() {
  const ticket = randomBytes(32).toString('base64url');
  await bridge!.issueAgentTicket(ticket);
  await bridge!.bindAgentTicket(ticket, 'test-agent', workspaceId);
  const env = { PASEO_HOME: home, PASEO_BROWSER_WORKSPACE_TICKET: ticket, PASEO_BROWSER_WORKSPACE_ROOT: home };
  const shared = new Client({ name: 'smoke-shared', version: '0.2.0' });
  const devtools = new Client({ name: 'smoke-devtools', version: '0.2.0' });
  clients.push(shared, devtools);
  await shared.connect(new StdioClientTransport({ command: process.execPath, args: [join(assets, 'shared-browser-mcp.cjs')], env, stderr: 'inherit' }));
  await devtools.connect(new StdioClientTransport({ command: process.execPath, args: [join(assets, 'devtools-mcp.cjs')], env, stderr: 'inherit' }));
  return { shared, devtools };
}
function text(result: any): string { return result.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n'); }
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
  assert.ok(!result.isError, `${name}: ${text(result)}`);
  return result;
}
async function viewers() {
  const first = await bridge!.requestBrowser<{ viewerToken: string; state: BrowserState }>('attach', { workspaceId, viewerLabel: 'Desktop' });
  const second = await bridge!.requestBrowser<{ viewerToken: string; state: BrowserState }>('attach', { workspaceId, viewerLabel: 'Phone' });
  assert.equal(first.state.runtimeId, second.state.runtimeId);
  return { first, second };
}
try {
  await start();
  const { first, second } = await viewers();
  const { shared, devtools } = await agent();
  assert.match(shared.getInstructions() ?? '', /CUA.*separate integration/);
  assert.match(devtools.getInstructions() ?? '', /paseo-browser/);
  assert.equal((await shared.listTools()).tools.length, 11);
  assert.equal((await devtools.listTools()).tools.length, 35);
  const human = await bridge!.requestBrowser<{ controlToken: string }>('acquire-control', { viewerToken: first.viewerToken });
  assert.equal((await shared.callTool({ name: 'shared_browser_acquire_control', arguments: {} })).isError, true, 'agent must not take human control');
  assert.equal((await devtools.callTool({ name: 'list_pages', arguments: {} })).isError, true, 'DevTools must not bypass human control');
  assert.equal((await devtools.callTool({ name: 'browser_cookies', arguments: { action: 'get' } })).isError, true, 'cookies must not bypass human control');
  assert.equal((await devtools.callTool({ name: 'cdp_send', arguments: { method: 'Target.getTargets' } })).isError, true, 'raw CDP must not bypass human control');
  await bridge!.requestBrowser('release-control', { viewerToken: first.viewerToken, controlToken: human.controlToken });
  await call(shared, 'shared_browser_acquire_control');
  const cdp = async (method: string, params: Record<string, unknown> = {}, targetId?: string) => JSON.parse(text(await call(devtools, 'cdp_send', { method, params, ...(targetId ? { targetId } : {}) })));
  const { targetInfos } = await cdp('Target.getTargets');
  const targetId = targetInfos.find((target: any) => target.type === 'page' && target.url.startsWith(url)).targetId;
  await cdp('Network.enable', {}, targetId);
  await call(devtools, 'browser_cookies', { action: 'set', cookies: [
    { name: 'agent_http_only', value: 'imported-session', url, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now()/1000)+3600 },
    { name: 'agent_secure', value: 'secure-session', url: 'https://cookie-fixture.invalid/', secure: true, httpOnly: true, sameSite: 'None' },
  ] });
  const exported = JSON.parse(text(await call(devtools, 'browser_cookies', { action: 'get' })));
  assert.equal(exported.cookies.find((cookie: any) => cookie.name === 'agent_http_only').httpOnly, true);
  assert.equal(exported.cookies.find((cookie: any) => cookie.name === 'agent_secure').secure, true);
  const jsCookies = await cdp('Runtime.evaluate', { expression: 'document.cookie', returnByValue: true }, targetId);
  assert.ok(!jsCookies.result.value.includes('agent_http_only'));
  const response = await cdp('Runtime.evaluate', { expression: 'fetch("/cookie-check").then(r=>r.text())', awaitPromise: true, returnByValue: true }, targetId);
  assert.match(response.result.value, /agent_http_only=imported-session/);
  const events = JSON.parse(text(await call(devtools, 'cdp_events', { targetId, method: 'Network.requestWillBeSent' })));
  assert.ok(events.events.some((event: any) => event.params.request.url.endsWith('/cookie-check')));
  assert.equal(JSON.parse(text(await call(devtools, 'cdp_events', { targetId, method: 'Network.requestWillBeSent' }))).events.length, 0);
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*intercept-fixture*' }] }, targetId);
  await cdp('Runtime.evaluate', { expression: 'globalThis.__intercepted = fetch("/intercept-fixture").then(r=>r.text())' }, targetId);
  let paused: any;
  for (let attempt = 0; attempt < 50 && !paused; attempt++) {
    const batch = JSON.parse(text(await call(devtools, 'cdp_events', { targetId, method: 'Fetch.requestPaused' })));
    paused = batch.events[0];
    if (!paused) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(paused, 'Fetch interception event');
  await cdp('Fetch.fulfillRequest', { requestId: paused.params.requestId, responseCode: 200, body: Buffer.from('agent intercepted response').toString('base64') }, targetId);
  const intercepted = await cdp('Runtime.evaluate', { expression: 'globalThis.__intercepted', awaitPromise: true, returnByValue: true }, targetId);
  assert.equal(intercepted.result.value, 'agent intercepted response');
  await cdp('Fetch.disable', {}, targetId);
  await call(devtools, 'browser_cookies', { action: 'delete', name: 'agent_secure', url: 'https://cookie-fixture.invalid/' });
  assert.ok(!JSON.parse(text(await call(devtools, 'browser_cookies', { action: 'get' }))).cookies.some((cookie: any) => cookie.name === 'agent_secure'));
  console.log('PASS: raw CDP, persistent page sessions, network events, HttpOnly/Secure cookie import/export, HTTP delivery and deletion.');
  const pages = text(await call(devtools, 'list_pages'));
  const match = pages.match(/(?:^|\n)(\d+): Workspace fixture/); assert.ok(match, pages);
  const pageId = Number(match[1]);
  const snapshot = text(await call(devtools, 'take_snapshot', { pageId }));
  const input = snapshot.match(/uid=([^\s]+) textbox/); const button = snapshot.match(/uid=([^\s]+) button "Submit"/); assert.ok(input && button, snapshot);
  await call(devtools, 'fill', { pageId, uid: input[1], value: 'Same browser' });
  await call(devtools, 'click', { pageId, uid: button[1] });
  assert.match(text(await call(devtools, 'evaluate_script', { pageId, function: '() => { localStorage.setItem("paseo-login", "persisted"); document.cookie="paseo_login=persisted; Max-Age=3600; Path=/"; return document.querySelector("output").textContent; }' })), /Same browser/);
  assert.match(text(await call(devtools, 'list_console_messages', { pageId })), /workspace-click/);
  assert.match(text(await call(devtools, 'list_network_requests', { pageId })), /\/api/);
  const capture = await bridge!.requestBrowser<{ state: BrowserState; frame: { dataBase64: string } }>('capture', { viewerToken: second.viewerToken, quality: 'medium', knownFrameId: null });
  assert.ok(capture.frame.dataBase64.length > 100); assert.equal(capture.state.url.replace(/\/$/, ''), url);
  await writeFile(join(home, 'shared-frame.jpg'), Buffer.from(capture.frame.dataBase64, 'base64'));
  console.log('PASS: two viewers + 11 shared tools + 35 DevTools tools; input, console, network and shared capture.');
  await call(shared, 'shared_browser_release_control');
  const tab = JSON.parse(text(await call(shared, 'shared_browser_tab_open')));
  assert.ok(tab.tabId);
  await call(shared, 'shared_browser_acquire_control');
  const otherHuman = await bridge!.requestBrowser<{ controlToken: string }>('acquire-control', { viewerToken: second.viewerToken });
  const refused = await devtools.callTool({ name: 'evaluate_script', arguments: { pageId, function: '() => document.title="WRONG"' } });
  assert.equal(refused.isError, true); assert.match(text(refused), /exclusive workspace control/);
  await bridge!.requestBrowser('release-control', { viewerToken: second.viewerToken, controlToken: otherHuman.controlToken });
  await call(shared, 'shared_browser_tab_close');
  await call(shared, 'shared_browser_acquire_control');
  const created = text(await call(devtools, 'new_page', { url: `${url}/second` }));
  const createdMatches = [...created.matchAll(/(?:^|\n)(\d+): Workspace fixture/g)];
  assert.equal(createdMatches.length, 2, created);
  const firstPage = createdMatches[0][1];
  await call(devtools, 'close_page', { pageId: Number(firstPage) });
  const afterClose = JSON.parse(text(await call(shared, 'shared_browser_tabs')));
  assert.equal(afterClose.tabs.length, 1);
  await call(shared, 'shared_browser_tab_select', { tabId: afterClose.tabs[0].id });
  await call(shared, 'shared_browser_acquire_control');
  const recoveredCapture = await call(shared, 'shared_browser_capture');
  assert.ok((recoveredCapture.content as any[]).some(part => part.type === 'image'));
  console.log('PASS: tab creation/selection/close, DevTools closing the original tab, and human control on another tab fences DevTools.');
  for (const client of clients.splice(0)) await client.close();
  bridge!.disconnect(); await running!.close(); running = undefined;
  await start();
  const restored = await agent();
  await call(restored.shared, 'shared_browser_acquire_control');
  const restoredPages = text(await call(restored.devtools, 'list_pages'));
  const restoredMatch = restoredPages.match(/(?:^|\n)(\d+): Workspace fixture/); assert.ok(restoredMatch, restoredPages);
  const persisted = text(await call(restored.devtools, 'evaluate_script', { pageId: Number(restoredMatch[1]), function: '() => ({ login: localStorage.getItem("paseo-login"), cookie: document.cookie })' }));
  assert.match(persisted, /persisted/); assert.match(persisted, /paseo_login=persisted/);
  assert.ok(JSON.parse(text(await call(restored.devtools, 'browser_cookies', { action: 'get' }))).cookies.some((cookie: any) => cookie.name === 'agent_http_only'));
  await call(restored.devtools, 'browser_cookies', { action: 'clear' });
  assert.equal(JSON.parse(text(await call(restored.devtools, 'browser_cookies', { action: 'get' }))).cookies.length, 0);
  console.log('PASS: HttpOnly cookies and localStorage survive full supervisor/browser restart; cookie clear works.');
} finally {
  for (const client of clients) await client.close().catch(() => {});
  bridge?.disconnect();
  await running?.close();
  http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve()));
  await rm(home, { recursive: true, force: true });
}
