/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The exact finished part: the sheet minus the solid swept by the bit along
// every cutting move, as a triangle mesh. A vertical bit's tip is convex
// (a cylinder, a ball end or a cone), and a convex solid moving in a
// straight line sweeps the convex hull of its start and end positions, so
// each move is one hull; the manifold-3d library unions them and subtracts
// the result. Machine coordinates (Z = 0 at the sheet top). The library
// module is passed in, so this runs in a Web Worker in the app and in Node
// in tests.
import type { ManifoldToplevel, Vec3 } from 'manifold-3d';
import type { MachineParams } from '../machine/params';
import type { Point3 } from '../toolpath/moves';
import { bitProfile } from './sceneData';

/** What the exact cut needs of the bit: its diameter and tip shape. */
export type ExactBit = Pick<MachineParams['bit'], 'diameter' | 'shape'>;

/** A straight piece of motion, as the planner's blocks give it. */
export type ExactStroke = { from: Point3; u: Point3; length: number };

/** Most swept moves the exact cut takes on (after merging); beyond this it would take minutes. */
export const MAX_EXACT_STROKES = 20_000;

/** Moves unioned per batch before the batches are unioned. */
const BATCH = 500;

/** Longest run of strokes merged into one segment (each extension re-checks the run). */
const MAX_RUN = 64;

/** Most sides for the bit's circles. */
const MAX_SEGMENTS = 96;

/** A flat list of cutting segments, `[x0, y0, z0, x1, y1, z1, …]`. */
export type SegmentList = Float64Array;

/**
 * The cutting moves among `strokes` (tip below Z = 0 somewhere) as one
 * segment list, merging runs of consecutive strokes that stay within
 * `tolerance` (world units) of a single straight segment. That merges long
 * straight runs split into many moves, and never moves the swept path
 * further than the tolerance the planner already used to chord arcs.
 */
export function cuttingSegments(strokes: readonly ExactStroke[], tolerance: number): SegmentList {
  const out: number[] = [];
  let run: Point3[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const a = run[0];
      const b = run[run.length - 1];
      out.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    run = [];
  };
  const end = (s: ExactStroke): Point3 => ({
    x: s.from.x + s.u.x * s.length,
    y: s.from.y + s.u.y * s.length,
    z: s.from.z + s.u.z * s.length,
  });
  for (const s of strokes) {
    const to = end(s);
    if (s.from.z >= 0 && to.z >= 0) {
      flush();
      continue;
    }
    const last = run[run.length - 1];
    const continues = last && Math.hypot(last.x - s.from.x, last.y - s.from.y, last.z - s.from.z) <= 1e-9;
    if (continues && run.length < MAX_RUN && run.every((p) => distanceToSegment(p, run[0], to) <= tolerance)) {
      run.push(to);
      continue;
    }
    flush();
    run = [s.from, to];
  }
  flush();
  return Float64Array.from(out);
}

/** 3D distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point3, a: Point3, b: Point3): number {
  const v = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const vv = v.x * v.x + v.y * v.y + v.z * v.z;
  const t = vv === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * v.x + (p.y - a.y) * v.y + (p.z - a.z) * v.z) / vv));
  return Math.hypot(p.x - a.x - t * v.x, p.y - a.y - t * v.y, p.z - a.z - t * v.z);
}

/**
 * Points whose convex hull is the bit, tip at the origin and axis up +Z, up
 * to `height` above the tip: its side outline (`bitProfile`) revolved with
 * enough sides that the circles stray at most `tolerance` from round.
 */
export function toolPoints(bit: ExactBit, height: number, tolerance: number): Vec3[] {
  const r = bit.diameter / 2;
  const segments = Math.min(MAX_SEGMENTS, Math.max(12, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / r)))));
  const points: Vec3[] = [];
  for (const q of bitProfile(bit.shape, bit.diameter, height)) {
    if (q.x === 0) {
      points.push([0, 0, q.y]);
      continue;
    }
    for (let k = 0; k < segments; k++) {
      const a = (2 * Math.PI * k) / segments;
      points.push([q.x * Math.cos(a), q.x * Math.sin(a), q.y]);
    }
  }
  return points;
}

export type ExactCutInput = {
  sheet: MachineParams['sheet'];
  bit: ExactBit;
  segments: SegmentList;
  /** How far the bit's circles may stray from round, in world units. */
  tolerance: number;
};

/** The finished part as a triangle mesh: vertex positions `[x, y, z, …]` and triangle vertex indices. */
export type ExactCutMesh = { positions: Float32Array; indices: Uint32Array; volume: number };

/**
 * The sheet minus every cutting segment's swept bit. `onProgress` gets the
 * fraction of the moves swept and unioned in batches, reaching 1 before the
 * final union and subtraction, which take a while on their own.
 */
export function exactCut(wasm: ManifoldToplevel, input: ExactCutInput, onProgress?: (fraction: number) => void): ExactCutMesh {
  const { Manifold } = wasm;
  const { sheet, bit, segments, tolerance } = input;
  const n = segments.length / 6;

  // Tall enough that the bit's top clears the sheet top from its lowest tip.
  let lowest = 0;
  for (let k = 0; k < n; k++) lowest = Math.min(lowest, segments[k * 6 + 2], segments[k * 6 + 5]);
  const tool = toolPoints(bit, -lowest + bit.diameter, tolerance);

  const owned: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(m: T): T => {
    owned.push(m);
    return m;
  };
  try {
    const batches = [];
    const steps = n + Math.ceil(n / BATCH);
    let done = 0;
    for (let start = 0; start < n; start += BATCH) {
      const hulls = [];
      try {
        for (let k = start; k < Math.min(n, start + BATCH); k++) {
          const o = k * 6;
          const pts: Vec3[] = [];
          for (const [x, y, z] of tool) {
            pts.push([x + segments[o], y + segments[o + 1], z + segments[o + 2]]);
            pts.push([x + segments[o + 3], y + segments[o + 4], z + segments[o + 5]]);
          }
          hulls.push(Manifold.hull(pts));
          done++;
        }
        batches.push(track(Manifold.union(hulls)));
      } finally {
        // Freed as soon as they are in the batch, so memory stays at one batch of hulls.
        for (const h of hulls) h.delete();
      }
      done++;
      onProgress?.(done / steps);
    }
    onProgress?.(1);
    const box = track(Manifold.cube([sheet.x, sheet.y, sheet.thickness]).translate([0, 0, -sheet.thickness]));
    const part = batches.length > 0 ? track(box.subtract(track(Manifold.union(batches)))) : box;
    const mesh = part.getMesh();
    // Positions only: without extra properties each vertex is x, y, z.
    const stride = mesh.numProp;
    const count = mesh.vertProperties.length / stride;
    const positions = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      positions[v * 3] = mesh.vertProperties[v * stride];
      positions[v * 3 + 1] = mesh.vertProperties[v * stride + 1];
      positions[v * 3 + 2] = mesh.vertProperties[v * stride + 2];
    }
    return { positions, indices: Uint32Array.from(mesh.triVerts), volume: part.volume() };
  } finally {
    for (const m of owned) m.delete();
  }
}
