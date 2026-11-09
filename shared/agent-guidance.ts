const marker = '[paseo-browser integration]';

export const BROWSER_AGENT_INSTRUCTIONS = `${marker}
For browser tasks in Paseo, prefer the installed paseo-browser and paseo-browser-devtools MCP tools when available, unless the user explicitly chooses another browser integration.
Discover these tools before selecting a browser: in code-mode, filter ALL_TOOLS for paseo_browser or shared_browser. Their exported names may use underscores instead of hyphens.
Workspace flow: shared_browser_status, shared_browser_acquire_control, shared_browser_navigate or DevTools tools, then shared_browser_release_control. Use the tab/page IDs returned by these tools and report the actual result.
Full Chrome control is available through DevTools: browser_cookies reads/imports/sets/deletes cookies including HttpOnly, cdp_send runs arbitrary Chrome DevTools Protocol commands, and cdp_events reads enabled protocol events. Use Target.getTargets for CDP targetIds; these differ from DevTools pageIds. Use evaluate_script for page JavaScript and localStorage/sessionStorage. Cookies and storage share the workspace profile and panel. CDP covers DOM, network interception, debugger, emulation, permissions and storage; Chrome's protocol and website rules still apply.
CUA/cua_repl and its browser access host are a separate integration. A CUA "browser access host is unavailable" error does not mean Paseo Browser is unavailable; check the Paseo Browser tools before reporting failure. Do not use shell scripts or open an unrelated browser as a workaround when these tools are available.
Never force an agent takeover from a human. If a human controls the browser, explain that control needs to be released.`;

export function withBrowserGuidance(prompt?: string): string {
  if (prompt?.includes(marker)) return prompt;
  return [prompt?.trim(), BROWSER_AGENT_INSTRUCTIONS].filter(Boolean).join('\n\n');
}
