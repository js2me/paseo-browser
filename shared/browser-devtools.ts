import { z } from "zod";

const target = { targetId: z.string().min(1).optional() };
const node = { nodeId: z.number().int().positive() };
export const browserDevtoolsSchemas = {
  browser_inspect: z.object({
    ...target,
    selector: z.string().min(1).default("html"),
    index: z.number().int().nonnegative().default(0),
    pseudo: z.enum(["::before", "::after", "::marker"]).optional(),
    properties: z.array(z.string()).max(500).optional(),
    maxHtmlLength: z.number().int().min(0).max(100000).default(20000),
  }),
  browser_dom: z.object({ ...target, action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("document"), depth: z.number().int().min(-1).max(100).default(2), pierce: z.boolean().default(true) }),
    z.object({ kind: z.literal("query"), ...node, selector: z.string().min(1), all: z.boolean().default(false) }),
    z.object({ kind: z.literal("describe"), ...node, depth: z.number().int().min(-1).max(100).default(1), pierce: z.boolean().default(true) }),
    z.object({ kind: z.literal("html"), ...node }),
    z.object({ kind: z.literal("set_html"), ...node, outerHTML: z.string().max(1000000) }),
    z.object({ kind: z.literal("attributes"), ...node }),
    z.object({ kind: z.literal("set_attribute"), ...node, name: z.string().min(1), value: z.string() }),
    z.object({ kind: z.literal("remove_attribute"), ...node, name: z.string().min(1) }),
    z.object({ kind: z.literal("box"), ...node }),
    z.object({ kind: z.literal("focus"), ...node }),
    z.object({ kind: z.literal("scroll"), ...node }),
    z.object({ kind: z.literal("remove"), ...node }),
  ]) }),
  browser_css: z.object({ ...target, action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("enable") }),
    z.object({ kind: z.literal("computed"), ...node }),
    z.object({ kind: z.literal("matched"), ...node }),
    z.object({ kind: z.literal("inline"), ...node }),
    z.object({ kind: z.literal("stylesheet"), styleSheetId: z.string().min(1) }),
    z.object({ kind: z.literal("set_stylesheet"), styleSheetId: z.string().min(1), text: z.string().max(1000000) }),
    z.object({ kind: z.literal("force_pseudo"), ...node, forcedPseudoClasses: z.array(z.string()).max(50) }),
    z.object({ kind: z.literal("set_style"), edits: z.array(z.object({
      styleSheetId: z.string().min(1), text: z.string(),
      range: z.object({ startLine: z.number().int().nonnegative(), startColumn: z.number().int().nonnegative(), endLine: z.number().int().nonnegative(), endColumn: z.number().int().nonnegative() }),
    })).min(1).max(100) }),
  ]) }),
};
export const browserDevtoolsDescriptions = {
  browser_inspect: "Inspect an element by CSS selector: outer HTML (bounded with truncation flag), attributes, text preview, bounding rectangle and computed CSS; optionally filter properties or inspect ::before/::after/::marker. index selects among matches. Works without the native desktop bridge using page JavaScript. Selectors address the top document; use evaluate_script for open shadow roots/frames or browser_dom/CDP for deeper inspection. Requires control; workspace requires page targetId. Read current DOM before editing.",
  browser_dom: "DevTools Elements DOM access: document (including shadow roots/frame documents with pierce), query, describe, HTML, attributes, box model, focus, scroll, edit HTML/attributes or remove a node. Use nodeId from document/query; IDs expire on navigation. Requires control and page targetId in workspace mode; native uses selected tab and requires desktop CDP bridge. set_html/remove change the live page, not source files.",
  browser_css: "DevTools Styles access: computed properties, matched rules including inherited/pseudo-element styles and source ranges, inline styles, stylesheet source/editing and forced :hover/:focus states. enable starts DOM/CSS domains and buffers CSS.styleSheetAdded events; read cdp_events to discover styleSheetId. Use nodeId from browser_dom and ranges from matched/inline. set_style applies CSS.setStyleTexts edits. Empty forcedPseudoClasses clears overrides. Changes affect live page only. Requires control; workspace requires targetId, native requires desktop CDP bridge.",
};

type Send = (method: string, params: Record<string, unknown>) => Promise<any>;
export async function runBrowserDevtools(name: keyof typeof browserDevtoolsSchemas, args: unknown, send: Send): Promise<unknown> {
  if (name === "browser_inspect") {
    const input = browserDevtoolsSchemas.browser_inspect.parse(args);
    const expression = `(() => {
      const input = ${JSON.stringify(input)};
      const matches = document.querySelectorAll(input.selector);
      const element = matches[input.index];
      if (!element) throw new Error('No element matches selector at index ' + input.index);
      const style = getComputedStyle(element, input.pseudo || null);
      const properties = input.properties || Array.from(style);
      const rect = element.getBoundingClientRect();
      const html = element.outerHTML;
      return { matchCount: matches.length, tagName: element.tagName, attributes: Object.fromEntries(Array.from(element.attributes, a => [a.name, a.value])), html: html.slice(0, input.maxHtmlLength), htmlTruncated: html.length > input.maxHtmlLength, text: (element.textContent || '').slice(0, 20000), textTruncated: (element.textContent || '').length > 20000, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }, computedStyle: Object.fromEntries(properties.map(name => [name, style.getPropertyValue(name)])) };
    })()`;
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Element inspection failed");
    return result.result?.value ?? null;
  }
  if (name === "browser_dom") {
    const { action } = browserDevtoolsSchemas.browser_dom.parse(args);
    await send("DOM.enable", {});
    const { kind, ...params } = action;
    const methods = { document: "DOM.getDocument", describe: "DOM.describeNode", html: "DOM.getOuterHTML", set_html: "DOM.setOuterHTML", attributes: "DOM.getAttributes", set_attribute: "DOM.setAttributeValue", remove_attribute: "DOM.removeAttribute", box: "DOM.getBoxModel", focus: "DOM.focus", scroll: "DOM.scrollIntoViewIfNeeded", remove: "DOM.removeNode" };
    if (action.kind === "query") return send(action.all ? "DOM.querySelectorAll" : "DOM.querySelector", { nodeId: action.nodeId, selector: action.selector });
    return send(methods[kind as keyof typeof methods], params);
  }
  const { action } = browserDevtoolsSchemas.browser_css.parse(args);
  await send("DOM.enable", {});
  await send("CSS.enable", {});
  const { kind, ...params } = action;
  if (kind === "enable") return { enabled: true };
  const methods = { computed: "CSS.getComputedStyleForNode", matched: "CSS.getMatchedStylesForNode", inline: "CSS.getInlineStylesForNode", stylesheet: "CSS.getStyleSheetText", set_stylesheet: "CSS.setStyleSheetText", force_pseudo: "CSS.forcePseudoState", set_style: "CSS.setStyleTexts" };
  return send(methods[kind], params);
}
