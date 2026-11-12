Paseo Browser lets people and agents use a shared browser in a workspace. On Paseo Desktop it embeds a native Chromium tab, with a DevTools button for the selected tab. Mobile and web clients can view a live broadcast of that same desktop session and take control. Tabs, cookies and page state stay with the desktop browser.

## Setup and compatibility

Requires Paseo 0.15.0 or later and Node.js 24 or later on the daemon. Full native DevTools uses the built-in Paseo Desktop browser API and is detected automatically. This API is prepared in the Paseo source integration and needs to ship in a Desktop release. Users do not patch or copy the application. Older Desktop builds still provide native rendering, snapshots, screenshots, JavaScript and HTML/computed-style inspection; CDP-only tools ask for a Desktop update. The desktop must remain running and connected. Agent requests and mobile viewers start a workspace browser automatically; its panel does not need to be opened on desktop first. Physical iOS and Android devices have not been verified.

Legacy workspace mode uses Chrome on the daemon and streams it to every client. Separate-browser, personal-Chrome and debugging-endpoint modes are also available. Desktop and daemon browsers have independent profiles. Personal-Chrome attachment requires Chrome 144 or later with remote debugging enabled and the connection approved.

## Browser control

A native workspace supports eight tabs. Open its panel with the browser button, Command Center or session sidebar. Agents can browse in the background while you stay in chat. People take and release control to pass the browser to agents; agents cannot take control from a person. Desktop DevTools opens in a separate window after taking control. Native mobile controls support taps, text insertion and Enter against the desktop viewport. The desktop panel can be closed while its browser continues serving mobile viewers.

Agents can navigate, read accessibility snapshots, fill forms, upload files, run JavaScript, inspect console and network activity, manage cookies including HttpOnly cookies, and issue guest-scoped Chrome DevTools Protocol commands. Existing agent sessions may need reloading to discover the tools. Codex, Claude Code, Copilot and OpenCode receive the browser adapter by default; settings and the agent label `paseo-browser/enabled=false` can disable it.

## Data and access

Native websites and localhost addresses run on the desktop. Legacy workspace websites run on the daemon. Browsed sites receive normal browser requests and cookies. Page content, screenshots, console output, network details, cookies and JavaScript results requested by an agent become tool results and may be sent to that agent's configured model provider. Avoid opening sensitive sessions unless that access is intended.

Native tabs share Paseo's persistent browser profile across workspaces, including logins and cookies. Legacy profiles are stored separately in the daemon's plugin data. Remote images and input pass through the authenticated Paseo connection; capture runs only while viewers watch. Browser MCP usage statistics and CrUX reporting are disabled.

Preparation installs locked npm dependencies and builds local tool adapters. It writes runtime assets under the daemon's plugin data directory and managed browser guidance under `~/.agents/skills/paseo-browser`, adding a Codex skill link when absent. User-authored guidance is preserved. Native mode uses Electron's included Chromium and needs no separate browser download. Legacy preparation reuses an installed Chrome when available. Downloading Chrome for Testing through agent-browser is optional and requires an explicit command documented in the README; normal preparation does not download a browser.

Agents can also use `browser_storage` for local and session storage, `browser_dialog` to answer JavaScript dialogs, `browser_emulate` for device metrics, timezone, location and media preferences, and `browser_network` for offline mode, throttling, headers, cache and URL blocking. Workspace mode requires a page CDP target ID; native mode uses the selected tab and requires the built-in Desktop DevTools API for dialog, emulation and network operations. These tools respect the existing control lease.

`browser_inspect` reads element HTML, attributes, computed CSS and geometry by CSS selector, including pseudo-element styles, without the native desktop bridge. `browser_dom` exposes the DevTools document tree, queries, box model and live DOM editing. `browser_css` reads matched/inherited rules, computed and inline styles, stylesheet sources and supports live CSS edits and forced hover/focus states. The latter two require the Desktop DevTools API in native mode. General CDP commands and events remain available for Network, Debugger, Performance, Profiler and Accessibility. Live edits do not change source files.
