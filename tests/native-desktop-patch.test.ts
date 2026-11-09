import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { Script } from 'node:vm';
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { patchDesktopArchive, readDesktopEntry, prepareNativeDesktop } = await import(
  pathToFileURL(resolve("server/native/patch-desktop.mjs")).href
);
function fixture() {
  type Node = { files?: Record<string, Node>; size?: number; offset?: string };
  const tree: Node = { files: {} };
  const chunks: Buffer[] = [];
  let offset = 0;
  const add = (path: string, text: string) => {
    const parts = path.split("/");
    const name = parts.pop()!;
    let parent = tree;
    for (const part of parts) {
      parent.files ??= {};
      parent.files[part] ??= { files: {} };
      parent = parent.files[part];
    }
    const bytes = Buffer.from(text);
    parent.files ??= {};
    parent.files[name] = { size: bytes.length, offset: String(offset) };
    chunks.push(bytes);
    offset += bytes.length;
  };
  add(
    "dist/preload.js",
    'const electron_1 = require("electron");\ncontextBridge.exposeInMainWorld("paseoDesktop", {\n    browser: {\n        original: true\n    }\n});',
  );
  add(
    "dist/features/browser-automation/ipc.js",
    "exports.registerBrowserAutomationIpc = () => {};",
  );
  add(
    "dist/features/browser-webviews/index.js",
    "exports.getPaseoBrowserWorkspaceId = () => {}; exports.getPaseoBrowserWebContentsForHostWindow = () => {};",
  );
  const json = Buffer.from(JSON.stringify(tree));
  const payload = 4 + Math.ceil(json.length / 4) * 4;
  const pickle = Buffer.alloc(payload + 4);
  pickle.writeUInt32LE(payload);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(4);
  header.writeUInt32LE(pickle.length, 4);
  return Buffer.concat([header, pickle, ...chunks]);
}
test("desktop overlay preserves original modules and adds the native bridge without mutating its source", () => {
  const original = fixture();
  const before = Buffer.from(original);
  const updated = patchDesktopArchive(
    original,
    "exports.registerNativeBrowserBridgeIpc = () => {};",
  );
  new Script(readDesktopEntry(updated,'dist/preload.js'));
  new Script(readDesktopEntry(updated,'dist/features/browser-automation/ipc.js'));
  assert.deepEqual(original, before);
  assert.match(readDesktopEntry(updated, "dist/preload.js"), /nativeBridgeVersion: 1/);
  assert.match(readDesktopEntry(updated, "dist/preload.js"), /original: true/);
  assert.match(
    readDesktopEntry(updated, "dist/features/browser-automation/ipc.js"),
    /registerNativeBrowserBridgeIpc/,
  );
  assert.equal(
    readDesktopEntry(updated, "dist/features/browser-webviews/index.js"),
    readDesktopEntry(original, "dist/features/browser-webviews/index.js"),
  );
  assert.equal(
    readDesktopEntry(updated, "dist/features/browser-automation/native-bridge.js"),
    "exports.registerNativeBrowserBridgeIpc = () => {};",
  );
  assert.throws(() => patchDesktopArchive(updated, ""), /already has a native bridge/);
});

test('prepared desktop launcher executes its copied AppRun and keeps the source archive unchanged',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'paseo-desktop-overlay-'));
 try{
  const source=join(directory,'source');await mkdir(join(source,'resources'),{recursive:true});const archive=fixture();await writeFile(join(source,'resources/app.asar'),archive);await writeFile(join(source,'Paseo.bin'),'fixture');
  await writeFile(join(source,'AppRun'),`#!/bin/sh
printf 'native launcher fixture'
`,{mode:0o755});
  const launcher=await prepareNativeDesktop(source,join(directory,'prepared'));
  const result=await promisify(execFile)(launcher);assert.equal(result.stdout,'native launcher fixture');
  assert.deepEqual(await readFile(join(source,'resources/app.asar')),archive);
 }finally{await rm(directory,{recursive:true,force:true});}
});
