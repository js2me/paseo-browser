import { defineSettings } from '@getpaseo/plugin';
import { z } from 'zod';

export const browserSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['workspace', 'isolated', 'autoConnect', 'endpoint']).default('workspace'),
  headless: z.boolean().default(false),
  executablePath: z.string().default(''),
  browserUrl: z.string().default('http://127.0.0.1:9222'),
  providers: z.array(z.string().min(1)).default(['codex', 'claude', 'copilot', 'opencode']),
  chromeArgs: z.array(z.string()).default([]),
}).superRefine((value, ctx) => {
  if (value.mode !== 'endpoint') return;
  try {
    const url = new URL(value.browserUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    ctx.addIssue({ code: 'custom', path: ['browserUrl'], message: 'Enter an HTTP(S) Chrome debugging URL without credentials.' });
  }
});
export type BrowserSettings = z.infer<typeof browserSchema>;
export const browserSettings = defineSettings({ id: 'chrome', scope: 'host', version: 1, schema: browserSchema });
