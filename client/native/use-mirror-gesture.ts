import { useRef, useState } from "react";
import type { GestureResponderEvent, View } from "react-native";
import type { FrameRect, FrameSize, MappedPoint } from "../../shared/workspace/browser";
import { nativeTouchPoint } from "../workspace/web";
import { constrainMirrorZoom, FIT_MIRROR, pinchMirror, type MirrorZoom } from "./mirror-geometry";

interface TouchAnchor {
  point: MappedPoint;
  zoom: MirrorZoom;
  distance: number | null;
}

const TAP_SLOP = 8;

export function useMirrorGesture(
  size: FrameSize,
  frame: FrameRect | null,
  pageKey: string,
  onTap: (point: MappedPoint, zoom: MirrorZoom) => void,
) {
  const view = useRef<View | null>(null);
  const [zoom, setZoom] = useState(FIT_MIRROR);
  const current = useRef(FIT_MIRROR);
  const anchor = useRef<TouchAnchor | null>(null);
  const suppressTap = useRef(false);
  const touchPage = useRef("");
  const hadTouch = useRef(false);
  const displayZoom = frame ? constrainMirrorZoom(zoom, size, frame) : FIT_MIRROR;

  const update = (event: GestureResponderEvent, phase: "start" | "move" | "end" | "cancel") => {
    const touches = event.nativeEvent.touches;
    if (phase === "cancel") {
      anchor.current = null;
      suppressTap.current = true;
      return;
    }
    if (!touches.length) {
      const start = anchor.current;
      anchor.current = null;
      // A browser may skip its synthetic click on the first tap after a gesture.
      // Handle touch release directly and reserve Pressable clicks for the mouse.
      if (phase === "end" && start && !suppressTap.current && touchPage.current === pageKey) {
        const ended = event.nativeEvent.changedTouches[0];
        const point = ended && nativeTouchPoint({ nativeEvent: ended }, view.current);
        if (point && Math.hypot(point.x - start.point.x, point.y - start.point.y) < TAP_SLOP)
          onTap(point, displayZoom);
      }
      return;
    }
    if (phase === "start" && touches.length === 1) {
      hadTouch.current = true;
      touchPage.current = pageKey;
      suppressTap.current = false;
      anchor.current = null;
    }
    if (touches.length > 1) suppressTap.current = true;
    if (!frame) return;

    const first = nativeTouchPoint({ nativeEvent: touches[0] }, view.current);
    const second = touches.length > 1 ? nativeTouchPoint({ nativeEvent: touches[1] }, view.current) : null;
    if (!first || (touches.length > 1 && !second)) return;
    const point = second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } : first;
    const distance = second ? Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)) : null;
    const from = anchor.current;
    if (!from || phase !== "move" || (distance === null) !== (from.distance === null)) {
      anchor.current = { point, distance, zoom: constrainMirrorZoom(current.current, size, frame) };
      return;
    }
    if (distance !== null && from.distance !== null) {
      const next = pinchMirror(from.zoom, from.point, point, distance / from.distance, size);
      current.current = constrainMirrorZoom(next, size, frame);
    } else {
      const dx = point.x - from.point.x;
      const dy = point.y - from.point.y;
      if (!suppressTap.current && Math.hypot(dx, dy) < TAP_SLOP) return;
      suppressTap.current = true;
      if (from.zoom.scale === 1) return;
      const next = { scale: from.zoom.scale, x: from.zoom.x + dx, y: from.zoom.y + dy };
      current.current = constrainMirrorZoom(next, size, frame);
    }
    setZoom(current.current);
  };

  return {
    view,
    zoom: displayZoom,
    onMousePress: (event: GestureResponderEvent) => {
      const source = event.nativeEvent as typeof event.nativeEvent & {
        pointerType?: string;
        sourceCapabilities?: { firesTouchEvents: boolean };
      };
      if (source.pointerType === "touch" || source.sourceCapabilities?.firesTouchEvents) return;
      if (hadTouch.current && source.pointerType !== "mouse" && !source.sourceCapabilities) return;
      const point = nativeTouchPoint(event, view.current);
      if (point) onTap(point, displayZoom);
    },
    touchHandlers: {
      onTouchStart: (event: GestureResponderEvent) => update(event, "start"),
      onTouchMove: (event: GestureResponderEvent) => update(event, "move"),
      onTouchEnd: (event: GestureResponderEvent) => update(event, "end"),
      onTouchCancel: (event: GestureResponderEvent) => update(event, "cancel"),
    },
  };
}
