/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Vertex buffers for drawing a Stock: a grid surface (one vertex per stock
// grid point, so a cut only rewrites the rows it touched) and a skirt of
// walls from the surface edge down to the sheet bottom. Machine coordinates.
import type { Stock } from './stock';

/** An 8-bit RGB color. */
export type Rgb = [number, number, number];

/** Heights at or above this count as uncut sheet top (float32 noise stays well inside it). */
const CUT_EPS = 1e-6;

/** Triangle indices for an `nx × ny` vertex grid, two triangles per cell, counterclockwise seen from +Z. */
export function gridIndex(nx: number, ny: number): Uint32Array {
  const out = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let k = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      // Plain stores: this runs over up to MAX_CELLS cells.
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

/** Surface vertex positions `[x, y, z, …]` for every grid point, in heights order. */
export function surfacePositions(stock: Stock): Float32Array {
  const out = new Float32Array(stock.nx * stock.ny * 3);
  writeSurfaceRows(stock, out, null, 0, stock.ny - 1);
  return out;
}

/**
 * Copies rows `j0..j1` of the stock into surface `positions` (Z only; X and
 * Y never change) and, when given, into `colors` (RGB bytes per vertex):
 * `top` for uncut points and `cut` for cut ones. Returns the element range
 * written, `{ start, count }`, per 3-component vertex attribute.
 */
export function writeSurfaceRows(
  stock: Stock,
  positions: Float32Array,
  colors: { data: Uint8Array; top: Rgb; cut: Rgb } | null,
  j0: number,
  j1: number
): { start: number; count: number } {
  const { nx, dx, dy, heights } = stock;
  for (let j = j0; j <= j1; j++) {
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i;
      const h = heights[v];
      positions[v * 3] = i * dx;
      positions[v * 3 + 1] = j * dy;
      positions[v * 3 + 2] = h;
      if (colors) {
        const c = h < -CUT_EPS ? colors.cut : colors.top;
        colors.data[v * 3] = c[0];
        colors.data[v * 3 + 1] = c[1];
        colors.data[v * 3 + 2] = c[2];
      }
    }
  }
  return { start: j0 * nx * 3, count: (j1 - j0 + 1) * nx * 3 };
}

/** Grid points around the edge, counterclockwise from the origin: `2·(nx + ny) − 4` of them. */
function perimeter(stock: Stock): number[] {
  const { nx, ny } = stock;
  const out: number[] = [];
  for (let i = 0; i < nx - 1; i++) out.push(i);
  for (let j = 0; j < ny - 1; j++) out.push(j * nx + nx - 1);
  for (let i = nx - 1; i > 0; i--) out.push((ny - 1) * nx + i);
  for (let j = ny - 1; j > 0; j--) out.push(j * nx);
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
  const { nx, dx, dy, heights, floor } = stock;
  perimeter(stock).forEach((v, p) => {
    const x = (v % nx) * dx;
    const y = Math.floor(v / nx) * dy;
    positions.set([x, y, heights[v], x, y, floor], p * 6);
  });
}
