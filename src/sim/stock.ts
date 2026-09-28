/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Material removal as a heightfield: one height per grid point over the
// sheet, lowered wherever the bit passes. Exact for 3-axis work with a
// vertical bit, which is all the parser produces. Machine coordinates
// throughout: Z = 0 at the sheet top, negative into material.
//
// The grid is fine (a small fraction of the bit diameter) and stored in
// square tiles that are only allocated where the bit cuts, so memory
// follows the job rather than the sheet. Uncut tiles are the flat sheet top.
// Tiles are copy-on-write so checkpoints can share the ones that did not
// change.
import type { BitShape, MachineParams } from '../machine/params';
import type { Point3 } from '../toolpath/moves';

/** Grid points per tile side (a power of two, so tile lookups are shifts). */
export const TILE = 64;
const TILE_SHIFT = 6;
const TILE_MASK = TILE - 1;

/** Target grid spacing is the bit diameter divided by this, unless a budget coarsens it. */
export const CELLS_PER_DIAMETER = 32;

/** Most grid points the job's cut tiles may hold (live, before checkpoint copies): 32 MB of heights. */
export const MAX_POINTS = 1 << 23;

/** Most tile slots (allocated or not) over the whole sheet. */
export const MAX_TILE_SLOTS = 1 << 20;

/** What cutting needs of the bit: its diameter and tip shape (flute direction only moves chips). */
export type Bit = Pick<MachineParams['bit'], 'diameter' | 'shape'>;

/** A straight piece of motion, as the planner's blocks give it. */
export type Stroke = { from: Point3; u: Point3; length: number };

/**
 * A stock's grid layout: `nx × ny` points, point `(i, j)` at
 * `(i·dx, j·dy)`, spanning the sheet exactly with edge points included,
 * grouped in `tx × ty` tiles of `TILE × TILE` points.
 */
export type StockGrid = {
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  tx: number;
  ty: number;
  /** True when a budget made the spacing coarser than diameter / `CELLS_PER_DIAMETER`. */
  coarsened: boolean;
};

/**
 * Heights of the material surface on a `StockGrid`, start at 0 and only
 * ever go down, never below `floor` (−thickness). `tiles[t]` holds tile
 * `t = tj·tx + ti` row by row, or null while nothing in it is cut (all 0).
 * `shared[t]` is 1 while that array is also held by a checkpoint, so it is
 * copied before its first write. `dirtyTiles` lists the tiles whose
 * meshes changed since the last `takeDirtyTiles` (flagged in `dirty`).
 */
export type Stock = StockGrid & {
  floor: number;
  tiles: (Float32Array | null)[];
  shared: Uint8Array;
  dirty: Uint8Array;
  dirtyTiles: number[];
};

/** Grid points a cut may have changed: `i0..i1` × `j0..j1`, inclusive. */
export type DirtyRect = { i0: number; j0: number; i1: number; j1: number };

function gridFor(sheet: MachineParams['sheet'], h: number) {
  const nx = Math.max(2, Math.ceil(sheet.x / h) + 1);
  const ny = Math.max(2, Math.ceil(sheet.y / h) + 1);
  return { nx, ny, dx: sheet.x / (nx - 1), dy: sheet.y / (ny - 1), tx: Math.ceil(nx / TILE), ty: Math.ceil(ny / TILE) };
}

/** The end of a stroke. */
function strokeEnd(s: Stroke): Point3 {
  return { x: s.from.x + s.u.x * s.length, y: s.from.y + s.u.y * s.length, z: s.from.z + s.u.z * s.length };
}

/**
 * How many tiles of a grid the cutting `strokes` can touch: each stroke's
 * footprint (its XY path grown by `r`) sampled every half tile, and every
 * tile within reach of a sample counted once. An overestimate, never an
 * underestimate.
 */
export function touchedTiles(
  strokes: readonly Stroke[],
  r: number,
  grid: Pick<StockGrid, 'dx' | 'dy' | 'tx' | 'ty'>
): number {
  const tileW = TILE * grid.dx;
  const tileH = TILE * grid.dy;
  const step = Math.min(tileW, tileH) / 2;
  const marks = new Uint8Array(grid.tx * grid.ty);
  let count = 0;
  for (const s of strokes) {
    const to = strokeEnd(s);
    if (s.from.z >= 0 && to.z >= 0) continue;
    const xy = Math.hypot(to.x - s.from.x, to.y - s.from.y);
    const n = Math.max(1, Math.ceil(xy / step));
    // One grid step extra: a cut on a tile's first row or column also allocates the tile before it.
    const reach = r + step / 2 + Math.max(grid.dx, grid.dy);
    for (let k = 0; k <= n; k++) {
      const x = s.from.x + ((to.x - s.from.x) * k) / n;
      const y = s.from.y + ((to.y - s.from.y) * k) / n;
      const ti0 = Math.max(0, Math.floor((x - reach) / tileW));
      const ti1 = Math.min(grid.tx - 1, Math.floor((x + reach) / tileW));
      const tj0 = Math.max(0, Math.floor((y - reach) / tileH));
      const tj1 = Math.min(grid.ty - 1, Math.floor((y + reach) / tileH));
      for (let tj = tj0; tj <= tj1; tj++) {
        for (let ti = ti0; ti <= ti1; ti++) {
          const t = tj * grid.tx + ti;
          if (!marks[t]) {
            marks[t] = 1;
            count++;
          }
        }
      }
    }
  }
  return count;
}

/**
 * The grid for cutting `strokes` (the job's planner blocks) on `sheet`:
 * spacing `bit.diameter / CELLS_PER_DIAMETER`, coarsened in steps of 25 %
 * until the tiles the job can touch fit `MAX_POINTS` and the sheet fits
 * `MAX_TILE_SLOTS` tiles.
 */
export function stockGrid(sheet: MachineParams['sheet'], bit: Bit, strokes: readonly Stroke[] = []): StockGrid {
  const fine = bit.diameter / CELLS_PER_DIAMETER;
  // Tile slots: (sheet / (TILE·h))² ≤ MAX_TILE_SLOTS.
  let h = Math.max(fine, Math.sqrt((sheet.x * sheet.y) / MAX_TILE_SLOTS) / TILE);
  let grid = gridFor(sheet, h);
  for (let k = 0; k < 60 && touchedTiles(strokes, bit.diameter / 2, grid) * TILE * TILE > MAX_POINTS; k++) {
    h *= 1.25;
    grid = gridFor(sheet, h);
  }
  return { ...grid, coarsened: h > fine * (1 + 1e-9) };
}

/** An uncut stock on `grid`. */
export function stockFromGrid(sheet: MachineParams['sheet'], grid: StockGrid): Stock {
  const n = grid.tx * grid.ty;
  return {
    ...grid,
    floor: -sheet.thickness,
    tiles: new Array<Float32Array | null>(n).fill(null),
    shared: new Uint8Array(n),
    dirty: new Uint8Array(n),
    dirtyTiles: [],
  };
}

/** An uncut stock for cutting `strokes` with `bit` (see `stockGrid`). */
export function createStock(sheet: MachineParams['sheet'], bit: Bit, strokes: readonly Stroke[] = []): Stock {
  return stockFromGrid(sheet, stockGrid(sheet, bit, strokes));
}

/** Height at grid point `(i, j)` (inside the grid). */
export function heightAt(stock: Stock, i: number, j: number): number {
  const tile = stock.tiles[(j >> TILE_SHIFT) * stock.tx + (i >> TILE_SHIFT)];
  return tile ? tile[((j & TILE_MASK) << TILE_SHIFT) | (i & TILE_MASK)] : 0;
}

/** Number of tiles holding cut material. */
export function allocatedTiles(stock: Stock): number {
  let n = 0;
  for (const t of stock.tiles) if (t) n++;
  return n;
}

/** All heights as one `nx × ny` array (row by row), for tests and debugging. */
export function denseHeights(stock: Stock): Float32Array {
  const out = new Float32Array(stock.nx * stock.ny);
  for (let j = 0; j < stock.ny; j++) for (let i = 0; i < stock.nx; i++) out[j * stock.nx + i] = heightAt(stock, i, j);
  return out;
}

/** Tile `t`'s heights, allocated or copied from a checkpoint first so they can be written. */
function writableTile(stock: Stock, t: number): Float32Array {
  let tile = stock.tiles[t];
  if (!tile) {
    tile = new Float32Array(TILE * TILE);
    stock.tiles[t] = tile;
    stock.shared[t] = 0;
  } else if (stock.shared[t]) {
    tile = tile.slice();
    stock.tiles[t] = tile;
    stock.shared[t] = 0;
  }
  return tile;
}

/** Allocates tile `t` if it is not yet (uncut, all 0), without copying a shared one. */
function ensureTile(stock: Stock, t: number) {
  if (!stock.tiles[t]) writableTile(stock, t);
}

function markDirty(stock: Stock, t: number) {
  if (stock.dirty[t]) return;
  stock.dirty[t] = 1;
  stock.dirtyTiles.push(t);
}

/**
 * The tiles whose meshes changed since the last call: every tile a cut
 * wrote to, and the tiles before it whose meshes share a cut first row or
 * column. Clears the list.
 */
export function takeDirtyTiles(stock: Stock): number[] {
  const list = stock.dirtyTiles;
  for (const t of list) stock.dirty[t] = 0;
  stock.dirtyTiles = [];
  return list;
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
 *
 * A cut on the first row or column of a tile also allocates the tile
 * before it, so the uncut flat top never overlaps a cut edge.
 */
export function cutSegment(stock: Stock, from: Point3, to: Point3, bit: Bit): DirtyRect | null {
  if (from.z >= 0 && to.z >= 0) return null;
  const { nx, ny, dx, dy, floor, tx } = stock;
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
    const tileRow = (j >> TILE_SHIFT) * tx;
    const rowInTile = (j & TILE_MASK) << TILE_SHIFT;
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
      // As stored, so re-cutting the same depth is not a write (and copies no shared tile).
      const cut = Math.fround(Math.max(z, floor));
      const t = tileRow + (i >> TILE_SHIFT);
      const k = rowInTile | (i & TILE_MASK);
      const current = stock.tiles[t];
      if (cut >= (current ? current[k] : 0)) continue;
      writableTile(stock, t)[k] = cut;
      markDirty(stock, t);
      // The tiles before a first row or column show it too; allocating them
      // keeps an uncut neighbor's flat top from covering this cut edge.
      const firstCol = (i & TILE_MASK) === 0 && i > 0;
      const firstRow = (j & TILE_MASK) === 0 && j > 0;
      const before = (n: number) => {
        ensureTile(stock, n);
        markDirty(stock, n);
      };
      if (firstCol) before(t - 1);
      if (firstRow) before(t - tx);
      if (firstCol && firstRow) before(t - tx - 1);
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

/** A copy of the tile table that shares every tile array; both sides copy a tile before writing it. */
export function snapshotTiles(stock: Stock): (Float32Array | null)[] {
  stock.shared.fill(1);
  return stock.tiles.slice();
}

/**
 * Restores tiles from `snapshotTiles` (still shared with it), or to uncut
 * stock with null. Clears the dirty list: everything needs redrawing.
 */
export function restoreTiles(stock: Stock, snapshot: (Float32Array | null)[] | null) {
  takeDirtyTiles(stock);
  if (snapshot) {
    stock.tiles = snapshot.slice();
    stock.shared.fill(1);
  } else {
    stock.tiles.fill(null);
    stock.shared.fill(0);
  }
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
