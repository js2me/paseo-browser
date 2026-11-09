import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { advancedTools } from "../workspace/advanced-tools";
const schemas = {
  shared_browser_status: z.object({}),
  shared_browser_acquire_control: z.object({}),
  shared_browser_release_control: z.object({}),
  shared_browser_tabs: z.object({}),
  shared_browser_tab_open: z.object({ url: z.string().url().optional() }),
  shared_browser_tab_select: z.object({ tabId: z.string() }),
  shared_browser_tab_close: z.object({}),
  native_browser_open: z.object({ url: z.string().url() }),
  shared_browser_navigate: z.object({
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("goto"), url: z.string() }),
      z.object({ kind: z.literal("back") }),
      z.object({ kind: z.literal("forward") }),
      z.object({ kind: z.literal("reload") }),
    ]),
  }),
  evaluate_script: z.object({ function: z.string() }),
  native_browser_automation: z.object({
    name: z.enum([
      "snapshot",
      "click",
      "fill",
      "wait",
      "type",
      "keypress",
      "screenshot",
      "upload",
      "select",
      "hover",
      "drag",
      "logs",
      "scroll",
      "resize",
    ]),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
};
const tools = [
  ...advancedTools,
  ...Object.entries(schemas).map(([name, schema]) => ({
    name,
    description:
      name === "native_browser_open"
        ? "Open a site in the native desktop WebView shared with the mobile broadcast. Keep that workspace browser panel open on the desktop."
        : name === "native_browser_automation"
          ? "Execute a Paseo native browser command in the same desktop guest. Use snapshot for element refs; pass command arguments in args."
          : `Native shared browser: ${name}. Acquire control before actions and release after.`,
    inputSchema: z.toJSONSchema(schema, { target: "draft-7", io: "input" }),
  })),
];
const url = process.env.PASEO_BROWSER_NATIVE_URL;
const token = process.env.PASEO_BROWSER_NATIVE_TOKEN;
if (!url || !token) throw Error("Native browser credentials are required");
const server = new Server(
  { name: "paseo-browser-native", version: "0.4.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "Use this native shared browser. On desktop it is a real Chromium WebView, on mobile the same guest is broadcast. Open with native_browser_open, acquire shared_browser_acquire_control before actions, then release control. Use native_browser_automation for snapshots and page input, evaluate_script for JavaScript, and cdp_send/browser_cookies for full CDP when the desktop bridge is installed. Do not open an independent headless Chrome as a fallback.",
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    if (!tools.some((tool) => tool.name === params.name)) throw Error("Unknown native tool");
    const input = params.arguments ?? {};
    let operation = params.name;
    let value: unknown = input;
    const schema = schemas[params.name as keyof typeof schemas];
    if (schema) schema.parse(input);
    if (params.name === "shared_browser_status") operation = "status";
    if (params.name === "shared_browser_acquire_control") operation = "acquire-control";
    if (params.name === "shared_browser_release_control") operation = "release-control";
    if (params.name === "shared_browser_tabs") operation = "tabs.list";
    if (params.name === "shared_browser_tab_open") operation = "tabs.create";
    if (params.name === "shared_browser_tab_select") operation = "tabs.select";
    if (params.name === "shared_browser_tab_close") operation = "tabs.close";
    if (params.name === "native_browser_open") operation = "open";
    if (params.name === "native_browser_automation") operation = "automation";
    if (params.name === "evaluate_script") {
      operation = "evaluate";
      value = { expression: `(${input.function})()` };
    }
    if (params.name === "shared_browser_navigate") {
      const action = input.action as { kind: string; url?: string };
      operation = action.kind === "goto" ? "navigate" : action.kind;
      value = { url: action.url };
    }
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 20_000);
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, input: value }),
      signal: abort.signal,
    }).finally(() => clearTimeout(timeout));
    const result = (await response.json()) as { result?: unknown; error?: string };
    if (!response.ok) throw Error(result.error ?? "Native browser failed");
    const output = result.result as
      | { command?: string; dataBase64?: string; mimeType?: string }
      | undefined;
    if (output?.command === "screenshot" && output.dataBase64 && output.mimeType)
      return {
        content: [{ type: "image" as const, data: output.dataBase64, mimeType: output.mimeType }],
      };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.result) ?? "null" }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        { type: "text" as const, text: error instanceof Error ? error.message : String(error) },
      ],
    };
  }
});
void server.connect(new StdioServerTransport());
