import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('preparation succeeds without Chrome and does not invoke a browser download', { skip: process.platform === 'win32' }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'paseo-browser-no-chrome-'));
  const preload = join(home, 'no-system-chrome.cjs');
  await writeFile(preload, `
    const fs=require('node:fs/promises');const cp=require('node:child_process');
    const originalAccess=fs.access;fs.access=async function(path,...rest){
      if(/^\\/(usr\\/bin|Applications)\\//.test(String(path))){const e=new Error('No installed Chrome');e.code='ENOENT';throw e;}
      return originalAccess.call(this,path,...rest);
    };
    const originalExec=cp.execFile;const custom=Symbol.for('nodejs.util.promisify.custom');cp.execFile=function(file,args,...rest){
      if(args?.[0]==='install')throw Error('Unexpected browser download');
      return originalExec.call(this,file,args,...rest);
    };cp.execFile[custom]=function(file,args,...rest){if(args?.[0]==='install')throw Error('Unexpected browser download');return originalExec[custom](file,args,...rest);};require('node:module').syncBuiltinESMExports();
  `);
  const env: NodeJS.ProcessEnv = { ...process.env, PASEO_HOME: home, NODE_OPTIONS: `--require=${preload}` };
  delete env.PASEO_BROWSER_WORKSPACE_CHROMIUM_EXECUTABLE;
  delete env.PASEO_BROWSER_WORKSPACE_AGENT_BROWSER_BINARY;
  try {
    const { stdout } = await execute(process.execPath, [resolve('server/workspace/prepare-runtime.mjs')], { env, timeout: 60_000 });
    assert.match(stdout, /Native mode is ready without a browser download/);
    const pointer = (await readFile(join(home, 'plugin-data/paseo-browser/runtime-current'), 'utf8')).trim();
    const root = join(home, 'plugin-data/paseo-browser', pointer);
    await access(join(root, 'native-browser-mcp.cjs'));
    await assert.rejects(access(join(root, 'chromium/chrome')));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
