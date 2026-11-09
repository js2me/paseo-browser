import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { browserSchema } from '../shared/settings';
import { browserServer } from '../server/browser';

const http = createServer((req, res) => {
  if (req.url === '/api') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Paseo Chrome smoke</title>
    <label>Name<input id="name"></label><button>Submit</button><output></output>
    <script>document.querySelector('button').addEventListener('click', () => {
      document.querySelector('output').textContent = document.querySelector('input').value;
      console.log('paseo-click'); fetch('/api');
    });</script>`);
});
await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
const address = http.address();
assert.ok(address && typeof address === 'object');
const config = browserServer(browserSchema.parse({
  mode: 'isolated',
  headless: true,
  chromeArgs: process.env.PASEO_BROWSER_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : [],
}), process.execPath);
const transport = new StdioClientTransport({ ...config, stderr: 'pipe' });
let diagnostics = '';
transport.stderr?.on('data', (chunk) => { diagnostics += chunk.toString(); });
const client = new Client({ name: 'paseo-browser-smoke', version: '1.0.0' });
function text(result: any): string { return result.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n'); }
let pageId: number | undefined;
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: { ...(pageId === undefined ? {} : { pageId }), ...args } });
  assert.ok(!result.isError, `${name}: ${text(result)}\n${diagnostics}`);
  return result;
}
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  for (const name of ['new_page', 'take_snapshot', 'click', 'fill', 'evaluate_script', 'take_screenshot', 'list_network_requests', 'list_console_messages']) assert.ok(tools.some((tool) => tool.name === name), name);
  const opened = text(await call('new_page', { url: `http://127.0.0.1:${address.port}` }));
  const match = opened.match(/(?:^|\n)(\d+): Paseo Chrome smoke/);
  assert.ok(match, opened);
  pageId = Number(match[1]);
  const snapshot = text(await call('take_snapshot'));
  const input = snapshot.match(/uid=([^\s]+) textbox/);
  const button = snapshot.match(/uid=([^\s]+) button "Submit"/);
  assert.ok(input && button, snapshot);
  await call('fill', { uid: input[1], value: 'Paseo works' });
  await call('click', { uid: button[1] });
  assert.match(text(await call('evaluate_script', { function: '() => document.querySelector("output").textContent' })), /Paseo works/);
  assert.match(text(await call('list_console_messages')), /paseo-click/);
  assert.match(text(await call('list_network_requests')), /\/api/);
  const screenshot = await call('take_screenshot');
  assert.ok((screenshot.content as any[]).some((part) => part.type === 'image'));
  console.log(`PASS: ${tools.length} Chrome tools; navigation, snapshot, fill, click, JavaScript, console, network, screenshot.`);
} finally {
  await client.close();
  await transport.close();
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
}
