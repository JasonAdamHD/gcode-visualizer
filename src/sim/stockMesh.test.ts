/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Rgb } from './stockMesh';
import {
  TILE_VERTS,
  flatTopIndex,
  flatTopPositions,
  gridIndex,
  packedTileIndex,
  skirtIndex,
  skirtVertexCount,
  tilesCovering,
  writeSkirt,
  writeTileVertices,
} from './stockMesh';
import { TILE, createStock, cutSegment, heightAt } from './stock';

const sheet = { x: 10, y: 6, thickness: 2 };
const bit = { diameter: 2, shape: { kind: 'flat' } as const };
const top: Rgb = [200, 180, 150];
const cut: Rgb = [90, 70, 50];

/** Signed normal of triangle (a, b, c) from a flat [x, y, z, …] buffer. */
function normal(pos: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const v = (k: number) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  const [pa, pb, pc] = [v(a), v(b), v(c)];
  const e1 = pb.map((x, i) => x - pa[i]);
  const e2 = pc.map((x, i) => x - pa[i]);
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
}

describe('gridIndex', () => {
  it('indexes two upward-facing triangles per cell', () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0]);
    const index = gridIndex(3, 2);
    expect(index).toHaveLength(2 * 6);
    for (let t = 0; t < index.length; t += 3) expect(normal(pos, index[t], index[t + 1], index[t + 2])[2]).toBeGreaterThan(0);
  });

  it('packs tile meshes one after another', () => {
    const one = gridIndex(TILE + 1, TILE + 1);
    const two = packedTileIndex(2);
    expect(two).toHaveLength(one.length * 2);
    expect(two[one.length]).toBe(one[0] + TILE_VERTS);
    expect(Math.max(...two)).toBe(2 * TILE_VERTS - 1);
  });
});

describe('tile meshes', () => {
  it("places a tile's vertices at its points and its neighbors' first row and column, with colors", () => {
    const stock = createStock(sheet, bit);
    cutSegment(stock, { x: 1, y: 1, z: -1 }, { x: 9, y: 1, z: -1 }, bit);
    const t = 0;
    const positions = new Float32Array(TILE_VERTS * 3);
    const data = new Uint8Array(TILE_VERTS * 3);
    writeTileVertices(stock, t, positions, { data, top, cut }, 0);
    for (let b = 0; b <= TILE; b += 16) {
      for (let a = 0; a <= TILE; a += 16) {
        const v = b * (TILE + 1) + a;
        expect(positions[v * 3]).toBeCloseTo(a * stock.dx, 5);
        expect(positions[v * 3 + 1]).toBeCloseTo(b * stock.dy, 5);
        const h = heightAt(stock, a, b);
        expect(positions[v * 3 + 2]).toBe(h);
        expect(Array.from(data.slice(v * 3, v * 3 + 3))).toEqual(h < 0 ? cut : top);
      }
    }
  });

  it('clamps points past the sheet edge to the last row and column', () => {
    const stock = createStock(sheet, bit);
    const last = stock.tx * stock.ty - 1;
    const positions = new Float32Array(TILE_VERTS * 3);
    writeTileVertices(stock, last, positions, null, 0);
    const corner = TILE_VERTS - 1;
    expect(positions[corner * 3]).toBeCloseTo(sheet.x, 5);
    expect(positions[corner * 3 + 1]).toBeCloseTo(sheet.y, 5);
  });

  it('covers the tiles containing a rectangle and the ones before a shared edge', () => {
    const stock = createStock(sheet, bit);
    expect(tilesCovering(stock, { i0: 1, j0: 1, i1: 2, j1: 2 })).toEqual([0]);
    // Column TILE is the first column of tile 1 and the stitch column of tile 0.
    expect(tilesCovering(stock, { i0: TILE, j0: 1, i1: TILE, j1: 1 })).toEqual([0, 1]);
    expect(tilesCovering(stock, { i0: TILE + 1, j0: 1, i1: TILE + 1, j1: 1 })).toEqual([1]);
    const tx = stock.tx;
    expect(tilesCovering(stock, { i0: TILE, j0: TILE, i1: TILE, j1: TILE })).toEqual([0, 1, tx, tx + 1]);
  });
});

describe('flat top', () => {
  it('covers exactly the uncut tiles', () => {
    const stock = createStock(sheet, bit);
    const all = flatTopIndex(stock);
    expect(all).toHaveLength(stock.tx * stock.ty * 6);
    const pos = flatTopPositions(stock);
    for (let t = 0; t < all.length; t += 3) expect(normal(pos, all[t], all[t + 1], all[t + 2])[2]).toBeGreaterThanOrEqual(0);
    cutSegment(stock, { x: 1, y: 1, z: -1 }, { x: 2, y: 1, z: -1 }, bit);
    const allocated = stock.tiles.filter(Boolean).length;
    expect(flatTopIndex(stock)).toHaveLength((stock.tx * stock.ty - allocated) * 6);
    // Corners stay on the sheet.
    expect(Math.max(...pos.filter((_, k) => k % 3 === 0))).toBeCloseTo(sheet.x, 5);
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
    const lowered = Array.from({ length: count / 2 }, (_, p) => pos[2 * p * 3 + 2]).filter((z) => z === -1);
    expect(lowered.length).toBeGreaterThan(0);

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
