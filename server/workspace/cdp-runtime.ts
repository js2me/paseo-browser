import { advancedToolSchemas } from './advanced-tools';

type Event = { method: string; params: unknown; sessionId?: string };
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** One workspace-owned CDP connection, with persistent page sessions and bounded events. */
export class WorkspaceCdp {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private sessions = new Map<string, string>();
  private events: Event[] = [];
  private dropped = 0;
  constructor(private readonly endpoint: () => Promise<string>) {}

  private async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.connecting ??= (async () => {
      const socket = new WebSocket(await this.endpoint());
      this.socket = socket;
      socket.addEventListener('message', ({ data }) => {
        const message = JSON.parse(String(data));
        if (typeof message.id === 'number') {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
          else pending.resolve(message.result ?? {});
        } else if (typeof message.method === 'string') {
          if (message.method === 'Target.detachedFromTarget') {
            for (const [target, session] of this.sessions) if (session === message.params?.sessionId) this.sessions.delete(target);
          }
          if (this.events.length >= 500) { this.events.shift(); this.dropped++; }
          this.events.push(message);
        }
      });
      socket.addEventListener('close', () => {
        if (this.socket !== socket) return;
        this.reset(new Error('CDP disconnected; command outcome may be unknown. Do not retry mutations automatically.'));
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timed out')); }, 10_000);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); });
      });
    })();
    try { await this.connecting; } finally { this.connecting = null; }
  }
  private reset(error: Error) {
    this.socket = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.sessions.clear(); this.events = []; this.dropped = 0;
  }
  private async send(method: string, params: unknown, sessionId?: string): Promise<any> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP command timed out; outcome may be unknown. Do not retry mutations automatically.'));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private async session(targetId?: string) {
    if (!targetId) return undefined;
    await this.connect();
    let id = this.sessions.get(targetId);
    if (!id) {
      const result = await this.send('Target.attachToTarget', { targetId, flatten: true });
      id = result.sessionId as string;
      this.sessions.set(targetId, id);
    }
    return id;
  }
  async call(name: string, args: unknown): Promise<unknown> {
    if (name === 'cdp_send') {
      const input = advancedToolSchemas.cdp_send.parse(args);
      return this.send(input.method, input.params, await this.session(input.targetId));
    }
    if (name === 'cdp_events') {
      const input = advancedToolSchemas.cdp_events.parse(args);
      const sessionId = await this.session(input.targetId);
      const matches = (event: Event) => (!sessionId || event.sessionId === sessionId) && (!input.method || event.method === input.method);
      const events = this.events.filter(matches).map(event => ({ ...event, targetId: [...this.sessions].find(([, id]) => id === event.sessionId)?.[0] }));
      const dropped = this.dropped;
      if (input.clear) { this.events = this.events.filter(event => !matches(event)); this.dropped = 0; }
      return { events, dropped };
    }
    const input = advancedToolSchemas.browser_cookies.parse(args);
    if (input.action === 'get') return this.send('Storage.getCookies', {});
    if (input.action === 'clear') return this.send('Storage.clearCookies', {});
    if (input.action === 'set') {
      if (!input.cookies?.length || input.cookies.some(cookie => !cookie.url && !cookie.domain)) throw new Error('set requires cookies with a url or domain');
      return this.send('Storage.setCookies', { cookies: input.cookies });
    }
    if (input.name === undefined || (!input.url && !input.domain)) throw new Error('delete requires name and url or domain');
    const { action: _, cookies: __, ...params } = input;
    // Network.deleteCookies needs a page session; select a page without changing the UI.
    const { targetInfos } = await this.send('Target.getTargets', {});
    const target = targetInfos.find((target: { type: string }) => target.type === 'page');
    if (!target) throw new Error('Open a page before deleting a cookie');
    return this.send('Network.deleteCookies', params, await this.session(target.targetId));
  }
  close() {
    const socket = this.socket;
    this.reset(new Error('CDP closed'));
    socket?.close();
  }
}
