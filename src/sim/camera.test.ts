/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Point3 } from '../toolpath/moves';
import type { Bounds3, CameraPose } from './camera';
import { CAMERA_PRESETS, cameraPose, framePose, jobBounds, orthoHalfHeight, presetDirection } from './camera';

const sheet: Bounds3 = { min: { x: 0, y: 0, z: -0.75 }, max: { x: 96, y: 48, z: 0.5 } };
const fov = 45;

/** Normalized device coordinates of `p` for a perspective camera at `pose` with +Z up. */
function project(pose: CameraPose, p: Point3, aspect: number): { x: number; y: number; depth: number } {
  const f = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
  const fl = Math.hypot(f.x, f.y, f.z);
  const fwd = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
  // right = fwd × up, up' = right × fwd (as a camera looking along fwd).
  let right = { x: fwd.y, y: -fwd.x, z: 0 };
  const rl = Math.hypot(right.x, right.y);
  right = { x: right.x / rl, y: right.y / rl, z: 0 };
  const up = { x: right.y * fwd.z - right.z * fwd.y, y: right.z * fwd.x - right.x * fwd.z, z: right.x * fwd.y - right.y * fwd.x };
  const d = { x: p.x - pose.position.x, y: p.y - pose.position.y, z: p.z - pose.position.z };
  const depth = d.x * fwd.x + d.y * fwd.y + d.z * fwd.z;
  const t = Math.tan(((fov / 2) * Math.PI) / 180);
  return {
    x: (d.x * right.x + d.y * right.y + d.z * right.z) / (depth * t * aspect),
    y: (d.x * up.x + d.y * up.y + d.z * up.z) / (depth * t),
    depth,
  };
}

function corners(b: Bounds3): Point3[] {
  const out: Point3[] = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push({ x, y, z });
  return out;
}

describe('presetDirection', () => {
  it('points the camera from the expected side', () => {
    expect(presetDirection('top').z).toBeCloseTo(1, 5);
    expect(presetDirection('top').y).toBeLessThan(0); // tilted towards −Y so +Y is up on screen
    expect(presetDirection('front')).toEqual({ x: 0, y: -1, z: 0 });
    expect(presetDirection('right')).toEqual({ x: 1, y: 0, z: 0 });
    const iso = presetDirection('iso');
    expect(iso.x).toBeLessThan(0);
    expect(iso.y).toBeLessThan(0);
    expect(iso.z).toBeGreaterThan(0);
  });

  it('is a unit vector never parallel to the up axis', () => {
    for (const preset of CAMERA_PRESETS) {
      const d = presetDirection(preset);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
      expect(Math.abs(d.z)).toBeLessThan(1);
    }
  });
});

describe('cameraPose', () => {
  it.each(CAMERA_PRESETS.flatMap((preset) => [1.6, 0.6].map((aspect) => [preset, aspect] as const)))(
    'frames every corner of the box in view for %s at aspect %s',
    (preset, aspect) => {
      const pose = cameraPose(preset, sheet, fov, aspect);
      expect(pose.target).toEqual({ x: 48, y: 24, z: -0.125 });
      let widest = 0;
      for (const c of corners(sheet)) {
        const ndc = project(pose, c, aspect);
        expect(ndc.depth).toBeGreaterThan(0);
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
        widest = Math.max(widest, Math.abs(ndc.x), Math.abs(ndc.y));
      }
      // Not needlessly far: the box fills at least half the view.
      expect(widest).toBeGreaterThan(0.5);
    }
  );

  it('puts the camera at the pose distance from the target along the preset direction', () => {
    const pose = cameraPose('right', sheet, fov, 1.5);
    expect(pose.position.x - pose.target.x).toBeCloseTo(pose.distance, 9);
    expect(pose.position.y).toBeCloseTo(pose.target.y, 9);
    expect(pose.position.z).toBeCloseTo(pose.target.z, 9);
  });

  it('frames the box when looking exactly along Z', () => {
    const pose = framePose({ x: 0, y: 0, z: 1 }, sheet, fov, 1.6);
    expect(Number.isFinite(pose.distance)).toBe(true);
    expect(pose.position.x).toBeCloseTo(48, 9);
    expect(pose.position.z).toBeGreaterThan(sheet.max.z);
  });

  it('frames a point with a positive distance', () => {
    const p = { x: 1, y: 2, z: 3 };
    expect(cameraPose('iso', { min: p, max: p }, fov, 1).distance).toBeGreaterThan(0);
  });
});

describe('jobBounds', () => {
  it('bounds every vertex of a segment buffer', () => {
    const path = new Float32Array([1, 2, 0.5, 4, 2, -0.25, 4, 2, -0.25, -1, 6, 0.5]);
    expect(jobBounds(path)).toEqual({ min: { x: -1, y: 2, z: -0.25 }, max: { x: 4, y: 6, z: 0.5 } });
  });

  it('bounds several buffers together', () => {
    const a = new Float32Array([0, 0, 0, 1, 1, 1]);
    const b = new Float32Array([5, -2, -1, 5, -2, -1]);
    expect(jobBounds(a, new Float32Array(), b)).toEqual({ min: { x: 0, y: -2, z: -1 }, max: { x: 5, y: 1, z: 1 } });
  });

  it('is null when every buffer is empty', () => {
    expect(jobBounds(new Float32Array())).toBeNull();
    expect(jobBounds()).toBeNull();
  });
});

describe('orthoHalfHeight', () => {
  it('matches the perspective view height at the target', () => {
    const pose = cameraPose('iso', sheet, fov, 1.5);
    const half = orthoHalfHeight(pose.distance, fov);
    // A point half the view height above the target projects to the top edge.
    const { x, y, z } = pose.target;
    const up = { x: 0, y: 0, z: 1 };
    const d = presetDirection('iso');
    // Screen-up is +Z with the view direction removed.
    const s = up.z - d.z * d.z;
    const screenUp = { x: -d.x * d.z / Math.sqrt(s), y: -d.y * d.z / Math.sqrt(s), z: s / Math.sqrt(s) };
    const top = { x: x + screenUp.x * half, y: y + screenUp.y * half, z: z + screenUp.z * half };
    expect(project(pose, top, 1.5).y).toBeCloseTo(1, 9);
    expect(orthoHalfHeight(10, 90)).toBeCloseTo(10, 12);
  });
});
