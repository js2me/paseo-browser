# paseo-browser

Shared Chrome for Paseo workspaces, with a live desktop/mobile panel and the full default Chrome DevTools MCP toolset for agents.

## Setup

Requires Paseo >=0.15.0 and Node.js >=24 on the daemon machine.

```sh
npm ci
npm run typecheck
npm run install:agent-skill
paseo plugin install /absolute/path/to/paseo-browser
paseo plugin ls
```

Preparation installs a pinned `agent-browser` runtime, stages Chrome, discovers the pinned DevTools tools and builds the supervisor and MCP adapters. Installed Google Chrome/Chromium is preferred on Linux and macOS; otherwise preparation downloads Chrome for Testing. Linux ARM64 requires native non-Snap Chromium. No npx package download happens during an agent launch.

If `paseo` starts the desktop app instead of the CLI, use `npx --yes --package=@getpaseo/cli@0.15.0 paseo` for the commands above.

When the displayed workspace has a running shared browser, its header or composer automatically reveals the live browser in the Explorer side panel beside the agent chat. You can also use **Open Workspace Browser** in the Command Center or the browser button in the workspace header. Existing browser sessions also appear in the sidebar and composer. All these entry points target the side panel. The automatic reveal runs once per live browser on each client; closing the panel manually is respected until that browser is closed and reopened. Background workspaces do not request a panel reveal through their inactive headers or composers. On phones, the composer triggers the reveal even when header buttons are hidden in the workspace menu. Use **Take control** and **Release** to hand control between a person and agents. The address bar, tabs, mouse, keyboard and touch all act on the daemon-hosted Chrome. Compact layouts support text composition, viewport presets and mobile emulation. Fit/actual-size/fill modes, capture density and quality are available through display options.

## Agent tools and shared state

Workspace mode is the default for installations without saved connection preferences. Agents receive two local MCP servers:

- `paseo-browser`: 11 `shared_browser_*` tools for state, screenshots, control leases, tabs, navigation, input and viewport.
- `paseo-browser-devtools`: 35 tools: the 32 default Chrome DevTools tools plus `browser_cookies`, `cdp_send` and `cdp_events`.

Both operate on the same Chrome profile and pages shown in the panel. The DevTools server stays behind the workspace supervisor; agents receive workspace-bound credentials, not an unrestricted debugging endpoint. Upstream tool schemas are discovered from the installed, pinned MCP package during preparation.

`browser_cookies` reads/exports, imports/sets, deletes and clears profile cookies, including HttpOnly, Secure, SameSite, expiry and partition keys. `cdp_send` exposes arbitrary Chrome DevTools Protocol commands; obtain page target IDs with `Target.getTargets`. Persistent target sessions support DOM, debugger, network interception, browser permissions, emulation, IndexedDB and storage. `cdp_events` drains a bounded 500-event buffer, filtered by target/method. Enable the appropriate protocol domain first and finish intercepted requests or resume paused scripts before releasing control. Chrome applies its normal protocol and cookie validation. These additional tools are available in workspace mode.

Example request:

> Use the shared workspace browser. Acquire control, inspect the login form, fill it, submit, check the network and console, then release control so I can continue.

Agents cannot force a human to relinquish a tab. DevTools can modify multiple tabs, so every DevTools call requires control of the agent's selected tab and refuses while any other participant controls another tab. Control acquisition and browser policy actions serialize with that call. A human takeover waits for an already-dispatched tool to complete, bounded by a 20-second MCP timeout. Interrupted mutations are not retried.

Each viewer and agent selects tabs independently. DevTools uses explicit `pageId` values from `list_pages`. Shared tools use tab IDs from `shared_browser_tabs`. If DevTools closes an agent's selected tab, select a remaining shared tab and acquire control again. Use panel/shared viewport controls for the canonical displayed viewport; separate CDP sessions may override emulation settings.

Cookies and local storage persist under `$PASEO_HOME/plugin-data/paseo-browser/profiles/`. Closing a panel keeps Chrome running. **Close shared browser** stops that workspace browser; reopening retains its profile. Archiving closes the browser and retains its profile. Profiles are local to the daemon machine, separate from personal Chrome profiles. All authorized Paseo clients of the daemon can view shared browser sessions. Panel clipboard sync, native file-transfer dialogs, media permissions, extension management and passkeys are not provided. Agents can use DevTools file-upload tools.

## Connection settings

Open **Settings → Plugins → Chrome browser → settings**, or find **Chrome browser settings** in the Command Center.

| Mode | Behavior |
| --- | --- |
| Shared workspace browser | One persistent Chrome per workspace, viewed inside Paseo and used by both MCP servers. |
| Separate Chrome per agent | Visible or headless Chrome with a temporary profile; independent DevTools sessions. |
| My running Chrome | Chrome 144+; enable `chrome://inspect/#remote-debugging` and approve Chrome's connection prompt. Uses existing tabs and logins. |
| Chrome debugging endpoint | Connect DevTools to an already debuggable Chrome, such as `http://127.0.0.1:9222`. |

Existing saved connection modes are preserved. The workspace panel always shows the workspace-owned browser; standalone connection modes are independent of that panel. Save settings and run `paseo plugin reload paseo-browser` to apply mode changes to existing sessions before their next idle prompt. Active turns continue. New sessions read saved settings immediately. The daemon does not need a restart.

Default provider IDs are `codex`, `claude`, `copilot`, and `opencode`. Additional providers must support injected MCP servers. Agent label `paseo-browser/enabled=false` disables its tools. No permission policy or provider sandbox setting is changed. Separate-browser executable, headless and Chrome-argument settings apply only to separate mode.

The workspace runtime accepts these host environment overrides:

| Variable | Purpose |
| --- | --- |
| `PASEO_BROWSER_WORKSPACE_CHROMIUM_EXECUTABLE` | Absolute path to Chrome/Chromium; also used during preparation. |
| `PASEO_BROWSER_WORKSPACE_CHROMIUM_ARGS` | Additional Chromium arguments, comma separated. |
| `PASEO_BROWSER_WORKSPACE_XVFB=1` | Optional private Linux virtual display for headed browser media behavior. |
| `PASEO_BROWSER_WORKSPACE_VIDEO=1` | Optional encoded-video transport; image streaming remains the default. |

Browser execution and networking happen on the daemon host. Google MCP usage statistics and CrUX URL reporting are disabled. Chrome privacy settings remain independent. Standalone personal-Chrome mode exposes existing signed-in sites to agents. Workspace DevTools file access is rooted at the working directory of the first agent to open its DevTools connection; use one workspace per checkout.

## Development and tests

```sh
npm run typecheck
npm test
npm run test:workspace
npm run test:chrome
npm run test:shared
npm run test:ui
```

- Unit/regression coverage includes the inherited workspace browser tests and the integration's settings and launch hooks.
- `test:chrome` runs the standalone Chrome tools against a local form fixture.
- `test:shared` runs a real isolated Chrome, two viewer connections and both MCP adapters. It checks HttpOnly/Secure cookie import/export/deletion, cookie delivery to HTTP requests, raw CDP, protocol events, network interception, human priority, cross-tab DevTools fencing, form input, shared screenshots, console/network, tab operations and persisted cookies/localStorage after a complete supervisor/browser restart.
- `test:ui` mounts the actual panel in a test host with React Native Web and real RPC/browser data. It checks automatic side-panel reveal beside the conversation, live frames, acquire/release and overflow at desktop/phone dimensions in dark/light themes; screenshots go to `artifacts/`. Host-only UI primitives are substituted in this harness, so it complements checking the panel inside Paseo. This does not claim validation on physical iOS/Android hardware.

Browser smoke tests use `/usr/bin/google-chrome` on Linux and temporary profiles, never personal browsing data. `PASEO_BROWSER_TEST_NO_SANDBOX=1` is an explicit opt-out available only for the standalone smoke test on sandbox-limited CI; the plugin does not add it automatically.

```sh
npm run postinstall
paseo plugin reload paseo-browser
paseo plugin logs paseo-browser
npm pack --dry-run --ignore-scripts
```

Re-run preparation after moving a directory installation. `server/runtime.json` records local paths and is regenerated on installation; Git/npm manifest preparation explicitly runs the same steps because Paseo suppresses package lifecycle scripts.

Workspace streaming, control and profile code is adapted from `@omercnet/paseo-shared-browser` 4.1.0 under MIT. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for the original notice and source. Our runtime paths are independent, so an installed `shared-browser` plugin is not modified.

## Agent chooses CUA instead of Paseo Browser

CUA and its browser access host are a different integration. A CUA host error does not mean this plugin failed. Discover `paseo_browser` / `shared_browser` MCP tools, acquire control, then navigate with this plugin.

The package includes the `paseo-browser` agent skill. Git/npm plugin preparation installs it into `~/.agents/skills/paseo-browser`, with a Codex skills link. For directory installations, run `npm run install:agent-skill`. Existing user-authored skills at that path are preserved. Remove those skill paths if uninstalling the plugin and the guidance is no longer wanted.

Both workspace MCP adapters advertise browser-routing instructions during initialization. Newly created supported agents also receive a short routing section appended to their existing system prompt. That saved section is conditional on the tools being available and does not authorize extra browser actions. Reload an existing idle agent after installing/updating the skill so its tool and skill catalogs refresh.
