import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
const workspaceId = z.string().min(1).max(256);
export const nativeStateSchema = z.object({
  browserId: z.string(),
  url: z.string(),
  title: z.string(),
  width: z.number(),
  height: z.number(),
  generation: z.number(),
  tabs: z.array(z.object({ browserId: z.string(), url: z.string(), title: z.string() })).optional(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  cdp: z.boolean(),
});
export type NativeState = z.infer<typeof nativeStateSchema>;
export const nativeFrameSchema = z.object({
  sequence: z.number().int(),
  capturedAt: z.number(),
  data: z
    .string()
    .max(1_100_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
  width: z.number(),
  height: z.number(),
  generation: z.number(),
  browserId: z.string(),
});
export type NativeFrame = z.infer<typeof nativeFrameSchema>;
const commandSchema = z.object({
  id: z.string(),
  operation: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type NativeCommand = z.infer<typeof commandSchema>;
export const nativeExchangeRpc = defineRpc({
  name: "native.exchange",
  input: z.object({
    error: z.string().max(2048).nullable().optional(),
    clientId: z.string().min(16),
    workspaceId,
    state: nativeStateSchema.nullable(),
    frame: nativeFrameSchema.nullable(),
    results: z
      .array(
        z.object({ id: z.string(), result: z.unknown().optional(), error: z.string().optional() }),
      )
      .max(64),
  }),
  output: z.object({
    accepted: z.boolean(),
    commands: z.array(commandSchema),
    streaming: z.boolean(),
    controller: z.string().nullable(),
  }),
});
export const nativePresenceRpc = defineRpc({
  name: "native.presence",
  input: z.object({}),
  output: z.object({
    workspaceIds: z.array(z.string()),
    requestedWorkspaceIds: z.array(z.string()),
  }),
});
export const nativeWatchRpc = defineRpc({
  name: "native.watch",
  input: z.object({
    workspaceId,
    viewerId: z.string().min(16),
    afterSequence: z.number().default(0),
  }),
  output: z.object({
    state: nativeStateSchema.nullable(),
    frame: nativeFrameSchema.nullable(),
    connected: z.boolean(),
    controller: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
export const nativeControlRpc = defineRpc({
  name: "native.control",
  input: z.object({
    workspaceId,
    viewerId: z.string().min(16),
    action: z.enum(["acquire", "release"]),
  }),
  output: z.object({ controller: z.string().nullable() }),
});
export const nativeActionRpc = defineRpc({
  name: "native.action",
  input: z.object({
    workspaceId,
    viewerId: z.string().min(16),
    operation: z.enum([
      "navigate",
      "back",
      "forward",
      "reload",
      "input",
      "tabs.create",
      "tabs.select",
      "tabs.close",
    ]),
    input: z.record(z.string(), z.unknown()),
  }),
  output: z.object({ result: z.unknown() }),
});
