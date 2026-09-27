/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Material removal as a heightfield: one height per grid point over the
// sheet, lowered wherever the bit passes. Exact for 3-axis work with a
// vertical bit, which is all the parser produces. Machine coordinates
// throughout: Z = 0 at the sheet top, negative into material.
import type { BitShape, MachineParams } from '../machine/params';
import type { Point3 } from '../toolpath/moves';

/** Upper bound on grid points; a big sheet with a small bit gets a coarser grid instead of more memory. */
export const MAX_CELLS = 1 << 20;

/** Target grid spacing is the bit diameter divided by this, unless `MAX_CELLS` coarsens it. */
export const CELLS_PER_DIAMETER = 8;

export type Bit = MachineParams['bit'];

/**
 * Heights of the material surface at `nx × ny` grid points: point `(i, j)`
 * is at `(i·dx, j·dy)` and its height is `heights[j·nx + i]`. The grid
 * spans the sheet exactly, edge points included. Heights start at 0 and
 * only ever go down, never below `floor` (−thickness).
 */
export type Stock = {
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  floor: number;
  heights: Float32Array;
  /** True when `MAX_CELLS` made the spacing coarser than diameter / `CELLS_PER_DIAMETER`. */
  coarsened: boolean;
};

/** Grid points a cut may have changed: `i0..i1` × `j0..j1`, inclusive. */
export type DirtyRect = { i0: number; j0: number; i1: number; j1: number };

/**
 * An uncut stock for `sheet` (world units). The spacing aims for
 * `bit.diameter / CELLS_PER_DIAMETER` and is coarsened, uniformly in X and
 * Y, when that would exceed `MAX_CELLS` points.
 */
export function createStock(sheet: MachineParams['sheet'], bit: Bit): Stock {
  const fine = bit.diameter / CELLS_PER_DIAMETER;
  const capped = Math.sqrt((sheet.x * sheet.y) / MAX_CELLS);
  const cell = Math.max(fine, capped);
  const nx = Math.max(2, Math.ceil(sheet.x / cell) + 1);
  const ny = Math.max(2, Math.ceil(sheet.y / cell) + 1);
  return {
    nx,
    ny,
    dx: sheet.x / (nx - 1),
    dy: sheet.y / (ny - 1),
    floor: -sheet.thickness,
    heights: new Float32Array(nx * ny),
    coarsened: capped > fine,
  };
}

/**
 * Height of the bit's cutting surface above its tip at horizontal distance
 * `d` from its axis (same units as `diameter`): 0 for a flat end mill,
 * `r − √(r² − d²)` for a ball nose, `d / tan(half-angle)` for a V-bit.
 * Infinity beyond the radius, where the shank's side is vertical and cuts
 * nothing. Matches the tip of `bitProfile`.
 */
export function tipOffset(shape: BitShape, diameter: number, d: number): number {
  const r = diameter / 2;
  if (d > r) return Infinity;
  switch (shape.kind) {
    case 'flat':
      return 0;
    case 'ball':
      return r - Math.sqrt(r * r - d * d);
    case 'vbit':
      return d / Math.tan((shape.includedAngleDeg / 2) * (Math.PI / 180));
  }
}

/** Golden-section steps: the bracket shrinks to 0.618⁴⁸ ≈ 1e-10 of the move. */
const GOLDEN_STEPS = 48;
const INV_PHI = (Math.sqrt(5) - 1) / 2;
const EPS = 1e-12;

/**
 * Lowers `stock` to the surface swept by the bit's tip moving in a straight
 * line `from` → `to` (world units) and returns the grid points it looked
 * at, or null when it cannot have cut anything (tip never below Z = 0, or
 * entirely off the sheet).
 *
 * Exact per grid point: the tool surface above a point along the move is
 * `z(t) + tipOffset(distance(t))`, which is convex in `t` for every bit
 * shape, so its minimum is found in closed form for level, vertical and
 * flat-bit moves and by golden-section search otherwise. Since every point
 * takes `min(height, surface)`, cutting a move in pieces equals cutting it
 * whole.
 */
export function cutSegment(stock: Stock, from: Point3, to: Point3, bit: Bit): DirtyRect | null {
  if (from.z >= 0 && to.z >= 0) return null;
  const { nx, ny, dx, dy, floor, heights } = stock;
  const r = bit.diameter / 2;
  const i0 = Math.max(0, Math.ceil((Math.min(from.x, to.x) - r) / dx));
  const i1 = Math.min(nx - 1, Math.floor((Math.max(from.x, to.x) + r) / dx));
  const j0 = Math.max(0, Math.ceil((Math.min(from.y, to.y) - r) / dy));
  const j1 = Math.min(ny - 1, Math.floor((Math.max(from.y, to.y) + r) / dy));
  if (i0 > i1 || j0 > j1) return null;

  const shape = bit.shape;
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const dz = to.z - from.z;
  const vv = vx * vx + vy * vy;
  const level = Math.abs(dz) <= EPS;
  const vertical = vv <= EPS;
  const r2 = r * r;
  // Tool surface at parameter t for a point at squared distance h2 from the
  // move's line and t0 along it. Distances are clamped to the radius so
  // rounding at the ends of the feasible range cannot give NaN.
  const surface = (t: number, t0: number, h2: number) => {
    const s = t - t0;
    const d = Math.min(r, Math.sqrt(h2 + vv * s * s));
    return from.z + dz * t + tipOffset(shape, bit.diameter, d);
  };

  for (let j = j0; j <= j1; j++) {
    const py = j * dy - from.y;
    const row = j * nx;
    for (let i = i0; i <= i1; i++) {
      const px = i * dx - from.x;
      // Closest point on the (infinite) line, and the squared distance to it.
      const t0 = vertical ? 0 : (px * vx + py * vy) / vv;
      const ex = px - t0 * vx;
      const ey = py - t0 * vy;
      const h2 = ex * ex + ey * ey;
      if (h2 > r2) continue;
      // Parameters where the point is under the bit.
      let ta = 0;
      let tb = 1;
      if (!vertical) {
        const w = Math.sqrt((r2 - h2) / vv);
        ta = Math.max(0, t0 - w);
        tb = Math.min(1, t0 + w);
        if (ta > tb) continue;
      }
      let z: number;
      if (level) z = surface(Math.min(tb, Math.max(ta, t0)), t0, h2);
      else if (vertical || shape.kind === 'flat') z = surface(dz > 0 ? ta : tb, t0, h2);
      else z = minimizeConvex((t) => surface(t, t0, h2), ta, tb);
      const k = row + i;
      if (z < heights[k]) heights[k] = Math.max(z, floor);
    }
  }
  return { i0, j0, i1, j1 };
}

/** Minimum of a convex `f` on `[a, b]` by golden-section search, ends included. */
function minimizeConvex(f: (t: number) => number, a: number, b: number): number {
  const ends = Math.min(f(a), f(b));
  let c = b - INV_PHI * (b - a);
  let d = a + INV_PHI * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let k = 0; k < GOLDEN_STEPS; k++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - INV_PHI * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + INV_PHI * (b - a);
      fd = f(d);
    }
  }
  return Math.min(ends, fc, fd);
}

/** Smallest rectangle covering both (either may be null). */
export function unionRect(a: DirtyRect | null, b: DirtyRect | null): DirtyRect | null {
  if (!a) return b;
  if (!b) return a;
  return {
    i0: Math.min(a.i0, b.i0),
    j0: Math.min(a.j0, b.j0),
    i1: Math.max(a.i1, b.i1),
    j1: Math.max(a.j1, b.j1),
  };
}
