---
name: paseo-browser
description: Use the installed Paseo Browser plugin to open websites, browse pages, test web apps, fill forms or inspect network and console in Chrome shared with the user. Applies to browser tasks inside Paseo and to recovery from an unavailable CUA browser host. Respect an explicitly selected different browser integration.
---

<!-- Managed by paseo-browser plugin. -->

Use `paseo-browser` / `paseo-browser-devtools` MCP tools when they are available. These control Chrome shown in Paseo's Workspace Browser panel. CUA's browser host is a separate integration; its absence does not indicate a Paseo Browser failure.

Discover the exact tool names before choosing a browser backend. In code-mode, filter `ALL_TOOLS` by `paseo_browser` or `shared_browser`, then invoke the matching functions on `tools`. Typical names include `mcp__paseo_browser__shared_browser_status` and `mcp__paseo_browser_devtools__list_pages`.

For a request such as “open google.com in the browser”:

1. Call `shared_browser_status` and acquire control with `shared_browser_acquire_control`.
2. Call `shared_browser_navigate` with `action: { kind: "goto", url: "https://google.com" }`.
3. Verify the returned URL/title or capture the page. Release control with `shared_browser_release_control` after the action, including when navigation fails.

Agents cannot take control from a human. Report a held human lease instead of attempting a forced takeover. DevTools also refuses operations while another viewer controls any tab.

Use DevTools for accessibility snapshots, forms, JavaScript, screenshots, network and console.

For full site control:

- `browser_cookies`: `get` exports cookies; `set` imports an array of CDP CookieParam objects; `delete` removes a named cookie by URL/domain; `clear` clears this workspace profile's cookies. Supports HttpOnly, Secure, SameSite, expiry (Unix seconds) and partition keys. Set URL or domain for each imported cookie. Never print cookie secrets unnecessarily.
- `cdp_send`: send any Chrome DevTools Protocol method and params. With no targetId, call browser-level methods such as `Target.getTargets`, `Storage.getCookies` or `Browser.grantPermissions`. For page-level Runtime/DOM/Network/Fetch/Debugger/Emulation methods, pass the page's CDP targetId from `Target.getTargets`. Target sessions persist across calls. CDP targetIds, shared tab IDs and DevTools pageIds are distinct.
- `cdp_events`: drain protocol events after enabling a domain (for example `Network.enable`, `Fetch.enable`, `Debugger.enable`). Filter by targetId/method; matching events are cleared by default. The buffer holds 500 events; check the dropped counter. Complete intercepted requests and resume paused debugger execution before releasing control.
- `evaluate_script`: run page JavaScript, read/write localStorage and sessionStorage, inspect IndexedDB, or call site APIs in the page session. Use CDP Storage/IndexedDB/CacheStorage for lower-level inspection.

All these tools control the same workspace profile and are fenced by the existing exclusive control lease. Chrome validates cookie/security/protocol rules; this does not bypass server-side access checks. Get explicit `pageId` values from `list_pages`; shared tab IDs come from `shared_browser_tabs`. Check current snapshots before using element UIDs.

If CUA fails with “browser access host is unavailable”, check these plugin tools before telling the user browser access is unavailable. Do not fall back to shell automation or a separate browser when the plugin tools work. If these tools are genuinely absent, say so and suggest reloading the agent after enabling the plugin.

The user's specific browser choice and normal permissions still apply. The plugin does not authorize unrelated form submissions, purchases, messages or account changes.
