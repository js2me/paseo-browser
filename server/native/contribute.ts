import type { PluginServerContext } from "@getpaseo/plugin/server";
import { NativeRelay } from "./relay";
import { createLocalDesktopLauncher } from "./desktop-launcher";
import {
  nativeActionRpc,
  nativeControlRpc,
  nativeExchangeRpc,
  nativePresenceRpc,
  nativeReleaseRpc,
  nativeWatchRpc,
} from "../../shared/native/contracts";
export function contributeNative(server: PluginServerContext) {
  const relay = new NativeRelay(Date.now, createLocalDesktopLauncher());
  const ready = relay.listen();
  server.handle(nativeExchangeRpc, (input) => relay.exchange(input));
  server.handle(nativePresenceRpc, () => relay.presence());
  server.handle(nativeReleaseRpc, (input) => relay.release(input.workspaceId, input.clientId));
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
