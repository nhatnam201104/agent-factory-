import { describe, expect, it } from "vitest";
import {
  BASE_ZOOM,
  type Frustum,
  type Rect,
  clampFocus,
  fitHomeView,
  tagDensity,
  zoomBounds,
  zoomPercent,
} from "../../apps/web-arena/src/scene3d/cameraFit.js";
import { computeOfficeLayout } from "../../apps/web-arena/src/scene3d/layout.js";

const ANGLES = { theta: 0.62, phi: 0.98 };
const EPS = 1e-9;

/** Camera basis for an orthographic camera at (theta, phi) looking at the focus. */
function basis(theta: number, phi: number) {
  const zx = Math.sin(phi) * Math.sin(theta);
  const zy = Math.cos(phi);
  const zz = Math.sin(phi) * Math.cos(theta);
  const xLen = Math.hypot(zz, zx);
  const xx = zz / xLen;
  const xzz = -zx / xLen;
  // yAxis = cross(zAxis, xAxis)
  const yx = zy * xzz - zz * 0;
  const yy = zz * xx - zx * xzz;
  const yz = zx * 0 - zy * xx;
  return { xAxis: [xx, 0, xzz], yAxis: [yx, yy, yz] };
}

function project(
  point: { x: number; y: number; z: number },
  focus: { x: number; y: number; z: number },
) {
  const { xAxis, yAxis } = basis(ANGLES.theta, ANGLES.phi);
  const dx = point.x - focus.x;
  const dy = point.y - focus.y;
  const dz = point.z - focus.z;
  return {
    u: dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
    v: dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
  };
}

function frustumFor(aspect: number): Frustum {
  const halfHeight = Math.max(7.3, 12.4 / aspect);
  return { halfWidth: halfHeight * aspect, halfHeight };
}

describe("clampFocus", () => {
  const footprint: Rect = { minX: -10, maxX: 10, minZ: -6, maxZ: 8 };

  it("keeps a point inside the footprint unchanged", () => {
    const focus = { x: 3, y: 0.5, z: -2 };
    const clamped = clampFocus(focus, footprint);
    expect(clamped).toEqual(focus);
  });

  it("clamps outside points to the footprint expanded by 2", () => {
    const clamped = clampFocus({ x: 40, y: 10, z: -30 }, footprint);
    expect(clamped.x).toBeCloseTo(footprint.maxX + 2, 9);
    expect(clamped.z).toBeCloseTo(footprint.minZ - 2, 9);
    expect(clamped.y).toBe(6);
  });

  it("clamps y into [-4, 6] and returns a new object", () => {
    const focus = { x: 0, y: -9, z: 0 };
    const clamped = clampFocus(focus, footprint);
    expect(clamped.y).toBe(-4);
    expect(clamped).not.toBe(focus);
  });
});

describe("fitHomeView", () => {
  const aspects = [16 / 10, 16 / 9, 4 / 3];

  it("fits every footprint corner and keeps >= 60% width at every scale (SC-003, FR-010)", () => {
    for (const n of [1, 3, 40, 150, 200]) {
      const footprint = computeOfficeLayout(n).footprint;
      for (const aspect of aspects) {
        const frustum = frustumFor(aspect);
        const home = fitHomeView(footprint, ANGLES, frustum, 0);
        expect(home.zoom).toBeLessThanOrEqual(BASE_ZOOM + EPS);
        const halfW = frustum.halfWidth / home.zoom;
        const halfH = frustum.halfHeight / home.zoom;
        let maxAbsU = 0;
        let maxAbsV = 0;
        for (const x of [footprint.minX, footprint.maxX]) {
          for (const y of [0, 2.6]) {
            for (const z of [footprint.minZ, footprint.maxZ]) {
              const { u, v } = project({ x, y, z }, home.focus);
              expect(Math.abs(u), `n=${n} aspect=${aspect}`).toBeLessThanOrEqual(halfW + EPS);
              expect(Math.abs(v), `n=${n} aspect=${aspect}`).toBeLessThanOrEqual(halfH + EPS);
              maxAbsU = Math.max(maxAbsU, Math.abs(u));
              maxAbsV = Math.max(maxAbsV, Math.abs(v));
            }
          }
        }
        expect(maxAbsU / halfW).toBeGreaterThanOrEqual(0.6 - EPS);
      }
    }
  });

  it("keeps the office usable while the quick panel covers part of the width", () => {
    const footprint = computeOfficeLayout(40).footprint;
    const frustum = frustumFor(16 / 9);
    const inset = 0.24;
    const home = fitHomeView(footprint, ANGLES, frustum, inset);
    const halfW = frustum.halfWidth / home.zoom;
    // The focus shifts right so the office centres in the strip left of the
    // panel: visible camera-space u spans [-halfW, (1 - 2*inset) * halfW].
    for (const x of [footprint.minX, footprint.maxX]) {
      for (const y of [0, 2.6]) {
        for (const z of [footprint.minZ, footprint.maxZ]) {
          const { u } = project({ x, y, z }, home.focus);
          expect(u).toBeGreaterThanOrEqual(-halfW - EPS);
          expect(u).toBeLessThanOrEqual((1 - 2 * inset) * halfW + EPS);
        }
      }
    }
  });
});

describe("zoom scale helpers (R6)", () => {
  const home = { focus: { x: 0, y: 0.3, z: 0 }, zoom: 0.8 };

  it("bounds zooming to 80% of home and an absolute maximum", () => {
    const bounds = zoomBounds(home);
    expect(bounds.min).toBeCloseTo(home.zoom * 0.8, 12);
    expect(bounds.max).toBe(3.2);
  });

  it("reads BASE_ZOOM as an absolute 100%", () => {
    expect(BASE_ZOOM).toBe(1.15);
    expect(zoomPercent(BASE_ZOOM)).toBe(100);
  });

  it("switches tag density below 55% (R6)", () => {
    expect(tagDensity(BASE_ZOOM * 0.54)).toBe("compact");
    expect(tagDensity(BASE_ZOOM * 0.56)).toBe("full");
  });
});
