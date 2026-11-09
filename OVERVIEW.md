Paseo Browser lets people and agents use a shared browser in a workspace. On Paseo Desktop it embeds a native Chromium tab, with a DevTools button for the selected tab. Mobile and web clients can view a live broadcast of that same desktop session and take control. Tabs, cookies and page state stay with the desktop browser.

## Setup and compatibility

Requires Paseo 0.15.0 or later and Node.js 24 or later on the daemon. Native rendering uses Paseo Desktop's existing WebView support. Mobile broadcasting and full native CDP require the included desktop bridge, which is an additional setup step rather than part of standard Paseo. A helper prepares a separate Linux desktop copy; source patches are supplied for other platforms. See the repository README for the supported bridge baseline and setup. The desktop must remain running and connected. Native mode has been tested on Linux with a compact web client; physical iOS and Android devices have not been verified.

Legacy workspace mode uses Chrome on the daemon and streams it to every client. Separate-browser, personal-Chrome and debugging-endpoint modes are also available. Desktop and daemon browsers have independent profiles. Personal-Chrome attachment requires Chrome 144 or later with remote debugging enabled and the connection approved.

## Browser control

A native workspace supports eight tabs. People take and release control to pass the browser to agents; agents cannot take control from a person. Desktop DevTools opens in a separate window after taking control. Native mobile controls support taps, text insertion and Enter against the desktop viewport. The desktop panel can be closed while its browser continues serving mobile viewers.

Agents can navigate, read accessibility snapshots, fill forms, upload files, run JavaScript, inspect console and network activity, manage cookies including HttpOnly cookies, and issue guest-scoped Chrome DevTools Protocol commands. Existing agent sessions may need reloading to discover the tools. Codex, Claude Code, Copilot and OpenCode receive the browser adapter by default; settings and the agent label `paseo-browser/enabled=false` can disable it.

## Data and access

Native websites and localhost addresses run on the desktop. Legacy workspace websites run on the daemon. Browsed sites receive normal browser requests and cookies. Page content, screenshots, console output, network details, cookies and JavaScript results requested by an agent become tool results and may be sent to that agent's configured model provider. Avoid opening sensitive sessions unless that access is intended.

Native tabs share Paseo's persistent browser profile across workspaces, including logins and cookies. Legacy profiles are stored separately in the daemon's plugin data. Remote images and input pass through the authenticated Paseo connection; capture runs only while viewers watch. Browser MCP usage statistics and CrUX reporting are disabled.

Preparation installs locked npm dependencies and builds local tool adapters. It writes runtime assets under the daemon's plugin data directory and managed browser guidance under `~/.agents/skills/paseo-browser`, adding a Codex skill link when absent. User-authored guidance is preserved. Native mode uses Electron's included Chromium and needs no separate browser download. Legacy preparation reuses an installed Chrome when available. Downloading Chrome for Testing through agent-browser is optional and requires an explicit command documented in the README; normal preparation does not download a browser. Desktop patching is also a separate explicit command and preserves the original installation.
