import { expect, it, vi } from 'vitest';
import type { PluginServerContext } from '@getpaseo/plugin/server';
import { browserSchema } from '../../shared/settings';
import contribute from '../../index.server';
import { issueAgentTicket, bindAgentTicket, revokeAgentBrowserAccess } from './browser';

vi.mock('./browser', async (original) => ({
  ...await original<typeof import('./browser')>(),
  issueAgentTicket: vi.fn(async () => {}),
  bindAgentTicket: vi.fn(async () => {}),
  revokeAgentBrowserAccess: vi.fn(async () => {}),
  cleanupBrowserServer: vi.fn(async () => {}),
}));

it('injects both workspace-bound MCP adapters on resume and refresh, excluding history and opt-out agents', async () => {
  let hook: ((event: { request: any }) => Promise<any>) | undefined;
  const server = {
    registerSettings: () => ({ read: async () => ({ status: 'ready', values: browserSchema.parse({ mode:'workspace' }) }) }),
    handle: () => {},
    addHook: (name: string, handler: typeof hook) => { if (name === 'agent.open.before') hook = handler; return () => {}; },
  } as unknown as PluginServerContext;
  const cleanup = contribute(server);
  const request = { agentId: 'agent', workspaceId: 'workspace', cwd: '/project', provider: 'codex', purpose: 'interactive', reason: 'resume', labels: {}, env: { ORIGINAL: 'kept' }, tools: [], mcpServers: { existing: { type: 'http', url: 'https://example.com' } } };
  try {
    for (const reason of ['resume', 'refresh']) {
      const output = await hook!({ request: { ...request, reason } });
      expect(output.env).toEqual(request.env);
      expect(output.mcpServers.existing).toEqual(request.mcpServers.existing);
      const shared = output.mcpServers['paseo-browser'];
      const devtools = output.mcpServers['paseo-browser-devtools'];
      expect(shared.type).toBe('stdio');
      expect(devtools.type).toBe('stdio');
      expect(devtools.env.PASEO_BROWSER_WORKSPACE_TICKET).toBe(shared.env.PASEO_BROWSER_WORKSPACE_TICKET);
      expect(devtools.env.PASEO_BROWSER_WORKSPACE_ROOT).toBe('/project');
      expect(bindAgentTicket).toHaveBeenLastCalledWith(shared.env.PASEO_BROWSER_WORKSPACE_TICKET, 'agent', 'workspace');
    }
    expect(revokeAgentBrowserAccess).toHaveBeenCalledTimes(2);
    expect(issueAgentTicket).toHaveBeenCalledTimes(2);
    await expect(hook!({ request: { ...request, purpose: 'history' } })).resolves.toBeUndefined();
    await expect(hook!({ request: { ...request, labels: { 'paseo-browser/enabled': 'false' } } })).resolves.toBeUndefined();
    expect(issueAgentTicket).toHaveBeenCalledTimes(2);
  } finally { await cleanup(); }
});

it('offers browser tools without adding a creation hook or changing agent instructions', async () => {
  const addHook = vi.fn((_name: string, _handler: unknown) => () => {});
  const server = {
    registerSettings: () => ({ read: async () => ({ status: 'ready', values: browserSchema.parse({ mode:'workspace' }) }) }),
    handle: () => {}, addHook,
  } as unknown as PluginServerContext;
  const cleanup = contribute(server);
  try {
    const hooks = addHook.mock.calls.map(call => call[0]);
    expect(hooks).not.toContain('agent.create.before');
    expect(hooks).toContain('agent.open.before');
  } finally { await cleanup(); }
});

it('injects the native mailbox adapter in hybrid mode without launching a second Chrome',async()=>{
 let hook:((event:{request:any})=>Promise<any>)|undefined;
 const server={registerSettings:()=>({read:async()=>({status:'ready',values:browserSchema.parse({mode:'hybrid'})})}),handle:()=>{},addHook:(name:string,handler:typeof hook)=>{if(name==='agent.open.before')hook=handler;return()=>{};}} as unknown as PluginServerContext;
 const cleanup=contribute(server);
 try{
  const request={agentId:'native-agent',workspaceId:'workspace',cwd:'/project',provider:'codex',purpose:'interactive',reason:'refresh',labels:{},env:{ORIGINAL:'kept'},mcpServers:{existing:{type:'http',url:'https://example.com'},'paseo-browser-devtools':{type:'stdio',command:'old'}}};
  const result=await hook!({request});
  expect(result.env).toEqual(request.env);expect(result.mcpServers.existing).toEqual(request.mcpServers.existing);
  expect(result.mcpServers['paseo-browser-devtools']).toBeUndefined();
  const browser=result.mcpServers['paseo-browser'];expect(browser.args[0]).toMatch(/native-browser-mcp.cjs$/);expect(browser.env.PASEO_BROWSER_NATIVE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/call$/);expect(browser.env.PASEO_BROWSER_NATIVE_TOKEN).toHaveLength(43);
 }finally{await cleanup();}
});
