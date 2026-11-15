import * as THREE from "three";
import {
  BASE_ZOOM,
  type HomeView,
  type ViewAngles,
  clampFocus,
  fitHomeView,
  zoomBounds,
  zoomPercent,
} from "./cameraFit.js";
import type { Rect } from "./layout.js";

/** Distance from the focus the camera orbits at; fog and far-plane derive from it too. */
export const CAMERA_DISTANCE = 40;
const DEFAULT_VIEW: ViewAngles = { theta: 0.62, phi: 0.98 };
const PHI_MIN = 0.55;
const PHI_MAX = 1.25;
const ZOOM_MAX = 3.2;
const ZOOM_BUTTON_STEP = 1.35;
/** Higher = snappier zoom easing (per second). */
const ZOOM_EASE = 11;
const FOCUS_EASE = 7;
const MIN_HALF_HEIGHT = 7.3;
const HALF_WIDTH_TO_FIT = 12.4;
/** R10: refit the home view only after the roster has been still this long.
 * Must exceed the app's refresh max-wait (1000 ms in App.tsx) so the UI's
 * observed roster cannot appear "still" mid-burst and fire partial refits. */
const HOME_REFIT_SETTLE_MS = 1200;

export interface CameraRigOptions {
  /** Current effective footprint (desk block + any grown zone floors). */
  getFootprint: () => Rect;
  /** Called with the absolute zoom percentage whenever the zoom target changes. */
  onZoomChange?: (percent: number) => void;
  /** Called on every camera move with the focus, the ground extent to cover and
   * the camera distance used (fog/far planes derive from it). */
  onCameraMoved?: (focus: THREE.Vector3, extent: number, distance: number) => void;
}

export interface CameraRig {
  readonly camera: THREE.OrthographicCamera;
  applyCamera: () => void;
  stepZoom: (dt: number) => boolean;
  stepFocus: (dt: number) => boolean;
  orbit: (dx: number, dy: number) => void;
  requestZoom: (
    nextTarget: number,
    anchorX: number,
    anchorY: number,
    userInitiated: boolean,
  ) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  setRightInset: (px: number) => void;
  onLayoutChanged: () => void;
  /** Recompute the home view from the current footprint without touching the camera. */
  refreshHome: () => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
  zoomTarget: () => number;
  isAnimating: () => boolean;
}

export function createCameraRig(options: CameraRigOptions): CameraRig {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const size = { width: 1, height: 1 };
  const view = { theta: DEFAULT_VIEW.theta, phi: DEFAULT_VIEW.phi, zoom: BASE_ZOOM };
  const focus = new THREE.Vector3(0, 0.3, 0);
  let focusGoal: THREE.Vector3 | null = null;
  const zoom = { target: BASE_ZOOM, anchorX: 0, anchorY: 0 };
  let rightInset = 0;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();

  const frustum = () => {
    const aspect = Math.max(1e-3, size.width / size.height);
    const halfHeight = Math.max(MIN_HALF_HEIGHT, HALF_WIDTH_TO_FIT / aspect);
    return { halfWidth: halfHeight * aspect, halfHeight };
  };

  const insetFraction = () => (size.width > 0 ? rightInset / size.width : 0);

  function computeHome(): HomeView {
    return fitHomeView(options.getFootprint(), DEFAULT_VIEW, frustum(), insetFraction());
  }

  let home = computeHome();
  let minZoom = zoomBounds(home).min;
  let userAdjustedView = false;
  let refitTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshHome = () => {
    home = computeHome();
    minZoom = zoomBounds(home).min;
  };

  const homeFocusPoint = (): THREE.Vector3 =>
    new THREE.Vector3(home.focus.x, home.focus.y, home.focus.z);

  /** Diagonal the outdoor ground must cover so no edge of the frame shows void. */
  const groundExtent = (): number => {
    const halfW = (camera.right - camera.left) / 2 / view.zoom;
    const halfH = (camera.top - camera.bottom) / 2 / view.zoom;
    return 8 * Math.hypot(halfW, halfH);
  };

  const applyCamera = () => {
    const aspect = Math.max(1e-3, size.width / size.height);
    const halfH = Math.max(MIN_HALF_HEIGHT, HALF_WIDTH_TO_FIT / aspect);
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.zoom = view.zoom;
    // Keep the camera high enough that the frame's bottom edge cannot dip
    // below the ground horizon (SC-002): the world half-height on screen grows
    // as zoom shrinks, so the orbit distance grows with it.
    const halfHWorld = halfH / view.zoom;
    const distance = Math.max(CAMERA_DISTANCE, halfHWorld * 1.6);
    camera.position.set(
      focus.x + distance * Math.sin(view.phi) * Math.sin(view.theta),
      focus.y + distance * Math.cos(view.phi),
      focus.z + distance * Math.sin(view.phi) * Math.cos(view.theta),
    );
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    options.onCameraMoved?.(focus, groundExtent(), distance);
  };

  /**
   * Ease zoom toward its target. For an orthographic camera a screen point at NDC n sits
   * n * halfExtent / zoom away from the focus, so panning the focus by
   * n * halfExtent * (1/z0 - 1/z1) keeps whatever is under the cursor in place.
   */
  const stepZoom = (dt: number): boolean => {
    const prev = view.zoom;
    if (Math.abs(zoom.target - prev) < 1e-4) return false;
    const blend = reduceMotion ? 1 : 1 - Math.exp(-ZOOM_EASE * dt);
    let next = prev + (zoom.target - prev) * blend;
    if (Math.abs(zoom.target - next) < 1e-3) next = zoom.target;

    const k = 1 / prev - 1 / next;
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    focus.addScaledVector(camRight, zoom.anchorX * camera.right * k);
    focus.addScaledVector(camUp, zoom.anchorY * camera.top * k);
    clampFocusToFootprint();
    view.zoom = next;
    applyCamera();
    return true;
  };

  const stepFocus = (dt: number): boolean => {
    if (!focusGoal) return false;
    focus.lerp(focusGoal, reduceMotion ? 1 : 1 - Math.exp(-FOCUS_EASE * dt));
    if (focus.distanceToSquared(focusGoal) < 1e-5) {
      focus.copy(focusGoal);
      focusGoal = null;
    }
    clampFocusToFootprint();
    applyCamera();
    return true;
  };

  const clampFocusToFootprint = () => {
    const clamped = clampFocus(focus, options.getFootprint());
    focus.set(clamped.x, clamped.y, clamped.z);
  };

  const cancelRefit = () => {
    if (refitTimer !== null) {
      clearTimeout(refitTimer);
      refitTimer = null;
    }
  };

  const refitToHome = () => {
    zoom.target = home.zoom;
    zoom.anchorX = 0;
    zoom.anchorY = 0;
    focusGoal = homeFocusPoint();
    options.onZoomChange?.(zoomPercent(zoom.target));
  };

  const requestZoom = (
    nextTarget: number,
    anchorX: number,
    anchorY: number,
    userInitiated: boolean,
  ) => {
    zoom.target = THREE.MathUtils.clamp(nextTarget, minZoom, ZOOM_MAX);
    zoom.anchorX = anchorX;
    zoom.anchorY = anchorY;
    if (userInitiated) userAdjustedView = true;
    focusGoal = null;
    options.onZoomChange?.(zoomPercent(zoom.target));
  };

  return {
    camera,
    applyCamera,
    stepZoom,
    stepFocus,
    orbit: (dx, dy) => {
      view.theta -= dx * 0.006;
      view.phi = THREE.MathUtils.clamp(view.phi - dy * 0.005, PHI_MIN, PHI_MAX);
      userAdjustedView = true;
      applyCamera();
    },
    requestZoom,
    zoomIn: () => requestZoom(zoom.target * ZOOM_BUTTON_STEP, 0, 0, true),
    zoomOut: () => requestZoom(zoom.target / ZOOM_BUTTON_STEP, 0, 0, true),
    resetView: () => {
      cancelRefit();
      view.theta = DEFAULT_VIEW.theta;
      view.phi = DEFAULT_VIEW.phi;
      userAdjustedView = false;
      refitToHome();
      applyCamera();
    },
    setRightInset: (px) => {
      const delta = (px - rightInset) / 2;
      rightInset = px;
      refreshHome();
      if (delta === 0) return;
      const worldPerPx = (camera.right - camera.left) / view.zoom / size.width;
      camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      focusGoal = (focusGoal ?? focus).clone().addScaledVector(camRight, delta * worldPerPx);
    },
    // R10: refresh the home immediately, then refit once the roster has settled —
    // unless the user is steering the camera themselves (FR-012).
    onLayoutChanged: () => {
      refreshHome();
      cancelRefit();
      if (userAdjustedView) return;
      refitTimer = setTimeout(refitToHome, HOME_REFIT_SETTLE_MS);
    },
    refreshHome,
    resize: (width, height) => {
      size.width = Math.max(1, width);
      size.height = Math.max(1, height);
      refreshHome();
      applyCamera();
    },
    dispose: cancelRefit,
    zoomTarget: () => zoom.target,
    isAnimating: () => zoom.target !== view.zoom || focusGoal !== null,
  };
}
