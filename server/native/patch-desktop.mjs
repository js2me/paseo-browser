import { createHash } from "node:crypto";
import { readFile, writeFile, cp, chmod, mkdir, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function header(buffer) {
  if (buffer.readUInt32LE(0) !== 4) throw Error("Unsupported ASAR header");
  const size = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(12);
  if (size < 8 || length > size - 8 || size + 8 > buffer.length) throw Error("Invalid ASAR size");
  return { tree: JSON.parse(buffer.subarray(16, 16 + length).toString()), offset: 8 + size };
}
function entry(tree, path) {
  let current = tree;
  for (const part of path.split("/")) {
    current = current.files?.[part];
    if (!current) throw Error(`Desktop bundle is missing ${path}`);
  }
  return current;
}
export function patchDesktopArchive(original, bridgeModule) {
  const { tree, offset } = header(original);
  const data = original.subarray(offset);
  const appended = [];
  let next = data.length;
  const read = (path) => {
    const node = entry(tree, path);
    if (node.unpacked) throw Error(`Expected a packed desktop module: ${path}`);
    return data.subarray(Number(node.offset), Number(node.offset) + node.size).toString();
  };
  const replace = (path, source) => {
    const bytes = Buffer.from(source);
    const parts = path.split("/");
    const name = parts.pop();
    let parent = tree;
    for (const part of parts) {
      parent.files ??= {};
      parent.files[part] ??= { files: {} };
      parent = parent.files[part];
    }
    const blockSize = 4194304;
    const blocks = [];
    for (let index = 0; index < bytes.length; index += blockSize)
      blocks.push(
        createHash("sha256")
          .update(bytes.subarray(index, index + blockSize))
          .digest("hex"),
      );
    parent.files[name] = {
      size: bytes.length,
      offset: String(next),
      integrity: {
        algorithm: "SHA256",
        hash: createHash("sha256").update(bytes).digest("hex"),
        blockSize,
        blocks,
      },
    };
    next += bytes.length;
    appended.push(bytes);
  };
  const preload = read("dist/preload.js");
  if (preload.includes("nativeBridgeVersion"))
    throw Error(
      "Source desktop already has a native bridge; use the original application directory",
    );
  if (!preload.includes("    browser: {")) throw Error("Unsupported desktop preload browser API");
  const registry = read("dist/features/browser-webviews/index.js");
  if (
    !registry.includes("getPaseoBrowserWorkspaceId") ||
    !registry.includes("getPaseoBrowserWebContentsForHostWindow")
  )
    throw Error("Desktop browser ownership APIs are unavailable");
  const ipc = read("dist/features/browser-automation/ipc.js");
  if (!ipc.includes("registerBrowserAutomationIpc")) throw Error("Unsupported desktop browser IPC");
  replace(
    "dist/preload.js",
    preload.replace(
      "    browser: {",
      `    browser: {
        nativeBridgeVersion: 1,
        captureNativeFrame: input => electron_1.ipcRenderer.invoke("paseo:browser:native-frame", input),
        sendNativeCommand: input => electron_1.ipcRenderer.invoke("paseo:browser:native-command", input),
        readNativeEvents: input => electron_1.ipcRenderer.invoke("paseo:browser:native-events", input),`,
    ),
  );
  replace(
    "dist/features/browser-automation/ipc.js",
    ipc + '\nrequire("./native-bridge.js").registerNativeBrowserBridgeIpc();\n',
  );
  replace("dist/features/browser-automation/native-bridge.js", bridgeModule);
  const json = Buffer.from(JSON.stringify(tree));
  const payload = 4 + Math.ceil(json.length / 4) * 4;
  const pickle = Buffer.alloc(payload + 4);
  pickle.writeUInt32LE(payload, 0);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(pickle.length, 4);
  return Buffer.concat([size, pickle, data, ...appended]);
}
export function readDesktopEntry(archive, path) {
  const { tree, offset } = header(archive);
  const node = entry(tree, path);
  return archive
    .subarray(offset + Number(node.offset), offset + Number(node.offset) + node.size)
    .toString();
}

/** Wayland can leave hidden Electron guests without a captureable compositor surface. */
export function nativeDesktopLauncher() {
  return [
    '#!/bin/sh',
    'cd "$(dirname "$0")"',
    'APPDIR="$(pwd)"',
    'export APPDIR',
    'unset APPIMAGE',
    'if [ -n "${DISPLAY:-}" ]; then',
    '  case " ${PASEO_ELECTRON_FLAGS:-} " in',
    '    *--ozone-platform=*) ;;',
    '    *) PASEO_ELECTRON_FLAGS="${PASEO_ELECTRON_FLAGS:+$PASEO_ELECTRON_FLAGS }--ozone-platform=x11" ;;',
    '  esac',
    '  export PASEO_ELECTRON_FLAGS',
    'fi',
    'exec ./AppRun "$@"',
    '',
  ].join("\n");
}

export async function prepareNativeDesktop(source, destination) {
  source = resolve(source);
  destination = resolve(destination);
  if (
    source === destination ||
    source.startsWith(destination + "/") ||
    destination.startsWith(source + "/")
  )
    throw Error("Use independent source and destination directories");
  const archivePath = join(source, "resources", "app.asar");
  const original = await readFile(archivePath);
  const modulePath = fileURLToPath(
    new URL("../../integrations/paseo/native-bridge.cjs", import.meta.url),
  );
  const patched = patchDesktopArchive(original, await readFile(modulePath, "utf8"));
  try {
    await access(destination);
    throw Error(
      "Destination already exists. Choose a new directory; existing installations are preserved.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
  await chmod(destination, 0o755);
  const output = join(destination, "resources", "app.asar");
  await chmod(output, 0o644);
  await writeFile(output, patched);
  const executable = join(destination, "Paseo.bin");
  await access(executable);
  await writeFile(
    join(destination, "run-native-paseo"),
    nativeDesktopLauncher(),
    { mode: 0o755 },
  );
  return join(destination, "run-native-paseo");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const value = (flag) => {
    const index = process.argv.indexOf(flag);
    return index < 0 ? null : process.argv[index + 1];
  };
  const source = value("--source");
  const destination = value("--destination");
  if (!source || !destination)
    throw Error(
      "Usage: node server/native/patch-desktop.mjs --source /path/to/desktop --destination /new/path",
    );
  console.log(await prepareNativeDesktop(source, destination));
  console.log(
    "Prepared a separate desktop copy. The running application and daemon were not changed.",
  );
}
