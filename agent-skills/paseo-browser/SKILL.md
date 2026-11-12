---
name: paseo-browser
description: Operate a live website in the shared Paseo Browser when asked to open or interact with a page, inspect its DevTools, or verify behavior in that browser. Not for code-only work, general research, or configuring Paseo, browser tooling, or this plugin.
---

<!-- Managed by paseo-browser plugin. -->

Apply this skill when the task requires actual interaction with a live page in Paseo Browser. A request to open a site, fill a form, inspect its live console/network, or verify behavior in the shared browser qualifies. Merely editing frontend code, reading a URL, discussing cookies, or configuring a plugin does not. Do not load the skill, query browser status or open a panel just because browser tools are available.

For a qualifying browser task, use `paseo-browser` / `paseo-browser-devtools` MCP tools when available. These control Chrome shown in Paseo's Workspace Browser panel. CUA's browser host is a separate integration; its absence does not indicate a Paseo Browser failure.

Once Paseo Browser is selected for a browser task, discover the exact tool names. In code-mode, filter `ALL_TOOLS` by `paseo_browser` or `shared_browser`, then invoke the matching functions on `tools`. Typical names include `mcp__paseo_browser__shared_browser_status` and `mcp__paseo_browser_devtools__list_pages`.

When `native_browser_open` is available, use native mode (the default):

1. Call `native_browser_open` with the site's HTTP(S) URL. This opens the real desktop WebView; a mobile viewer sees that exact guest. Keep Paseo Desktop connected. Its panel may be parked while the phone is watching.
2. Acquire `shared_browser_acquire_control`, then use `native_browser_automation` with `{ name: "snapshot", args: {} }` to obtain native element refs. Use the same tool for click/fill/type/keyboard, wait, upload, screenshot, hover/drag, logs, scroll and resize.
3. Use `evaluate_script` for JavaScript, `browser_cookies` for cookies, and `cdp_send`/`cdp_events` for the registered guest's protocol. Mobile viewing works with standard desktop screenshots. Full CDP and cookie management use the built-in Desktop DevTools API. If unavailable, report that Paseo Desktop needs an update containing this API. Do not instruct users to patch or copy the application. Keep the desktop native.
4. Use `shared_browser_tabs`, `shared_browser_tab_open`, `shared_browser_tab_select` and `shared_browser_tab_close` for native tabs. Native profile cookies are shared with Paseo's other native tabs.
5. Release control after the action. Never force control from a person. Dispatched mutations are not automatically retried.

The desktop runs the website. On a remote daemon, localhost refers to the connected desktop for native browsing. File uploads require files available on that desktop. If no desktop is connected, report it; do not silently start a separate daemon browser and claim it is the native session.

The following instructions apply to the legacy `workspace` adapter, which lacks `native_browser_open`:

For a request such as “open google.com in the browser”:

1. Call `shared_browser_status` and acquire control with `shared_browser_acquire_control`.
2. Call `shared_browser_navigate` with `action: { kind: "goto", url: "https://google.com" }`.
3. Verify the returned URL/title or capture the page. Release control with `shared_browser_release_control` after the action, including when navigation fails.

Agents cannot take control from a human. Report a held human lease instead of attempting a forced takeover. DevTools also refuses operations while another viewer controls any tab.

Use DevTools for accessibility snapshots, forms, JavaScript, screenshots, network and console.

For HTML/CSS inspection and DevTools:

- Start with `browser_inspect` using `{ selector: ".button", properties: ["display", "color", "padding", "font-size"] }`. It returns HTML, attributes, computed styles, text and geometry. `maxHtmlLength` bounds HTML with a truncation flag; `index` selects among matches. This works on native desktop without the CDP bridge. For pseudo-elements use `pseudo: "::before"` (or `::after` / `::marker`). It inspects the top document; use page JavaScript for open shadow roots or CDP for deeper access.
- `browser_dom`: get `{ action: { kind: "document", depth: 2, pierce: true } }`, then `{ action: { kind: "query", nodeId: <root.nodeId>, selector: ".button" } }`. Use the resulting `nodeId` for HTML, attributes, box model, focus, scroll, or live edits. DOM node IDs expire on navigation; query again after replacements. Shadow roots/frame documents require inspecting their document tree; selectors do not cross those boundaries automatically.
- `browser_css`: with that node ID request `{ action: { kind: "matched", nodeId } }` for authored rules, inherited styles, pseudo-elements and source ranges, or `computed` / `inline`. Read a stylesheet with `stylesheet` + `styleSheetId`. Change declarations with `set_style` + `edits` (CDP ranges, zero-based), replace a sheet with `set_stylesheet`, or simulate hover/focus with `force_pseudo` + `forcedPseudoClasses`. Clear forced states with an empty array. Call `enable` and drain `CSS.styleSheetAdded` from `cdp_events` to discover sheets.
- Workspace mode requires page `targetId` on these tools. Native mode uses the selected tab. `browser_dom` and `browser_css` require the built-in Desktop DevTools API. If that API is missing, `browser_inspect` and `evaluate_script` still inspect HTML/computed CSS and can make page JavaScript edits; report that matched authored styles, debugger and other CDP-only capabilities require a Desktop update containing this API.
- `cdp_send` remains the general DevTools interface for DOM, CSS, Accessibility, DOMSnapshot, Runtime, Debugger, Profiler, Performance, Network and other guest domains. Enable the required domain, send commands and drain `cdp_events`. For example `Debugger.enable`, `Debugger.setBreakpointByUrl`, `Debugger.resume`; `Network.getResponseBody` after capturing requests; or `Accessibility.getFullAXTree`. Finish intercepted requests and resume paused JavaScript before releasing control. Native browser-level operations remain scoped to the guest/profile, and tab lifecycle uses the tab tools.
- Changes to the DOM or CSS affect the running page, not repository source files. To make a fix permanent, update its source and verify the page afterward.

For full site control:

- `browser_storage`: read or edit local/session storage in the current page origin. Example: `{ area: "local", action: { kind: "get" } }`; set uses `{ kind: "set", key, value }`. Treat stored tokens as secrets.
- `browser_dialog`: accept/dismiss JavaScript dialogs using `{ accept: true, promptText: "optional reply" }`. Enable `Page.enable` and read `Page.javascriptDialogOpening` via `cdp_events` when needed.
- `browser_emulate`: set viewport/mobile/deviceScaleFactor, timezone, geolocation, or colorScheme/reducedMotion using a discriminated `action.kind`. `{ action: { kind: "reset" } }` clears these overrides. Grant geolocation permission separately when required.
- `browser_network`: set `conditions` (offline, latency in ms, downloadThroughput/uploadThroughput in bytes/sec, -1 unlimited), `headers`, `cache` (disabled), or `block` (URL patterns; [] unblocks) through `action.kind`. Restore changed settings after testing.
- In workspace mode, pass a page `targetId` from `Target.getTargets` to these four tools. In native mode they operate on the selected tab; dialog, network and emulation require the built-in Desktop DevTools API. Changes remain in effect until reset or the target closes. Multi-command operations can partially complete; inspect state after errors before retrying.
- `browser_cookies`: `get` exports cookies; `set` imports an array of CDP CookieParam objects; `delete` removes a named cookie by URL/domain; `clear` clears this workspace profile's cookies. Supports HttpOnly, Secure, SameSite, expiry (Unix seconds) and partition keys. Set URL or domain for each imported cookie. Never print cookie secrets unnecessarily.
- `cdp_send`: send any Chrome DevTools Protocol method and params. With no targetId, call browser-level methods such as `Target.getTargets`, `Storage.getCookies` or `Browser.grantPermissions`. For page-level Runtime/DOM/Network/Fetch/Debugger/Emulation methods, pass the page's CDP targetId from `Target.getTargets`. Target sessions persist across calls. CDP targetIds, shared tab IDs and DevTools pageIds are distinct.
- `cdp_events`: drain protocol events after enabling a domain (for example `Network.enable`, `Fetch.enable`, `Debugger.enable`). Filter by targetId/method; matching events are cleared by default. The buffer holds 500 events; check the dropped counter. Complete intercepted requests and resume paused debugger execution before releasing control.
- `evaluate_script`: run page JavaScript, read/write localStorage and sessionStorage, inspect IndexedDB, or call site APIs in the page session. Use CDP Storage/IndexedDB/CacheStorage for lower-level inspection.

All these tools control the same workspace profile and are fenced by the existing exclusive control lease. Chrome validates cookie/security/protocol rules; this does not bypass server-side access checks. Get explicit `pageId` values from `list_pages`; shared tab IDs come from `shared_browser_tabs`. Check current snapshots before using element UIDs.

During an actual browser task, if CUA fails with “browser access host is unavailable”, check these plugin tools before telling the user browser access is unavailable. Do not fall back to shell automation or a separate browser when the plugin tools work. If these tools are genuinely absent, say so and suggest reloading the agent after enabling the plugin.

The user's specific browser choice and normal permissions still apply. The plugin does not authorize unrelated form submissions, purchases, messages or account changes.
