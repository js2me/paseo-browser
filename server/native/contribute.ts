import type { PluginServerContext } from "@getpaseo/plugin/server";
import { NativeRelay } from "./relay";
import {
  nativeActionRpc,
  nativeControlRpc,
  nativeExchangeRpc,
  nativePresenceRpc,
  nativeWatchRpc,
} from "../../shared/native/contracts";
export function contributeNative(server: PluginServerContext) {
  const relay = new NativeRelay();
  const ready = relay.listen();
  server.handle(nativeExchangeRpc, (input) => relay.exchange(input));
  server.handle(nativePresenceRpc, () => relay.presence());
  server.handle(nativeWatchRpc, (input) =>
    relay.watch(input.workspaceId, input.viewerId, input.afterSequence),
  );
  server.handle(nativeControlRpc, (input) =>
    relay.control(input.workspaceId, input.viewerId, true, input.action),
  );
  server.handle(nativeActionRpc, async (input) => ({
    result: await relay.command(input.workspaceId, input.viewerId, input.operation, input.input),
  }));
  return {
    relay,
    ready,
    close: async () => {
      await ready;
      await relay.close();
    },
  };
}
