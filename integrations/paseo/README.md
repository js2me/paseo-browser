# Native desktop bridge v1

The native DevTools API is built into the Paseo Desktop source integration. Standard Paseo can broadcast main-process screenshots of the same native tab, at up to five requests per second, and send mobile input to it. This bridge adds higher-rate capture and full CDP, including HttpOnly cookie management.

The plugin owns the native WebView and registers it with Paseo's existing browser registry. The desktop bridge adds three IPC capabilities to the preload browser API:

- `captureNativeFrame({ browserId, workspaceId, notBefore? })` starts bounded CDP capture on that guest and returns its latest fresh JPEG frame. Transparent guest pixels are composited on a browser-white canvas before encoding. Capture acknowledgements follow viewer demand, so unused frames are not encoded for export. Demand expires after 2.5 seconds. Background throttling is disabled only while a guest has remote viewers, then the original guest/host settings are restored.
- `sendNativeCommand({ browserId, workspaceId, method, params })` runs guest CDP commands. Each call resolves the actual registered WebContents for the caller's host window and workspace. Target discovery returns only that guest. Use plugin tab tools for target lifecycle. Closing or crashing Paseo through Browser commands is refused.
- `readNativeEvents({ browserId, workspaceId, method?, clear? })` reads a bounded event buffer, reporting dropped events. Capture frames are handled by the stream instead of being duplicated into this buffer.

`native-bridge.cjs` is the compiled main-process module. `native-bridge.patch` adds the same implementation and preload/IPC wiring to the Paseo source revision in `base.json`. Paseo source is Apache-2.0 licensed; its original distribution and licenses are retained by the desktop-copy tool.

## End-user setup

Use a Paseo Desktop release containing the native DevTools API. The plugin detects it automatically; there is no separate bridge installation. This integration is currently prepared in the Paseo source checkout and must be released upstream. Older Desktop builds report an update requirement for CDP-only operations.

## Developer overlay

The `prepare:native-desktop` helper is retained only for development against older Linux AppDirs. It prepares an independent copy and does not modify or restart the running application. It is not a distribution or installation mechanism for plugin users. Test the source integration below before submitting it upstream.

## Source build

Apply `native-bridge.patch` at the recorded source revision, run the repository's desktop typecheck/lint and browser automation tests, then build its desktop package. The bridge is platform-independent Electron code; the distribution-copy helper currently supports Linux AppDirs.

## Validation

The native smoke test uses a real Electron WebView and the actual bridge, registry and browser automation IPC. It exercises snapshots, native screenshots, tabs, HttpOnly cookies and CDP, then mirrors the same guest into a phone-sized web client. It parks the React desktop panel and hides its window before checking fresh frames and mobile touch. No personal browser profile is used.
