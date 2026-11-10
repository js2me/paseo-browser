# Native desktop bridge v1

The bridge is optional for native desktop rendering, DevTools and mobile viewing. Standard Paseo can broadcast main-process screenshots of the same native tab, at up to five requests per second, and send mobile input to it. This bridge adds higher-rate capture and full CDP, including HttpOnly cookie management.

The plugin owns the native WebView and registers it with Paseo's existing browser registry. The desktop bridge adds three IPC capabilities to the preload browser API:

- `captureNativeFrame({ browserId, workspaceId, notBefore? })` starts bounded CDP capture on that guest and returns its latest fresh JPEG frame. Transparent guest pixels are composited on a browser-white canvas before encoding. Capture acknowledgements follow viewer demand, so unused frames are not encoded for export. Demand expires after 2.5 seconds. Background throttling is disabled only while a guest has remote viewers, then the original guest/host settings are restored.
- `sendNativeCommand({ browserId, workspaceId, method, params })` runs guest CDP commands. Each call resolves the actual registered WebContents for the caller's host window and workspace. Target discovery returns only that guest. Use plugin tab tools for target lifecycle. Closing or crashing Paseo through Browser commands is refused.
- `readNativeEvents({ browserId, workspaceId, method?, clear? })` reads a bounded event buffer, reporting dropped events. Capture frames are handled by the stream instead of being duplicated into this buffer.

`native-bridge.cjs` is the compiled main-process module. `native-bridge.patch` adds the same implementation and preload/IPC wiring to the Paseo source revision in `base.json`. Paseo source is Apache-2.0 licensed; its original distribution and licenses are retained by the desktop-copy tool.

## Linux desktop copy

Run the plugin's `prepare:native-desktop` command with the existing AppDir as source and a new destination. The helper copies the distribution and appends the native module/API wiring to its ASAR, keeping original resources, unpacked modules and executable dependencies. It refuses an existing destination and never writes to the source installation.

For an AppImage currently running, its mounted AppDir is typically `/tmp/.mount_paseo…`. The generated `run-native-paseo` launches the copied distribution. With `DISPLAY` available, it selects X11/XWayland through `PASEO_ELECTRON_FLAGS`, retaining GPU acceleration. Hidden Electron 37 guests can leave CDP capture pending under Wayland. An explicit `PASEO_ELECTRON_FLAGS=--ozone-platform=wayland` overrides this default but may break mobile capture. Close the existing app first: both copies deliberately use the existing Paseo application identity, browser profile and settings. The helper does not launch either app or restart the daemon. A desktop-managed daemon can stop when its desktop quits, so schedule that interruption before switching.

The copy is a custom desktop build. Future upstream updates may not contain this bridge; reapply it or use an upstream release that advertises the same API. When the API is missing, the plugin keeps its native desktop tab and uses standard screenshot capture for mobile viewing. Full CDP tools report the missing bridge separately.

## Source build

Apply `native-bridge.patch` at the recorded source revision, run the repository's desktop typecheck/lint and browser automation tests, then build its desktop package. The bridge is platform-independent Electron code; the distribution-copy helper currently supports Linux AppDirs.

## Validation

The native smoke test uses a real Electron WebView and the actual bridge, registry and browser automation IPC. It exercises snapshots, native screenshots, tabs, HttpOnly cookies and CDP, then mirrors the same guest into a phone-sized web client. It parks the React desktop panel and hides its window before checking fresh frames and mobile touch. No personal browser profile is used.
