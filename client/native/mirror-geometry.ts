import type { FrameRect, FrameSize, MappedPoint } from "../../shared/workspace/browser";

export type MirrorZoom = MappedPoint & { scale: number };
export const FIT_MIRROR: MirrorZoom = { scale: 1, x: 0, y: 0 };

export function constrainMirrorZoom(zoom: MirrorZoom, size: FrameSize, frame: FrameRect): MirrorZoom {
  const maxX = Math.max(0, (frame.width * zoom.scale - size.width) / 2);
  const maxY = Math.max(0, (frame.height * zoom.scale - size.height) / 2);
  return {
    scale: zoom.scale,
    x: Math.max(-maxX, Math.min(maxX, zoom.x)),
    y: Math.max(-maxY, Math.min(maxY, zoom.y)),
  };
}

/** Keep the content under the midpoint of the fingers as their distance changes. */
export function pinchMirror(
  zoom: MirrorZoom,
  start: MappedPoint,
  current: MappedPoint,
  distanceRatio: number,
  size: FrameSize,
): MirrorZoom {
  const scale = Math.max(1, Math.min(5, zoom.scale * distanceRatio));
  const ratio = scale / zoom.scale;
  return {
    scale,
    x: current.x - size.width / 2 - (start.x - size.width / 2 - zoom.x) * ratio,
    y: current.y - size.height / 2 - (start.y - size.height / 2 - zoom.y) * ratio,
  };
}

export function mirrorTapPoint(
  point: MappedPoint,
  size: FrameSize,
  frame: FrameRect,
  zoom: MirrorZoom,
  viewport: FrameSize,
): MappedPoint | null {
  if (viewport.width < 1 || viewport.height < 1) return null;
  const unscaledX = (point.x - size.width / 2 - zoom.x) / zoom.scale + size.width / 2;
  const unscaledY = (point.y - size.height / 2 - zoom.y) / zoom.scale + size.height / 2;
  const x = (unscaledX - frame.x) / frame.width;
  const y = (unscaledY - frame.y) / frame.height;
  if (!(x >= 0 && x < 1 && y >= 0 && y < 1)) return null;
  return {
    x: Math.min(viewport.width - 1, x * viewport.width),
    y: Math.min(viewport.height - 1, y * viewport.height),
  };
}
