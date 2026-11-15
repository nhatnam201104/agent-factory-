/**
 * Pure camera framing math (no `three`, no DOM): default home view, zoom
 * bounds and focus clamping, all derived from the office footprint so the
 * view always fits every agent count. 100% zoom is the absolute BASE_ZOOM.
 */
import type { Rect } from "./layout.js";

export interface ViewAngles {
  readonly theta: number;
  readonly phi: number;
}

/** Camera half extents (world units) at zoom = 1. */
export interface Frustum {
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export interface HomeView {
  readonly focus: { readonly x: number; readonly y: number; readonly z: number };
  readonly zoom: number;
}

/** The old default framing; zoom relative to this is what "100%" means. */
export const BASE_ZOOM = 1.15;
const ZOOM_ABS_MAX = 3.2;
const ZOOM_HOME_FALLBACK = 0.8;
/** Focus may stray this far beyond the footprint so the office never fully leaves the screen. */
const FOCUS_MARGIN = 2;
const FOCUS_Y_MIN = -4;
const FOCUS_Y_MAX = 6;
/** Screen-space breathing room around the fitted footprint. */
const FRAME_MARGIN = 0.08;
/** Height of name tags — the fit must keep them visible too. */
const TAG_HEIGHT = 2.6;
const FOCUS_REST_Y = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamp a focus point so part of the office always stays in view (FR-011). */
export function clampFocus(
  focus: { readonly x: number; readonly y: number; readonly z: number },
  footprint: Rect,
): { x: number; y: number; z: number } {
  return {
    x: clamp(focus.x, footprint.minX - FOCUS_MARGIN, footprint.maxX + FOCUS_MARGIN),
    y: clamp(focus.y, FOCUS_Y_MIN, FOCUS_Y_MAX),
    z: clamp(focus.z, footprint.minZ - FOCUS_MARGIN, footprint.maxZ + FOCUS_MARGIN),
  };
}

/** Orthonormal camera axes for a look-at camera at orbit angles (matches three.js lookAt). */
function cameraBasis(
  theta: number,
  phi: number,
): {
  xAxis: readonly [number, number, number];
  yAxis: readonly [number, number, number];
} {
  const zAxis: readonly [number, number, number] = [
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  ];
  const xLen = Math.hypot(zAxis[2], zAxis[0]);
  const xAxis: readonly [number, number, number] = [zAxis[2] / xLen, 0, -zAxis[0] / xLen];
  const yAxis: readonly [number, number, number] = [
    zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1],
    zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2],
    zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0],
  ];
  return { xAxis, yAxis };
}

/**
 * Frame the whole footprint (plus tag height) with an 8% margin. The result
 * never zooms past BASE_ZOOM, so small offices open at the familiar "100%".
 * `rightInsetFraction` is the width fraction hidden behind a side panel; the
 * focus shifts so the office centres in the remaining strip.
 */
export function fitHomeView(
  footprint: Rect,
  angles: ViewAngles,
  frustum: Frustum,
  rightInsetFraction = 0,
): HomeView {
  const centerX = (footprint.minX + footprint.maxX) / 2;
  const centerZ = (footprint.minZ + footprint.maxZ) / 2;
  const { xAxis, yAxis } = cameraBasis(angles.theta, angles.phi);
  let maxU = 0;
  let maxV = 0;
  for (const x of [footprint.minX, footprint.maxX]) {
    for (const y of [0, TAG_HEIGHT]) {
      for (const z of [footprint.minZ, footprint.maxZ]) {
        const dx = x - centerX;
        const dy = y - FOCUS_REST_Y;
        const dz = z - centerZ;
        maxU = Math.max(maxU, Math.abs(dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2]));
        maxV = Math.max(maxV, Math.abs(dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2]));
      }
    }
  }
  const margin = 1 + 2 * FRAME_MARGIN;
  // The inset fraction can exceed 1 on tiny windows with the side panel open;
  // clamping keeps zoom strictly positive (a zero zoom would poison focus/zoom
  // state through refitToHome and zoomBounds).
  const inset = clamp(rightInsetFraction, 0, 0.9);
  const usableHalfWidth = frustum.halfWidth * (1 - inset);
  const zoom = Math.max(
    1e-3,
    Math.min(BASE_ZOOM, usableHalfWidth / (maxU * margin), frustum.halfHeight / (maxV * margin)),
  );
  const shift = (inset * frustum.halfWidth) / zoom;
  return {
    focus: {
      x: centerX + xAxis[0] * shift,
      y: FOCUS_REST_Y,
      z: centerZ + xAxis[2] * shift,
    },
    zoom,
  };
}

/** Zoom out is capped at 80% of the current home view. */
export function zoomBounds(home: HomeView): { readonly min: number; readonly max: number } {
  return { min: home.zoom * ZOOM_HOME_FALLBACK, max: ZOOM_ABS_MAX };
}

/** Absolute zoom percentage; BASE_ZOOM reads as exactly 100%. */
export function zoomPercent(zoom: number): number {
  return Math.round((zoom / BASE_ZOOM) * 100);
}

/** Below 55% name tags collapse to status dot + short code (R6). */
export function tagDensity(zoom: number): "full" | "compact" {
  return zoom / BASE_ZOOM < 0.55 ? "compact" : "full";
}
