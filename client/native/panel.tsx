import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeDesktopService } from "./desktop-service";
import { z } from "zod";
import { AppState, ScrollView, Pressable, Text, TextInput, View } from "react-native";
import { type PluginWorkspacePanelProps, useRpc, useTabState } from "@getpaseo/plugin/client";
import {
  nativeActionRpc,
  nativeControlRpc,
  nativeWatchRpc,
  type NativeState,
} from "../../shared/native/contracts";
import { nativeDesktopBrowserApi, nativeTouchPoint } from "../workspace/web";

import { BrowserFrameImage } from "../workspace/browser-frame-image";
import { useBrowserFrameBuffer } from "../workspace/use-browser-frame-buffer";
import type { BrowserFrame } from "../../shared/workspace/browser";
import type { FrameCandidate } from "../workspace/browser-frame-buffer";
import { nativeFrameCandidate } from "./frame-candidate";

const nativeTabState = z.object({ url: z.string().default("about:blank") });
export function NativeBrowserPanel({
  workspaceId,
  theme,
  layout,
  tab,
  service,
}: PluginWorkspacePanelProps & { service?: NativeDesktopService }) {
  const foreground = { color: theme.colors.foreground };
  const [active, setActive] = useState(
    AppState.currentState === "active" || AppState.currentState === null,
  );
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const clientId = useMemo(
    () => service?.clientId ?? `native-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    [service],
  );
  const desktop = Boolean(nativeDesktopBrowserApi());
  const host = useRef<View | null>(null);
  const mirror = useRef<View | null>(null);
  const [state, setState] = useState<NativeState | null>(null);
  const stateRef = useRef<NativeState | null>(null);
  const visibleFrameRef = useRef<BrowserFrame | null>(null);
  const frameScope = `${workspaceId}/${clientId}`;
  const isCurrentFrame = useCallback((candidate: FrameCandidate) =>
    activeRef.current && candidate.viewerToken === frameScope &&
    candidate.frame.sessionId === stateRef.current?.browserId &&
    candidate.frame.navigationGeneration === stateRef.current?.generation,
  [frameScope]);
  const { buffer, frame, receive, settled, reset, discardObsoletePending } = useBrowserFrameBuffer(
    visibleFrameRef, isCurrentFrame,
  );
  const retryFrame = useCallback(() => {}, []);
  const [error, setError] = useState<string | null>(null);
  const [controller, setController] = useState<string | null>(null);
  const [urlDraft, setUrl] = useState<string | null>(null);
  const [remembered, setRemembered] = useTabState(tab, nativeTabState, { url: "about:blank" });
  const url = urlDraft ?? (state?.url.startsWith("http") ? state.url : "https://www.google.com");
  const [text, setText] = useState("");
  useEffect(() => {
    if (state?.url.startsWith("http") && state.url !== remembered.url)
      setRemembered({ url: state.url });
  }, [state?.url]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const watch = useRpc(nativeWatchRpc);
  const control = useRpc(nativeControlRpc);
  const action = useRpc(nativeActionRpc);

  const own = controller === clientId;
  const ownRef = useRef(own);
  ownRef.current = own;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (ownRef.current)
        void control({ workspaceId, viewerId: clientId, action: "release" }).catch(() => {});
    };
  }, [workspaceId, clientId, control]);
  const changeControl = () => {
    void control({ workspaceId, viewerId: clientId, action: own ? "release" : "acquire" })
      .then((result) => {
        if (alive.current && (desktop || activeRef.current)) setController(result.controller);
        else void control({ workspaceId, viewerId: clientId, action: "release" }).catch(() => {});
      })
      .catch((error) => {
        if (alive.current) setError(String(error));
      });
  };
  useEffect(() => {
    if (!desktop) return;
    if (!service) {
      setError("Reload the plugin to reconnect its native browser service.");
      return;
    }
    return service.attach(workspaceId, host.current, remembered.url, (snapshot) => {
      setState(snapshot.state);
      setController(snapshot.controller);
      setError(snapshot.error);
    });
  }, [desktop, workspaceId, clientId, service]);
  useEffect(() => {
    if (desktop) return;
    if (!active) {
      reset();
      if (ownRef.current)
        void control({ workspaceId, viewerId: clientId, action: "release" }).catch(() => {});
      return;
    }
    let stopped = false;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const reply = await watch({ workspaceId, viewerId: clientId, afterSequence: sequence });
        if (stopped) return;
        if (stateRef.current?.browserId !== reply.state?.browserId) reset();
        stateRef.current = reply.state;
        setState(reply.state);
        discardObsoletePending();
        setController(reply.controller);
        if (reply.frame) {
          sequence = reply.frame.sequence;
          receive(nativeFrameCandidate(reply.frame, frameScope));
        }
        setError(
          reply.connected
            ? reply.state && !reply.state.cdp
              ? "Update Paseo desktop to enable mobile sharing and DevTools."
              : reply.error
            : "Waiting for a connected Paseo Desktop to start this workspace browser.",
        );
      } catch (error) {
        if (!stopped) setError(String(error));
      }
      if (!stopped) timer = setTimeout(() => void read(), 66);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [desktop, workspaceId, clientId, watch, active, receive, reset, discardObsoletePending, frameScope]);
  const run = async (
    operation:
      | "navigate"
      | "back"
      | "forward"
      | "reload"
      | "input"
      | "tabs.create"
      | "tabs.select"
      | "tabs.close",
    input: Record<string, unknown> = {},
  ) => {
    try {
      setError(null);
      await action({ workspaceId, viewerId: clientId, operation, input });
      if (operation === "navigate") setUrl(null);
    } catch (error) {
      setError(String(error));
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View style={{ flexDirection: "row", gap: 8, padding: 8, alignItems: "center" }}>
        <Pressable onPress={changeControl}>
          <Text style={foreground}>{own ? "Release" : "Take control"}</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Native browser address"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          onSubmitEditing={() => void run("navigate", { url })}
          style={{
            ...foreground,
            flex: 1,
            minWidth: 0,
            borderColor: theme.colors.border,
            borderWidth: 1,
            padding: 8,
          }}
        />
        <Pressable onPress={() => void run("navigate", { url })}>
          <Text style={foreground}>Go</Text>
        </Pressable>
        {desktop && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Chrome DevTools"
            accessibilityHint="Take control first, then inspect the selected browser tab"
            disabled={!own || !state || !service}
            style={{ opacity: own && state && service ? 1 : 0.5 }}
            onPress={() => {
              try {
                setError(null);
                service!.openDevTools(workspaceId);
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            <Text style={foreground}>DevTools</Text>
          </Pressable>
        )}
      </View>
      {state?.tabs && (
        <ScrollView horizontal style={{ maxHeight: 38 }}>
          {state.tabs.map((tab) => (
            <Pressable
              key={tab.browserId}
              disabled={!own}
              onPress={() => void run("tabs.select", { tabId: tab.browserId })}
              style={{
                padding: 8,
                backgroundColor:
                  tab.browserId === state.browserId ? theme.colors.surface1 : theme.colors.surface0,
              }}
            >
              <Text numberOfLines={1} style={foreground}>
                {tab.title || "New tab"}
              </Text>
            </Pressable>
          ))}
          <Pressable disabled={!own} onPress={() => void run("tabs.create", {})}>
            <Text style={{ ...foreground, padding: 8 }}>+</Text>
          </Pressable>
          <Pressable disabled={!own} onPress={() => void run("tabs.close", {})}>
            <Text style={{ ...foreground, padding: 8 }}>×</Text>
          </Pressable>
        </ScrollView>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, padding: 8 }}>
          {error}
        </Text>
      )}
      {desktop ? (
        <View ref={host} style={{ flex: 1, minHeight: 100 }} />
      ) : (
        <Pressable
          ref={mirror}
          style={{ flex: 1 }}
          onLayout={(event) => setImageSize(event.nativeEvent.layout)}
          onPress={(event) => {
            if (
              !own ||
              !frame ||
              frame.sessionId !== state?.browserId ||
              frame.navigationGeneration !== state?.generation ||
              !imageSize.width ||
              !imageSize.height
            )
              return;
            const point = nativeTouchPoint(event, mirror.current);
            if (!point) return;
            const scale = Math.min(imageSize.width / frame.width, imageSize.height / frame.height);
            const x = (point.x - (imageSize.width - frame.width * scale) / 2) / scale;
            const y = (point.y - (imageSize.height - frame.height * scale) / 2) / scale;
            void run("input", {
              x: (x * (state?.width ?? frame.width)) / frame.width,
              y: (y * (state?.height ?? frame.height)) / frame.height,
              generation: frame.navigationGeneration,
              browserId: frame.sessionId,
            });
          }}
        >
          {buffer.layers.map((layer) => layer ? (
            <BrowserFrameImage
              key={layer.ticket}
              ticket={layer.ticket}
              source={layer.source}
              visible={buffer.front !== null && buffer.layers[buffer.front]?.ticket === layer.ticket}
              label="Live native browser"
              x={0}
              y={0}
              width={imageSize.width}
              height={imageSize.height}
              cornerRadius={0}
              settled={settled}
              retry={retryFrame}
            />
          ) : null)}
          {!frame && (
            <Text style={{ ...foreground, padding: 16 }}>Waiting for the desktop browser…</Text>
          )}
        </Pressable>
      )}
      {!desktop && own && (
        <View style={{ flexDirection: "row", gap: 8, padding: 8 }}>
          <TextInput
            accessibilityLabel="Type in browser"
            placeholder="Type in browser"
            value={text}
            onChangeText={setText}
            style={{
              ...foreground,
              flex: 1,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: 8,
            }}
          />
          <Pressable
            onPress={() => {
              void run("input", {
                kind: "type",
                text,
                generation: state?.generation,
                browserId: state?.browserId,
              });
              setText("");
            }}
          >
            <Text style={foreground}>Send</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              void run("input", {
                kind: "key",
                key: "Enter",
                generation: state?.generation,
                browserId: state?.browserId,
              })
            }
          >
            <Text style={foreground}>Enter</Text>
          </Pressable>
        </View>
      )}
      <Text style={{ color: theme.colors.foregroundMuted, padding: 6, fontSize: 11 }}>
        {desktop
          ? "Native Chromium"
          : `Live desktop broadcast${layout.compact ? "" : " · same browser session"}`}{" "}
        · {state?.title || state?.url || "No page"}
        {desktop && state && !state.cdp ? " · CDP bridge update required" : ""}
      </Text>
    </View>
  );
}
