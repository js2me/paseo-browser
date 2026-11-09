import { z } from 'zod';

export const cdpCommandSchema = z.object({
  method: z.string().regex(/^[A-Za-z]+\.[A-Za-z][A-Za-z0-9]*$/),
  params: z.record(z.string(), z.unknown()).default({}),
  targetId: z.string().min(1).optional(),
});
export const cdpEventsSchema = z.object({
  targetId: z.string().min(1).optional(),
  method: z.string().optional(),
  clear: z.boolean().default(true),
});
export const cookiesSchema = z.object({
  action: z.enum(['get', 'set', 'delete', 'clear']),
  cookies: z.array(z.object({
    name: z.string(), value: z.string(), url: z.string().optional(), domain: z.string().optional(),
    path: z.string().optional(), secure: z.boolean().optional(), httpOnly: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(), expires: z.number().optional(),
  }).passthrough()).min(1).max(1000).optional(),
  name: z.string().optional(), url: z.string().optional(), domain: z.string().optional(),
  path: z.string().optional(), partitionKey: z.record(z.string(), z.unknown()).optional(),
});

export const advancedToolSchemas = {
  cdp_send: cdpCommandSchema,
  cdp_events: cdpEventsSchema,
  browser_cookies: cookiesSchema,
};
const descriptions = {
  cdp_send: 'Send any Chrome DevTools Protocol command to this shared workspace Chrome. Omit targetId for browser commands (Target.getTargets, Storage, Browser); use a page targetId from Target.getTargets for Runtime, DOM, Network, Fetch, Debugger, Emulation, etc. Target sessions persist across calls. Enable domain events before reading cdp_events. Requires exclusive workspace control.',
  cdp_events: 'Read buffered CDP events from this workspace connection, including Fetch.requestPaused, Network, console and debugger events. Enable domains with cdp_send first. Use targetId and method to filter. Returns up to 500 events, dropped count, and clears matching events by default. The buffer is bounded; drain promptly. Requires exclusive workspace control.',
  browser_cookies: 'Read/export, set/import, delete or clear cookies in the shared workspace Chrome profile, including HttpOnly, Secure, SameSite, expiry and partitioned cookies. get returns CDP cookies; set takes CookieParam objects (name/value plus URL or domain and optional attributes). expires is Unix seconds; omit for session cookies. Extra CDP attributes are passed through. Chrome validates cookie rules. delete requires name and url or domain. clear clears all workspace cookies. Requires exclusive workspace control.',
};
export const advancedTools = Object.entries(advancedToolSchemas).map(([name, schema]) => ({
  name,
  description: descriptions[name as keyof typeof descriptions],
  inputSchema: z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }),
}));
