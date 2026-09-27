/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Rgb } from './stockMesh';
import { gridIndex, skirtIndex, skirtVertexCount, surfacePositions, writeSkirt, writeSurfaceRows } from './stockMesh';
import { createStock, cutSegment } from './stock';

const sheet = { x: 10, y: 6, thickness: 2 };
const bit = { diameter: 2, shape: { kind: 'flat' } as const };
const top: Rgb = [200, 180, 150];
const cut: Rgb = [90, 70, 50];

/** Signed Z of the normal of triangle (a, b, c) from a flat [x, y, z, …] buffer. */
function normal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const v = (k: number) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  const [pa, pb, pc] = [v(a), v(b), v(c)];
  const e1 = pb.map((x, i) => x - pa[i]);
  const e2 = pc.map((x, i) => x - pa[i]);
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
}

describe('stock surface', () => {
  it('places one vertex per grid point, spanning the sheet at the heights', () => {
    const stock = createStock(sheet, bit);
    cutSegment(stock, { x: 2, y: 3, z: -1 }, { x: 8, y: 3, z: -1 }, bit);
    const pos = surfacePositions(stock);
    expect(pos).toHaveLength(stock.nx * stock.ny * 3);
    const last = stock.nx * stock.ny - 1;
    expect(pos[last * 3]).toBeCloseTo(10, 5);
    expect(pos[last * 3 + 1]).toBeCloseTo(6, 5);
    for (let v = 0; v <= last; v++) expect(pos[v * 3 + 2]).toBe(stock.heights[v]);
  });

  it('indexes two upward-facing triangles per cell', () => {
    const stock = createStock(sheet, bit);
    const index = gridIndex(stock.nx, stock.ny);
    expect(index).toHaveLength((stock.nx - 1) * (stock.ny - 1) * 6);
    expect(Math.max(...index)).toBe(stock.nx * stock.ny - 1);
    const pos = surfacePositions(stock);
    for (let t = 0; t < index.length; t += 3) {
      expect(normal(pos, index[t], index[t + 1], index[t + 2])[2]).toBeGreaterThan(0);
    }
  });

  it('rewrites only the rows asked for, with cut and uncut colors', () => {
    const stock = createStock(sheet, bit);
    const pos = surfacePositions(stock);
    const colors = new Uint8Array(pos.length);
    writeSurfaceRows(stock, pos, { data: colors, top, cut }, 0, stock.ny - 1);
    cutSegment(stock, { x: 2, y: 3, z: -1 }, { x: 8, y: 3, z: -1 }, bit);
    const j = Math.round(3 / stock.dy);
    const range = writeSurfaceRows(stock, pos, { data: colors, top, cut }, j, j);
    expect(range).toEqual({ start: j * stock.nx * 3, count: stock.nx * 3 });
    const mid = j * stock.nx + Math.round(5 / stock.dx);
    expect(pos[mid * 3 + 2]).toBe(-1);
    expect(Array.from(colors.slice(mid * 3, mid * 3 + 3))).toEqual(cut);
    expect(Array.from(colors.slice(j * stock.nx * 3, j * stock.nx * 3 + 3))).toEqual(top);
    // A row that was cut but not rewritten keeps its old height.
    const above = (j + 1) * stock.nx + Math.round(5 / stock.dx);
    expect(stock.heights[above]).toBe(-1);
    expect(pos[above * 3 + 2]).toBe(0);
  });
});

describe('stock skirt', () => {
  it('walls the perimeter from the surface down to the sheet bottom, facing out', () => {
    const stock = createStock(sheet, bit);
    // Cut across the left edge so one wall is lowered.
    cutSegment(stock, { x: -1, y: 3, z: -1 }, { x: 3, y: 3, z: -1 }, bit);
    const count = skirtVertexCount(stock);
    const pos = new Float32Array(count * 3);
    writeSkirt(stock, pos);
    for (let p = 0; p < count / 2; p++) {
      expect(pos[(2 * p + 1) * 3 + 2]).toBe(-2);
      const x = pos[2 * p * 3];
      const y = pos[2 * p * 3 + 1];
      expect(x === 0 || y === 0 || Math.abs(x - 10) < 1e-5 || Math.abs(y - 6) < 1e-5).toBe(true);
    }
    // Some left-wall tops are at the cut depth.
    const lowered = Array.from({ length: count / 2 }, (_, p) => pos[2 * p * 3 + 2]).filter((z) => z === -1);
    expect(lowered.length).toBeGreaterThan(0);

    // Every quad faces away from the sheet center.
    const index = skirtIndex(stock);
    expect(index).toHaveLength((count / 2) * 6);
    for (let t = 0; t < index.length; t += 3) {
      const n = normal(pos, index[t], index[t + 1], index[t + 2]);
      const c = index[t];
      const out = [pos[c * 3] - 5, pos[c * 3 + 1] - 3];
      expect(n[0] * out[0] + n[1] * out[1]).toBeGreaterThan(0);
    }
  });
});
