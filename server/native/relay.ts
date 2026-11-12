import { randomUUID, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { NativeCommand, NativeFrame, NativeState } from "../../shared/native/contracts";

type Result = { id: string; result?: unknown; error?: string };
type Pending = {
  command: NativeCommand;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  dispatched: boolean;
  owner: string;
  settled: Promise<void>;
};
type Workspace = {
  clientId: string | null;
  seenAt: number;
  state: NativeState | null;
  frame: NativeFrame | null;
  frameReceivedAt:number;
  pending: Map<string, Pending>;
  viewers: Map<string, number>;
  control: { id: string; human: boolean; until: number } | null;
  error: string | null;
  takeover: string | null;
};
const OWNER_TTL = 5_000;
const VIEWER_TTL = 2_500;
const CDP_UNBLOCKERS = new Set([
  "Page.handleJavaScriptDialog", "Debugger.resume", "Debugger.stepInto", "Debugger.stepOut",
  "Debugger.stepOver", "Debugger.disable", "Runtime.terminateExecution", "Runtime.runIfWaitingForDebugger",
  "Fetch.continueRequest", "Fetch.continueResponse", "Fetch.fulfillRequest", "Fetch.failRequest",
  "Fetch.continueWithAuth", "Fetch.disable",
]);
function canUnblock(command: NativeCommand): boolean {
  return command.operation === "cdp_events" || command.operation === "browser_dialog" ||
    (command.operation === "cdp_send" && typeof command.input.method === "string" && CDP_UNBLOCKERS.has(command.input.method));
}
const CONTROL_TTL = 30_000;

/** Workspace-bound command mailbox. Published mutations are never retried. */
export class NativeRelay {
  private workspaces = new Map<string, Workspace>();
  private tickets = new Map<string, { workspaceId: string; agentId: string; cwd?: string }>();
  private server: Server | null = null;
  private url = "";
  private stopped = false;
  constructor(private now = Date.now) {}
  private workspace(id: string) {
    let workspace = this.workspaces.get(id);
    if (!workspace) {
      workspace = {
        clientId: null,
        seenAt: 0,
        state: null,
        frame: null,
        frameReceivedAt:0,
        pending: new Map(),
        viewers: new Map(),
        control: null,
        error: null,
        takeover: null,
      };
      this.workspaces.set(id, workspace);
    }
    if (workspace.control && workspace.control.until <= this.now()) workspace.control = null;
    if (workspace.clientId && workspace.seenAt + OWNER_TTL < this.now()) {
      workspace.clientId = null;
      workspace.state = null;
      workspace.frame = null;
      workspace.control = null;
      workspace.takeover = null;
      workspace.error = "Desktop browser disconnected. Waiting for a connected desktop to host it again.";
      for (const pending of workspace.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(
            "Desktop browser disconnected; a dispatched command may have completed. Do not retry mutations automatically.",
          ),
        );
      }
      workspace.pending.clear();
    }
    return workspace;
  }
  presence() {
    const workspaceIds: string[] = [];
    const requestedWorkspaceIds: string[] = [];
    for (const id of this.workspaces.keys()) {
      const workspace = this.workspace(id);
      if (workspace.clientId) workspaceIds.push(id);
      if (workspace.pending.size || [...workspace.viewers.values()].some(until => until > this.now()))
        requestedWorkspaceIds.push(id);
    }
    return { workspaceIds, requestedWorkspaceIds };
  }
  exchange(input: {
    clientId: string;
    workspaceId: string;
    state: NativeState | null;
    frame: NativeFrame | null;
    results: Result[];
    error?: string | null;
  }) {
    if (this.stopped) throw Error("Native browser relay stopped");
    const workspace = this.workspace(input.workspaceId);
    if (workspace.clientId && workspace.clientId !== input.clientId)
      return {
        accepted: false,
        commands: [],
        streaming: false,
        controller: workspace.control?.id ?? null,
      };
    workspace.clientId = input.clientId;
    workspace.seenAt = this.now();
    if (
      workspace.state?.browserId !== input.state?.browserId ||
      workspace.state?.generation !== input.state?.generation
    )
      workspace.frame = null;
    workspace.state = input.state;
    workspace.error = input.error ?? null;
    if (workspace.control?.id === input.clientId)
      workspace.control.until = this.now() + CONTROL_TTL;
    if (
      input.frame &&
      input.state &&
      input.frame.browserId === input.state.browserId &&
      input.frame.generation === input.state.generation &&
      input.frame.sequence > (workspace.frame?.sequence ?? 0)
    ) {
      workspace.frame = input.frame;
      workspace.frameReceivedAt = this.now();
    }
    for (const result of input.results) {
      const pending = workspace.pending.get(result.id);
      if (!pending?.dispatched) continue;
      clearTimeout(pending.timer);
      workspace.pending.delete(result.id);
      if (result.error) pending.reject(Error(result.error));
      else pending.resolve(result.result);
    }
    const commands: NativeCommand[] = [];
    // Keep input ordered, but permit event reads and replies that unblock paused JavaScript.
    const inFlight = [...workspace.pending.values()].some((p) => p.dispatched);
    if (input.state && !workspace.takeover) {
      for (const next of workspace.pending.values()) {
        if (next.dispatched || (inFlight && !canUnblock(next.command))) continue;
        if (
          !["tabs.list", "open"].includes(next.command.operation) &&
          workspace.control?.id !== next.owner
        ) {
          clearTimeout(next.timer);
          workspace.pending.delete(next.command.id);
          next.reject(Error("Browser control changed before dispatch"));
          continue;
        }
        if (
          next.command.operation === "open" &&
          workspace.control &&
          workspace.control.id !== next.owner
        ) {
          clearTimeout(next.timer);
          workspace.pending.delete(next.command.id);
          next.reject(Error("Browser control changed before dispatch"));
          continue;
        }
        next.dispatched = true;
        commands.push(next.command);
        break;
      }
    }
    for (const [id, until] of workspace.viewers)
      if (until < this.now()) workspace.viewers.delete(id);
    return {
      accepted: true,
      commands,
      streaming: workspace.viewers.size > 0,
      controller: workspace.control?.id ?? null,
    };
  }
  watch(workspaceId: string, viewerId: string, afterSequence: number) {
    const workspace = this.workspace(workspaceId);
    workspace.viewers.set(viewerId, this.now() + VIEWER_TTL);
    if (workspace.control?.id === viewerId) workspace.control.until = this.now() + CONTROL_TTL;
    return {
      state: workspace.state,
      frame:
        workspace.frame &&
        workspace.frame.sequence > afterSequence &&
        workspace.frameReceivedAt + 1500 > this.now()
          ? workspace.frame
          : null,
      connected: Boolean(workspace.clientId),
      controller: workspace.control?.id ?? null,
      error: workspace.error,
    };
  }
  async control(workspaceId: string, id: string, human: boolean, action: "acquire" | "release") {
    const workspace = this.workspace(workspaceId);
    if (action === "release") {
      if (workspace.control?.id === id) workspace.control = null;
    } else {
      if (workspace.takeover && workspace.takeover !== id)
        throw Error("Browser control transfer is pending");
      if (workspace.control && workspace.control.id !== id && (!human || workspace.control.human))
        throw Error("Browser is controlled by another participant");
      const pending = [...workspace.pending.values()].find((p) => p.dispatched && p.owner !== id);
      if (pending) {
        workspace.takeover = id;
        await pending.settled;
      }
      if (workspace.control && workspace.control.id !== id && (!human || workspace.control.human))
        throw Error("Browser is controlled by another participant");
      workspace.control = { id, human, until: this.now() + CONTROL_TTL };
      workspace.takeover = null;
    }
    return { controller: workspace.control?.id ?? null };
  }
  async command(
    workspaceId: string,
    id: string,
    operation: string,
    input: Record<string, unknown> = {},
  ) {
    if (this.stopped) throw Error("Native browser relay stopped");
    const workspace = this.workspace(workspaceId);
    if (operation === "open" && workspace.control && workspace.control.id !== id)
      throw Error("Browser is controlled by another participant");
    if (!["status", "tabs.list", "open"].includes(operation) && workspace.control?.id !== id)
      throw Error(
        "Acquire native browser control first; another participant may control the browser",
      );
    if (workspace.control?.id === id) workspace.control.until = this.now() + CONTROL_TTL;
    if (operation === "status")
      return {
        state: workspace.state,
        connected: Boolean(workspace.clientId),
        controller: workspace.control?.id ?? null,
      };
    if (workspace.pending.size >= 32) throw Error("Native browser queue is full");
    return new Promise<unknown>((resolve, reject) => {
      const completion = Promise.withResolvers<void>();
      const accept = (value: unknown) => {
        completion.resolve();
        resolve(value);
      };
      const refuse = (error: Error) => {
        completion.resolve();
        reject(error);
      };
      const command = { id: randomUUID(), operation, input };
      const timer = setTimeout(() => {
        workspace.pending.delete(command.id);
        refuse(
          Error(
            "Native browser command timed out. Keep Paseo Desktop connected to this host so it can start the workspace browser. Dispatched mutations are not retried.",
          ),
        );
      }, 15_000);
      workspace.pending.set(command.id, {
        command,
        resolve: accept,
        reject: refuse,
        timer,
        dispatched: false,
        owner: id,
        settled: completion.promise,
      });
    });
  }
  async listen() {
    this.server = createServer(async (req, res) => {
      try {
        const ticket = req.headers.authorization?.replace(/^Bearer /, "");
        const binding = ticket ? this.tickets.get(ticket) : null;
        if (!binding) {
          res.writeHead(401).end();
          return;
        }
        if (req.method !== "POST" || req.url !== "/call") {
          res.writeHead(404).end();
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 1_500_000) throw Error("Request too large");
        }
        const parsed = JSON.parse(body);
        if (typeof parsed.operation !== "string") throw Error("Invalid operation");
        const result =
          parsed.operation === "acquire-control"
            ? await this.control(binding.workspaceId, binding.agentId, false, "acquire")
            : parsed.operation === "release-control"
              ? await this.control(binding.workspaceId, binding.agentId, false, "release")
              : await this.command(binding.workspaceId, binding.agentId, parsed.operation, {
                  ...(parsed.input ?? {}),
                  ...(parsed.operation === "automation" ? { cwd: binding.cwd } : {}),
                });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ result }));
      } catch (error) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    if (!address || typeof address === "string") throw Error("Native relay failed");
    this.url = `http://127.0.0.1:${address.port}/call`;
  }
  ticket(workspaceId: string, agentId: string, cwd?: string) {
    for (const [token, binding] of this.tickets)
      if (binding.agentId === agentId) this.tickets.delete(token);
    const token = randomBytes(32).toString("base64url");
    this.tickets.set(token, { workspaceId, agentId, cwd });
    return { url: this.url, token };
  }
  async close() {
    this.stopped = true;
    for (const workspace of this.workspaces.values())
      for (const pending of workspace.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(Error("Native relay stopped"));
      }
    this.workspaces.clear();
    this.tickets.clear();
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
