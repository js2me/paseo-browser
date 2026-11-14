import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { resolveBrowserRuntimeRoot } from '../server/workspace/runtime-path';
import { WorkspaceCdp } from '../server/workspace/cdp-runtime';

const http = createServer((_, res) => res.end('<!doctype html><title>Browser actions smoke</title><style>#inspect { color: rgb(255, 0, 0); width: 120px; } #inspect:hover { color: rgb(0, 0, 255); }</style><div id="inspect" data-test="original">Inspect me</div>'));
await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({
  executablePath: process.env.PASEO_BROWSER_TEST_CHROME ?? join(resolveBrowserRuntimeRoot(process.env.PASEO_HOME ?? join(homedir(), '.paseo')), 'chromium/chrome'),
  headless: true,
  args: ['--no-sandbox'],
});
const cdp = new WorkspaceCdp(async () => browser.wsEndpoint());
try {
  const page = await browser.newPage();
  const address = http.address();
  assert.ok(address && typeof address === 'object');
  await page.goto(`http://127.0.0.1:${address.port}`);
  const { targetInfos } = await cdp.call('cdp_send', { method: 'Target.getTargets' }) as any;
  const targetId = targetInfos.find((target: any) => target.url === page.url()).targetId;
  const call = (name: string, args: object) => cdp.call(name, { ...args, targetId });
  const inspected = await call('browser_inspect', { selector: '#inspect', properties: ['color', 'width'], maxHtmlLength: 10 }) as any;
  assert.equal(inspected.computedStyle.color, 'rgb(255, 0, 0)');
  assert.equal(inspected.rect.width, 120);
  assert.equal(inspected.html.length, 10);
  assert.equal(inspected.htmlTruncated, true);
  assert.equal(inspected.attributes['data-test'], 'original');
  await assert.rejects(call('browser_inspect', { selector: '#absent' }), /No element matches/);
  const { root } = await call('browser_dom', { action: { kind: 'document' } }) as any;
  const { nodeId } = await call('browser_dom', { action: { kind: 'query', nodeId: root.nodeId, selector: '#inspect' } }) as any;
  assert.ok(nodeId > 0);
  const { matchedCSSRules } = await call('browser_css', { action: { kind: 'matched', nodeId } }) as any;
  const rule = matchedCSSRules.find((item: any) => item.rule.selectorList.text === '#inspect').rule;
  assert.ok(rule.styleSheetId);
  const { text: stylesheet } = await call('browser_css', { action: { kind: 'stylesheet', styleSheetId: rule.styleSheetId } }) as any;
  assert.match(stylesheet, /120px/);
  const { model } = await call('browser_dom', { action: { kind: 'box', nodeId } }) as any;
  assert.equal(model.width, 120);
  await call('browser_css', { action: { kind: 'force_pseudo', nodeId, forcedPseudoClasses: ['hover'] } });
  const hovered = await call('browser_css', { action: { kind: 'computed', nodeId } }) as any;
  assert.equal(hovered.computedStyle.find((item: any) => item.name === 'color').value, 'rgb(0, 0, 255)');
  await call('browser_css', { action: { kind: 'force_pseudo', nodeId, forcedPseudoClasses: [] } });
  await call('browser_dom', { action: { kind: 'set_attribute', nodeId, name: 'data-test', value: 'changed' } });
  assert.match((await call('browser_dom', { action: { kind: 'html', nodeId } }) as any).outerHTML, /data-test="changed"/);
  await call('browser_css', { action: { kind: 'set_style', edits: [{ styleSheetId: rule.styleSheetId, range: rule.style.range, text: 'color: rgb(0, 128, 0); width: 150px;' }] } });
  const edited = await call('browser_inspect', { selector: '#inspect', properties: ['color'] }) as any;
  assert.equal(edited.computedStyle.color, 'rgb(0, 128, 0)');
  assert.equal(edited.rect.width, 150);
  await call('browser_storage', { area: 'local', action: { kind: 'set', key: 'test', value: 'works' } });
  assert.equal(await call('browser_storage', { area: 'local', action: { kind: 'get', key: 'test' } }), 'works');
  await call('browser_emulate', { action: { kind: 'media', colorScheme: 'dark' } });
  assert.equal(await page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches"), true);
  await call('browser_network', { action: { kind: 'conditions', offline: true } });
  assert.equal(await page.evaluate("navigator.onLine"), false);
  await call('browser_network', { action: { kind: 'conditions' } });
  assert.equal(await page.evaluate("navigator.onLine"), true);
  // No explicit Page.enable: the cached workspace session must already observe dialogs.
  const reply = call('cdp_send', { method: 'Runtime.evaluate', params: { expression: "prompt('Question?')", returnByValue: true } });
  let settled = false;
  void reply.then(() => { settled = true; });
  const deadline = Date.now() + 5000;
  let opening: any;
  while (!opening && Date.now() < deadline) {
    const result = await call('cdp_events', { method: 'Page.javascriptDialogOpening' }) as any;
    opening = result.events[0];
    if (!opening) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(opening, 'Page dialog event must be buffered without explicit Page.enable');
  assert.equal(opening.params.type, 'prompt');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(settled, false, 'session must leave the dialog open until explicitly answered');
  // Cookie deletion can complete on the Page-enabled session while Runtime waits.
  await cdp.call('browser_cookies', { action: 'set', cookies: [{ name: 'dialog_test', value: 'value', url: page.url() }] });
  await cdp.call('browser_cookies', { action: 'delete', name: 'dialog_test', url: page.url() });
  await call('browser_dialog', { accept: true, promptText: 'answered' });
  assert.equal((await reply as any).result.value, 'answered');
  await call('browser_emulate', { action: { kind: 'reset' } });
  await call('browser_storage', { area: 'local', action: { kind: 'clear' } });
  assert.deepEqual(await call('browser_storage', { area: 'local', action: { kind: 'get' } }), {});
  console.log('PASS: real Chromium HTML, DOM, box model, matched/computed CSS, stylesheet source, forced hover and live edits; storage, emulation, network and dialogs');
} finally {
  cdp.close();
  await browser.close();
  http.closeAllConnections();
  await new Promise<void>(resolve => http.close(() => resolve()));
}
