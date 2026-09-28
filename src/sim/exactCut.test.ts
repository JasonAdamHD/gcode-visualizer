/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Point3 } from '../toolpath/moves';
import type { ExactBit, ExactStroke } from './exactCut';
import { MAX_EXACT_STROKES, cuttingSegments, exactCut, segmentsKey, toolPoints } from './exactCut';

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
const stroke = (a: Point3, b: Point3): ExactStroke => {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return { from: a, u: { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length }, length };
};

const sheet = { x: 100, y: 60, thickness: 10 };
const flat: ExactBit = { diameter: 6, shape: { kind: 'flat' } };
const ball: ExactBit = { diameter: 6, shape: { kind: 'ball' } };
const sheetVolume = sheet.x * sheet.y * sheet.thickness;

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

describe('cuttingSegments', () => {
  it('merges a straight run split into many moves, and keeps corners', () => {
    const pts = [p(0, 0, -1), p(1, 0, -1), p(2, 0, -1), p(3, 0, -1), p(3, 2, -1)];
    const strokes = pts.slice(1).map((b, k) => stroke(pts[k], b));
    expect(Array.from(cuttingSegments(strokes, 0.001))).toEqual([0, 0, -1, 3, 0, -1, 3, 0, -1, 3, 2, -1]);
  });

  it('drops moves that stay at or above the sheet top and does not bridge across them', () => {
    const strokes = [
      stroke(p(0, 0, -1), p(1, 0, -1)),
      stroke(p(1, 0, -1), p(1, 0, 5)),
      stroke(p(1, 0, 5), p(4, 0, 5)),
      stroke(p(4, 0, 5), p(4, 0, -1)),
      stroke(p(4, 0, -1), p(5, 0, -1)),
    ];
    const segs = Array.from(cuttingSegments(strokes, 0.001));
    // The first cut, the retract (it starts below the top), the plunge and the last cut; never the rapid.
    expect(segs.length / 6).toBe(4);
    for (let k = 0; k < segs.length; k += 6) expect(Math.min(segs[k + 2], segs[k + 5])).toBeLessThan(0);
  });

  it('brings a 10⁵-move raster of short straight moves under MAX_EXACT_STROKES', () => {
    const strokes: ExactStroke[] = [];
    let at = p(1, 1, -0.2);
    for (let k = 0; k < 100_000; k++) {
      const row = Math.floor(k / 200);
      const col = k % 200;
      const next = p(1 + (row % 2 ? 199 - col : col) * 0.19, 1 + row * 0.036, -0.2);
      if (next.x !== at.x || next.y !== at.y) strokes.push(stroke(at, next));
      at = next;
    }
    const n = cuttingSegments(strokes, 0.002 / 25.4).length / 6;
    expect(n).toBeLessThan(MAX_EXACT_STROKES);
    expect(n).toBeLessThan(strokes.length / 20);
  });

  it('keeps an arc chorded beyond the tolerance as separate segments', () => {
    const pts = Array.from({ length: 9 }, (_, k) => p(10 * Math.cos((k * Math.PI) / 16), 10 * Math.sin((k * Math.PI) / 16), -1));
    const strokes = pts.slice(1).map((b, k) => stroke(pts[k], b));
    expect(cuttingSegments(strokes, 0.001).length / 6).toBe(8);
  });
});

describe('segmentsKey', () => {
  it('is equal for equal contents and differs when a value or the length changes', () => {
    const a = Float64Array.from([0, 0, -1, 3, 0, -1]);
    expect(segmentsKey(Float64Array.from(a))).toBe(segmentsKey(a));
    expect(segmentsKey(Float64Array.from([0, 0, -1, 3, 0, -1.5]))).not.toBe(segmentsKey(a));
    expect(segmentsKey(a.subarray(0, 3))).not.toBe(segmentsKey(a));
    expect(segmentsKey(new Float64Array())).toBe('0:811c9dc5');
  });
});

describe('toolPoints', () => {
  it('outlines the bit within its radius, from the tip up to the given height', () => {
    const pts = toolPoints(ball, 20, 0.01);
    const zs = pts.map((q) => q[2]);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBe(20);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeLessThanOrEqual(3 + 1e-9);
    // Round to the tolerance: enough sides that a chord's sagitta is under 0.01.
    const ring = pts.filter((q) => q[2] === 20 && Math.hypot(q[0], q[1]) > 0);
    expect(3 * (1 - Math.cos(Math.PI / ring.length))).toBeLessThanOrEqual(0.01);
  });
});

describe('exactCut', () => {
  const tolerance = 0.002;
  const cut = (bit: ExactBit, strokes: ExactStroke[]) =>
    exactCut(wasm, { sheet, bit, segments: cuttingSegments(strokes, tolerance), tolerance });

  it('leaves the sheet whole with nothing to cut', () => {
    expect(cut(flat, [stroke(p(10, 10, 5), p(90, 50, 5))]).volume).toBeCloseTo(sheetVolume, 3);
  });

  it('removes a flat slot: a box plus two half cylinders', () => {
    const mesh = cut(flat, [stroke(p(20, 30, -3), p(80, 30, -3))]);
    const removed = 60 * 6 * 3 + Math.PI * 9 * 3;
    expect(sheetVolume - mesh.volume).toBeCloseTo(removed, 0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.positions.length % 3).toBe(0);
  });

  it('removes a ball slot at full ball depth: a half cylinder plus a sphere', () => {
    const mesh = cut(ball, [stroke(p(20, 30, -3), p(80, 30, -3))]);
    const removed = 60 * ((Math.PI * 9) / 2) + (4 / 3) * Math.PI * 27 * 0.5;
    // The polygonal ball is a little inside the true sphere.
    expect(Math.abs(sheetVolume - mesh.volume - removed) / removed).toBeLessThan(0.005);
  });

  it('removes a plunge as a round hole and clips cuts at the sheet edge', () => {
    const hole = cut(flat, [stroke(p(50, 30, 2), p(50, 30, -4))]);
    expect(sheetVolume - hole.volume).toBeCloseTo(Math.PI * 9 * 4, 0);
    // A slot running off the right edge removes only its part on the sheet.
    const off = cut(flat, [stroke(p(90, 30, -3), p(130, 30, -3))]);
    expect(sheetVolume - off.volume).toBeCloseTo(10 * 6 * 3 + (Math.PI * 9 * 3) / 2, 0);
  });

  it('removes overlapping moves once', () => {
    const once = cut(flat, [stroke(p(20, 30, -3), p(80, 30, -3))]);
    const twice = cut(flat, [stroke(p(20, 30, -3), p(80, 30, -3)), stroke(p(80, 30, -3), p(20, 30, -3))]);
    expect(twice.volume).toBeCloseTo(once.volume, 2);
  });
});
