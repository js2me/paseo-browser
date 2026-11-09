# Paseo Browser

Native Chromium in Paseo Desktop, with a live mobile broadcast of the same browser session. Agents and people use the same tabs, cookies and page state.

## Native desktop and mobile

The default `hybrid` mode embeds an actual Electron WebView in the workspace panel. Desktop rendering, keyboard, mouse and scrolling run in Chromium. Mobile and browser clients receive MJPEG frames from that exact guest through authenticated Paseo plugin RPCs. The desktop remains the browser host; websites and `localhost` URLs run on that desktop.

Remote capture starts only when a viewer is watching. It publishes the latest frame with no playback backlog, bounds frames to 1280 × 960 at JPEG quality 65, and requests approximately 15 updates per second. Closing the desktop panel parks its native guests without destroying them, so mobile viewing can continue. The desktop application must remain connected. iOS and Android use their native image component for the JPEG stream.

Each workspace supports eight native tabs. Take and release control to pass the browser between a person and agents. Native agent tools wait for an in-flight command before a human takeover and reject commands whose lease changed. Dispatched mutations are never automatically retried. Mobile taps target the desktop viewport; the text controls send input to the focused page field.

Native tabs use `persist:paseo-browser`, the same profile as Paseo's built-in browser. Cookies and logins are shared across native workspace tabs. This is independent of the legacy daemon Chrome profiles.

## Desktop bridge setup

Paseo's existing desktop WebView APIs support native rendering. Mobile frame capture and full guest CDP require the bridge included in `integrations/paseo/`. Older desktops show an update message.

On Linux, prepare a separate copy of your existing desktop AppDir:

```sh
npm run prepare:native-desktop -- --source /path/to/Paseo-AppDir --destination /new/path/paseo-native
```

This copies the application, updates its ASAR browser bridge, preserves native dependencies and leaves the running app and daemon untouched. The destination must not already exist. Close the original desktop before launching `/new/path/paseo-native/run-native-paseo`. Use the normal sandbox flags for your installation. Do not restart a desktop-managed daemon while agents are running without arranging that interruption.

For a source build, apply `integrations/paseo/native-bridge.patch` to the documented Paseo revision and build its desktop package. See [bridge details](integrations/paseo/README.md).

Install the plugin on the daemon:

```sh
npm install
npm run typecheck
paseo plugin install /absolute/path/to/paseo-browser
```

Open **Open Workspace Browser** in the Command Center or the browser composer/header button. Agent browser requests reveal the panel in the displayed workspace. The phone shows the native desktop's broadcast. A workspace whose desktop browser is not available reports that condition instead of opening an independent Chrome.

## Agent tools

Native mode injects the `paseo-browser` MCP adapter:

- `native_browser_open`, `shared_browser_status`, control acquire/release, navigation and native tab tools.
- `native_browser_automation` for snapshots, click/fill/type, keyboard, wait, screenshot, upload/select, hover/drag, console/network logs, scrolling and resizing.
- `evaluate_script` for page JavaScript.
- `browser_cookies` for import/export, setting, deletion and clearing, including HttpOnly/Secure attributes.
- `cdp_send` and `cdp_events` for guest CDP domains and bounded protocol events.

Acquire control before actions and release afterward. `native_browser_automation` takes `{ name, args }`; use element refs from its current `snapshot`. Native browser IDs come from `shared_browser_tabs`. Browser-level commands cannot close or crash Paseo; manage native tabs through the dedicated tab tools. Cookie and protocol rules are enforced by Chromium. Native CDP is scoped to the registered guest and its owning window/workspace. Uploads use the desktop's filesystem and Paseo's workspace path checks.

The managed skill under `agent-skills/paseo-browser` is installed into the local agent skill directories. Existing agent sessions need reloading to discover the native adapter. Unrelated MCP servers and user prompts are preserved.

## Other connection modes

| Mode | Browser and viewing |
| --- | --- |
| `hybrid` | Native desktop WebView; same guest broadcast to mobile. Default for new settings. |
| `workspace` | Legacy persistent Chrome on the daemon, viewed as a stream on every client. 11 shared tools plus 35 DevTools tools. |
| `isolated` | Independent Chrome per agent, visible or headless. |
| `autoConnect` | Personal Chrome 144+ with remote debugging enabled and its connection approved. |
| `endpoint` | An existing Chrome debugging endpoint. |

Legacy workspace cookies and localStorage remain under `$PASEO_HOME/plugin-data/paseo-browser/profiles/`. Chrome MCP usage statistics and CrUX reporting are disabled. Legacy code and its MIT attribution remain in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Validation

```sh
npm run typecheck
npm test
npm run test:shared
npm run test:ui
PASEO_ELECTRON_BINARY=/path/to/electron npm run test:native
```

The native integration test uses a separate Electron process and profile, real WebViews and CDP, a real MCP adapter, and a phone-sized Chrome client. It checks native snapshots/screenshots/tabs, HttpOnly cookies, mobile touch, lease fencing, and fresh frames while the desktop pane is parked. Set `PASEO_CHECKOUT` to the Paseo source checkout containing the bridge patch; it defaults to `../paseo`. This validates a compact web client, not physical iOS/Android hardware.

`test:shared` and `test:ui` cover the retained legacy browser mode. Generated runtimes, local machine paths, node_modules and screenshots are excluded from the package or Git as appropriate.
