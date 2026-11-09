import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserSchema } from '../shared/settings';
import { browserServer, shouldAttach } from '../server/browser';
import contribute from '../index.server';
import type { PluginServerContext } from '@getpaseo/plugin/server';

const defaults = browserSchema.parse({ mode: 'isolated' });
test('rejects malformed endpoints only when endpoint mode is selected', () => {
  assert.equal(browserSchema.safeParse({ mode: 'endpoint', browserUrl: 'file:///etc/passwd' }).success, false);
  assert.equal(browserSchema.safeParse({ mode: 'endpoint', browserUrl: 'http://user:pass@localhost' }).success, false);
  assert.equal(browserSchema.safeParse({ mode: 'endpoint', browserUrl: 'http://127.0.0.1:9222' }).success, true);
});
test('launches local pinned MCP with isolated Chrome and telemetry off', () => {
  const config = browserServer(defaults, '/usr/bin/node');
  assert.equal(config.type, 'stdio');
  assert.equal(config.command, '/usr/bin/node');
  assert.ok(config.args[0].endsWith('/bin/chrome-devtools-mcp.js'));
  assert.ok(config.args.includes('--isolated'));
  assert.ok(config.args.includes('--no-usage-statistics'));
  assert.ok(config.args.includes('--no-performance-crux'));
  assert.equal(config.args.includes('--headless'), false);
});
test('attachment modes never pass browser launch options', () => {
  for (const mode of ['autoConnect', 'endpoint'] as const) {
    const config = browserServer({ ...defaults, mode, headless: true, executablePath: '/tmp/chrome', chromeArgs: ['--example'] }, '/usr/bin/node');
    assert.ok(config.args.includes(mode === 'autoConnect' ? '--autoConnect' : '--browserUrl=http://127.0.0.1:9222'));
    assert.equal(config.args.some((arg) => /isolated|headless|executablePath|chromeArg/.test(arg)), false);
  }
});
test('does not inject into history, opted-out agents or unsupported providers', () => {
  const request = { provider: 'codex', purpose: 'interactive', labels: {} };
  assert.equal(shouldAttach(defaults, request), true);
  assert.equal(shouldAttach(defaults, { ...request, purpose: 'history' }), false);
  assert.equal(shouldAttach(defaults, { ...request, provider: 'unknown' }), false);
  assert.equal(shouldAttach(defaults, { ...request, labels: { 'paseo-browser/enabled': 'false' } }), false);
  assert.equal(shouldAttach({ ...defaults, enabled: false }, request), false);
});
test('session-open hook preserves launch contributions and cleans up', async () => {
  let handler: ((event: { request: any }) => Promise<any>) | undefined;
  let removed = false;
  const server = {
    registerSettings: () => ({ read: async () => ({ status: 'ready', values: defaults }) }),
    handle: () => {},
    addHook: (name: string, fn: typeof handler) => {
      if (name !== 'agent.open.before') return () => {};
      handler = fn;
      return () => { removed = true; };
    },
  } as unknown as PluginServerContext;
  const cleanup = contribute(server);
  const request = { provider: 'codex', purpose: 'interactive', labels: {}, env: { A: 'B' }, tools: ['existing'], mcpServers: { existing: { type: 'http', url: 'https://example.com' } } };
  const result = await handler!({ request });
  assert.deepEqual(result.env, request.env);
  assert.deepEqual(result.tools, request.tools);
  assert.deepEqual(result.mcpServers.existing, request.mcpServers.existing);
  assert.equal(result.mcpServers['paseo-browser'].type, 'stdio');
  assert.equal(await handler!({ request: { ...request, purpose: 'history' } }), undefined);
  cleanup();
  assert.equal(removed, true);
});
