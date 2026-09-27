/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Vertex buffers for drawing a tiled Stock: a fine grid mesh per cut tile
// (sharing one index layout, so tiles can be packed into a few big
// buffers), a coarse flat top over the uncut tiles, and a skirt of walls
// from the surface edge down to the sheet bottom. Machine coordinates.
import type { DirtyRect, Stock } from './stock';
import { TILE, heightAt } from './stock';

/** An 8-bit RGB color. */
export type Rgb = [number, number, number];

/** Heights at or above this count as uncut sheet top (float32 noise stays well inside it). */
const CUT_EPS = 1e-6;

/**
 * Vertices in one tile's mesh: `(TILE + 1)²`, the tile's own points plus the
 * first column and row of the next tiles, so neighboring meshes meet.
 */
export const TILE_VERTS = (TILE + 1) * (TILE + 1);

/** Triangle indices for an `nx × ny` vertex grid, two triangles per cell, counterclockwise seen from +Z. */
export function gridIndex(nx: number, ny: number): Uint32Array {
  const out = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let k = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      // Plain stores: this runs over every cell.
      const a = j * nx + i;
      out[k++] = a;
      out[k++] = a + 1;
      out[k++] = a + nx + 1;
      out[k++] = a;
      out[k++] = a + nx + 1;
      out[k++] = a + nx;
    }
  }
  return out;
}

/** Indices for `slots` tile meshes packed one after another (`TILE_VERTS` vertices each). */
export function packedTileIndex(slots: number): Uint32Array {
  const one = gridIndex(TILE + 1, TILE + 1);
  const out = new Uint32Array(one.length * slots);
  for (let s = 0; s < slots; s++) {
    const base = s * TILE_VERTS;
    const at = s * one.length;
    for (let k = 0; k < one.length; k++) out[at + k] = one[k] + base;
  }
  return out;
}

/**
 * Writes tile `t`'s mesh vertices at vertex `offset` of `positions` (and, when
 * given, `colors` as RGB bytes: `top` for uncut, `cut` for cut points).
 * Points past the grid's last row or column repeat it, which makes
 * zero-area triangles at the sheet's far edges.
 */
export function writeTileVertices(
  stock: Stock,
  t: number,
  positions: Float32Array,
  colors: { data: Uint8Array; top: Rgb; cut: Rgb } | null,
  offset: number
) {
  const { nx, ny, dx, dy, tx } = stock;
  const i0 = (t % tx) * TILE;
  const j0 = Math.floor(t / tx) * TILE;
  let v = offset;
  for (let b = 0; b <= TILE; b++) {
    const j = Math.min(j0 + b, ny - 1);
    for (let a = 0; a <= TILE; a++) {
      const i = Math.min(i0 + a, nx - 1);
      const h = heightAt(stock, i, j);
      positions[v * 3] = i * dx;
      positions[v * 3 + 1] = j * dy;
      positions[v * 3 + 2] = h;
      if (colors) {
        const c = h < -CUT_EPS ? colors.cut : colors.top;
        colors.data[v * 3] = c[0];
        colors.data[v * 3 + 1] = c[1];
        colors.data[v * 3 + 2] = c[2];
      }
      v++;
    }
  }
}

/**
 * Tiles whose meshes show any point of `rect`: the tiles containing it, and
 * the tiles before them when it touches their shared first row or column.
 */
export function tilesCovering(stock: Stock, rect: DirtyRect): number[] {
  const { tx } = stock;
  const range = (lo: number, hi: number) => [Math.max(0, Math.floor((lo - 1) / TILE)), Math.floor(hi / TILE)];
  const [ti0, ti1] = range(rect.i0, rect.i1);
  const [tj0, tj1] = range(rect.j0, rect.j1);
  const out: number[] = [];
  for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= Math.min(ti1, tx - 1); ti++) out.push(tj * tx + ti);
  return out;
}

/** Corner vertices of every tile slot, flat at the sheet top: `(tx + 1) × (ty + 1)`, clamped to the sheet. */
export function flatTopPositions(stock: Stock): Float32Array {
  const { tx, ty, nx, ny, dx, dy } = stock;
  const out = new Float32Array((tx + 1) * (ty + 1) * 3);
  let k = 0;
  for (let b = 0; b <= ty; b++) {
    for (let a = 0; a <= tx; a++) {
      out[k++] = Math.min(a * TILE, nx - 1) * dx;
      out[k++] = Math.min(b * TILE, ny - 1) * dy;
      out[k++] = 0;
    }
  }
  return out;
}

/** Indices of the flat top: one quad per uncut (unallocated) tile, over `flatTopPositions`. */
export function flatTopIndex(stock: Stock): Uint32Array {
  const { tx, ty, tiles } = stock;
  const quads: number[] = [];
  for (let tj = 0; tj < ty; tj++) {
    for (let ti = 0; ti < tx; ti++) {
      if (tiles[tj * tx + ti]) continue;
      const a = tj * (tx + 1) + ti;
      quads.push(a, a + 1, a + tx + 2, a, a + tx + 2, a + tx + 1);
    }
  }
  return Uint32Array.from(quads);
}

/** Grid points around the edge, counterclockwise from the origin: `2·(nx + ny) − 4` of them, as `[i, j]`. */
function perimeter(stock: Stock): [number, number][] {
  const { nx, ny } = stock;
  const out: [number, number][] = [];
  for (let i = 0; i < nx - 1; i++) out.push([i, 0]);
  for (let j = 0; j < ny - 1; j++) out.push([nx - 1, j]);
  for (let i = nx - 1; i > 0; i--) out.push([i, ny - 1]);
  for (let j = ny - 1; j > 0; j--) out.push([0, j]);
  return out;
}

/** Number of skirt vertices: a top and a bottom one per perimeter point. */
export function skirtVertexCount(stock: Stock): number {
  return 2 * (2 * (stock.nx + stock.ny) - 4);
}

/** Triangle indices for the skirt: a quad between each pair of neighboring perimeter points, facing outwards. */
export function skirtIndex(stock: Stock): Uint32Array {
  const m = skirtVertexCount(stock) / 2;
  const out = new Uint32Array(m * 6);
  for (let p = 0; p < m; p++) {
    const q = (p + 1) % m;
    // Vertex 2p is on the surface, 2p + 1 at the bottom.
    out.set([2 * p + 1, 2 * q + 1, 2 * q, 2 * p + 1, 2 * q, 2 * p], p * 6);
  }
  return out;
}

/**
 * Writes the skirt: for each perimeter point, a vertex at the surface
 * height and one at the sheet bottom (`stock.floor`). Cheap enough to redo
 * whenever a cut touches the edge.
 */
export function writeSkirt(stock: Stock, positions: Float32Array) {
  const { dx, dy, floor } = stock;
  perimeter(stock).forEach(([i, j], p) => {
    const x = i * dx;
    const y = j * dy;
    positions.set([x, y, heightAt(stock, i, j), x, y, floor], p * 6);
  });
}
