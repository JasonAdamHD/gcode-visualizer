/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Camera math for the 3D view, free of Three.js: view presets, framing a
// box, and matching an orthographic view to a perspective one. Machine
// coordinates, Z up; the camera's up vector is always +Z (OrbitControls
// orbits around it), so a view straight down gets a tiny tilt instead.
import type { Point3 } from '../toolpath/moves';

export type Bounds3 = { min: Point3; max: Point3 };

export type CameraPreset = 'iso' | 'top' | 'front' | 'right';

export const CAMERA_PRESETS: CameraPreset[] = ['iso', 'top', 'front', 'right'];

/** Where a camera sits and looks; `distance` is from `position` to `target`. */
export type CameraPose = { position: Point3; target: Point3; distance: number };

/**
 * How far a top view leans towards −Y. Looking exactly along the up axis
 * would leave OrbitControls without a defined azimuth; this keeps +Y up on
 * screen and is invisible at any zoom.
 */
const TOP_TILT = 1e-3;

function normalize(v: Point3): Point3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Point3, b: Point3): Point3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Unit vector from the target towards the camera for a preset: `iso` from
 * the front left, above (the view the 3D tab opens with); `top` from above
 * with +Y up on screen; `front` from −Y; `right` from +X.
 */
export function presetDirection(preset: CameraPreset): Point3 {
  switch (preset) {
    case 'iso':
      return normalize({ x: -0.35, y: -1, z: 0.9 });
    case 'top':
      return normalize({ x: 0, y: -TOP_TILT, z: 1 });
    case 'front':
      return { x: 0, y: -1, z: 0 };
    case 'right':
      return { x: 1, y: 0, z: 0 };
  }
}

/** The camera's screen axes for a view direction, with +Z as up. */
function screenAxes(direction: Point3): { right: Point3; up: Point3 } {
  const across = cross({ x: 0, y: 0, z: 1 }, direction);
  // Looking straight along Z: any right will do; +X keeps +Y up for a top view.
  const right = Math.hypot(across.x, across.y, across.z) < 1e-9 ? { x: 1, y: 0, z: 0 } : normalize(across);
  return { right, up: cross(direction, right) };
}

/**
 * A perspective camera looking along −`direction` at the center of
 * `bounds`, just far enough back that the whole box fits the view
 * (vertical field of view `fovDeg`, width / height `aspect`), with
 * `margin` (a fraction) to spare.
 */
export function framePose(direction: Point3, bounds: Bounds3, fovDeg: number, aspect: number, margin = 0.05): CameraPose {
  const dir = normalize(direction);
  const { right, up } = screenAxes(dir);
  const target = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  // Half extents of the box seen from the camera: across, up, and towards it.
  let halfRight = 0;
  let halfUp = 0;
  let halfDepth = 0;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const c = { x: x - target.x, y: y - target.y, z: z - target.z };
        halfRight = Math.max(halfRight, Math.abs(dot(c, right)));
        halfUp = Math.max(halfUp, Math.abs(dot(c, up)));
        halfDepth = Math.max(halfDepth, Math.abs(dot(c, dir)));
      }
    }
  }
  const tanV = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const tanH = tanV * aspect;
  // Every corner is at most halfDepth nearer than the target, so fitting the
  // extents at that depth fits the whole box.
  const fit = Math.max(halfUp / tanV, halfRight / tanH) * (1 + margin);
  const distance = Math.max(fit + halfDepth, 1e-6);
  return {
    position: { x: target.x + dir.x * distance, y: target.y + dir.y * distance, z: target.z + dir.z * distance },
    target,
    distance,
  };
}

/** `framePose` for one of the presets. */
export function cameraPose(preset: CameraPreset, bounds: Bounds3, fovDeg: number, aspect: number): CameraPose {
  return framePose(presetDirection(preset), bounds, fovDeg, aspect);
}

/**
 * Bounds of the vertices in one or more buffers `[x0, y0, z0, x1, …]`
 * (such as `pathBuffer` or the per-kind `moveLineBuffers`), or null when
 * they are all empty.
 */
export function jobBounds(...paths: Float32Array[]): Bounds3 | null {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let any = false;
  for (const path of paths) {
    for (let k = 0; k + 2 < path.length; k += 3) {
      any = true;
      min.x = Math.min(min.x, path[k]);
      min.y = Math.min(min.y, path[k + 1]);
      min.z = Math.min(min.z, path[k + 2]);
      max.x = Math.max(max.x, path[k]);
      max.y = Math.max(max.y, path[k + 1]);
      max.z = Math.max(max.z, path[k + 2]);
    }
  }
  return any ? { min, max } : null;
}

/**
 * Half the height an orthographic view needs to show what a perspective
 * view with vertical field of view `fovDeg` shows at `distance`, so
 * switching between them keeps the target's scale.
 */
export function orthoHalfHeight(distance: number, fovDeg: number): number {
  return distance * Math.tan(((fovDeg / 2) * Math.PI) / 180);
}
