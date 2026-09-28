/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { BitShape } from '../machine/params';
import type { Point3 } from '../toolpath/moves';
import { bitProfile } from './sceneData';
import type { Bit, Stock } from './stock';
import type { Stroke } from './stock';
import {
  CELLS_PER_DIAMETER,
  MAX_POINTS,
  MAX_TILE_SLOTS,
  TILE,
  allocatedTiles,
  createStock,
  cutSegment,
  denseHeights,
  heightAt,
  restoreTiles,
  snapshotTiles,
  stockGrid,
  takeDirtyTiles,
  tipOffset,
  touchedTiles,
} from './stock';

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
const sheet = { x: 100, y: 60, thickness: 10 };
const flat: Bit = { diameter: 6, shape: { kind: 'flat' } };
const ball: Bit = { diameter: 6, shape: { kind: 'ball' } };
const vbit: Bit = { diameter: 10, shape: { kind: 'vbit', includedAngleDeg: 90 } };

/** Horizontal distance from (x, y) to the XY segment a–b. */
function distToSegment(x: number, y: number, a: Point3, b: Point3): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const vv = vx * vx + vy * vy;
  const t = vv === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * vx + (y - a.y) * vy) / vv));
  return Math.hypot(x - a.x - t * vx, y - a.y - t * vy);
}

/** Every grid point matches `expected(x, y)` to float32 precision. */
function expectHeights(stock: Stock, expected: (x: number, y: number) => number) {
  let worst = 0;
  for (let j = 0; j < stock.ny; j++) {
    for (let i = 0; i < stock.nx; i++) {
      const diff = Math.abs(heightAt(stock, i, j) - expected(i * stock.dx, j * stock.dy));
      worst = Math.max(worst, diff);
    }
  }
  expect(worst).toBeLessThan(1e-5);
}

/** Level cut at depth `z` along a–b: the bit's surface around the segment, never above the top or below the floor. */
function levelCut(stock: Stock, bit: Bit, a: Point3, b: Point3) {
  return (x: number, y: number) => {
    const surface = a.z + tipOffset(bit.shape, bit.diameter, distToSegment(x, y, a, b));
    return Math.max(stock.floor, Math.min(0, surface));
  };
}

describe('tipOffset', () => {
  const shapes: BitShape[] = [{ kind: 'flat' }, { kind: 'ball' }, { kind: 'vbit', includedAngleDeg: 60 }];

  it.each(shapes)('matches the tip of bitProfile for a $kind bit', (shape) => {
    const diameter = 6;
    const outline = bitProfile(shape, diameter, 20);
    // Tip points run from the axis out to the radius, before the shank.
    const tip = outline.slice(0, outline.findIndex((q) => q.x >= diameter / 2 - 1e-12) + 1);
    for (const q of tip) expect(tipOffset(shape, diameter, q.x)).toBeCloseTo(q.y, 9);
  });

  it('is linear for a V-bit and Infinity outside the radius', () => {
    const v: BitShape = { kind: 'vbit', includedAngleDeg: 90 };
    expect(tipOffset(v, 10, 2.5)).toBeCloseTo(2.5, 12);
    expect(tipOffset(v, 10, 5.0001)).toBe(Infinity);
    expect(tipOffset({ kind: 'flat' }, 6, 3.1)).toBe(Infinity);
  });
});

describe('createStock', () => {
  it('uses diameter / 8 spacing over the whole sheet, uncut', () => {
    const stock = createStock(sheet, flat);
    expect(stock.coarsened).toBe(false);
    expect(stock.dx).toBeLessThanOrEqual(flat.diameter / CELLS_PER_DIAMETER);
    expect(stock.dy).toBeLessThanOrEqual(flat.diameter / CELLS_PER_DIAMETER);
    expect((stock.nx - 1) * stock.dx).toBeCloseTo(sheet.x, 9);
    expect((stock.ny - 1) * stock.dy).toBeCloseTo(sheet.y, 9);
    expect(stock.floor).toBe(-10);
    expect(allocatedTiles(stock) === 0).toBe(true);
  });

  it('keeps the tile table under MAX_TILE_SLOTS for a huge sheet and a tiny bit', () => {
    const stock = createStock({ x: 2440, y: 1220, thickness: 18 }, { diameter: 0.1, shape: { kind: 'flat' } });
    expect(stock.coarsened).toBe(true);
    expect(stock.tx * stock.ty).toBeLessThanOrEqual(MAX_TILE_SLOTS * 1.01);
    expect(Math.abs(stock.dx - stock.dy) / stock.dx).toBeLessThan(0.01);
  });

  it('stays fine for a small job on a big sheet, and coarsens only when the job exceeds MAX_POINTS', () => {
    const big = { x: 2440, y: 1220, thickness: 18 };
    const bit: Bit = { diameter: 3, shape: { kind: 'flat' } };
    const stroke = (x0: number, y0: number, x1: number, y1: number): Stroke => {
      const length = Math.hypot(x1 - x0, y1 - y0);
      return { from: p(x0, y0, -2), u: { x: (x1 - x0) / length, y: (y1 - y0) / length, z: 0 }, length };
    };
    // One short slot: full resolution.
    const small = stockGrid(big, bit, [stroke(100, 100, 200, 100)]);
    expect(small.coarsened).toBe(false);
    expect(small.dx).toBeLessThanOrEqual(bit.diameter / CELLS_PER_DIAMETER);
    // Raster lines 5 mm apart over the whole sheet: coarsened, and within budget.
    const raster: Stroke[] = [];
    for (let y = 10; y < 1210; y += 5) raster.push(stroke(10, y, 2430, y));
    const grid = stockGrid(big, bit, raster);
    expect(grid.coarsened).toBe(true);
    expect(touchedTiles(raster, bit.diameter / 2, grid) * TILE * TILE).toBeLessThanOrEqual(MAX_POINTS);
    // Rapids above the sheet cost nothing.
    const above = raster.map((st) => ({ ...st, from: { ...st.from, z: 5 } }));
    expect(stockGrid(big, bit, above).coarsened).toBe(false);
  });
});

describe('tiles', () => {
  it('allocates only tiles near the cut, and never fewer than touchedTiles predicts', () => {
    const stock = createStock(sheet, flat);
    const from = p(20, 30, -3);
    const to = p(35, 30, -3);
    cutSegment(stock, from, to, flat);
    const allocated = allocatedTiles(stock);
    expect(allocated).toBeGreaterThan(0);
    expect(allocated).toBeLessThan(stock.tx * stock.ty);
    const length = 15;
    const predicted = touchedTiles([{ from, u: { x: 1, y: 0, z: 0 }, length }], flat.diameter / 2, stock);
    expect(allocated).toBeLessThanOrEqual(predicted);
  });

  it('allocates the tile before a cut on a tile boundary, so no flat top covers the cut edge', () => {
    const stock = createStock(sheet, flat);
    // A plunge whose reach ends exactly on grid column TILE: only that column and beyond is cut.
    const x = TILE * stock.dx + (flat.diameter / 2) * (1 - 1e-9);
    cutSegment(stock, p(x, 30, 1), p(x, 30, -2), flat);
    const j = Math.round(30 / stock.dy);
    expect(heightAt(stock, TILE, j)).toBeLessThan(0);
    expect(heightAt(stock, TILE - 1, j)).toBe(0);
    const t = (j >> 6) * stock.tx;
    expect(stock.tiles[t + 1]).not.toBeNull();
    expect(stock.tiles[t]).not.toBeNull();
  });

  it('lists exactly the tiles a cut changed, plus those sharing a cut edge, once', () => {
    const stock = createStock(sheet, flat);
    cutSegment(stock, p(20, 30, -3), p(25, 30, -3), flat);
    const first = takeDirtyTiles(stock);
    expect(new Set(first).size).toBe(first.length);
    // Every listed tile is allocated, and every allocated tile is listed.
    const allocated = stock.tiles.flatMap((t, k) => (t ? [k] : []));
    expect([...first].sort((a, b) => a - b)).toEqual(allocated);
    expect(takeDirtyTiles(stock)).toEqual([]);
    // Re-cutting the same groove changes nothing.
    cutSegment(stock, p(20, 30, -3), p(25, 30, -3), flat);
    expect(takeDirtyTiles(stock)).toEqual([]);
    // A cut on column TILE also dirties the tile before it.
    const x = TILE * stock.dx + (flat.diameter / 2) * (1 - 1e-9);
    // y = 15 is exactly a grid row, so the boundary column is within reach there.
    cutSegment(stock, p(x, 15, 1), p(x, 15, -2), flat);
    const t = (Math.round(15 / stock.dy) >> 6) * stock.tx;
    expect(takeDirtyTiles(stock).sort((a, b) => a - b)).toEqual([t, t + 1]);
  });

  it('counts the material removed, once', () => {
    const stock = createStock(sheet, flat);
    cutSegment(stock, p(20, 30, -3), p(80, 30, -3), flat);
    const volume = stock.removed * stock.dx * stock.dy;
    const slot = 60 * 6 * 3 + Math.PI * 9 * 3;
    // Each grid point stands for a whole cell, so cells along the slot edge count in full.
    expect(Math.abs(volume - slot) / slot).toBeLessThan(0.05);
    // Cutting the same slot again removes nothing more.
    cutSegment(stock, p(20, 30, -3), p(80, 30, -3), flat);
    expect(stock.removed * stock.dx * stock.dy).toBe(volume);
  });

  it('shares tiles with a snapshot and copies them before writing', () => {
    const stock = createStock(sheet, flat);
    cutSegment(stock, p(20, 30, -3), p(40, 30, -3), flat);
    const before = denseHeights(stock);
    const snapshot = snapshotTiles(stock);
    cutSegment(stock, p(30, 10, -5), p(30, 50, -5), flat);
    expect(denseHeights(stock)).not.toEqual(before);
    // The snapshot still holds the earlier state.
    restoreTiles(stock, snapshot);
    expect(denseHeights(stock)).toEqual(before);
    restoreTiles(stock, null);
    expect(allocatedTiles(stock)).toBe(0);
  });
});

describe('cutSegment', () => {
  const a = p(20, 30, -3);
  const b = p(80, 30, -3);

  it("cuts a flat slot one diameter wide (to the grid) and leaves the rest untouched", () => {
    const stock = createStock(sheet, flat);
    const rect = cutSegment(stock, a, b, flat);
    expect(rect).not.toBeNull();
    expectHeights(stock, levelCut(stock, flat, a, b));
    // Width across the middle of the slot, to within one grid step.
    const i = Math.round(50 / stock.dx);
    let cut = 0;
    for (let j = 0; j < stock.ny; j++) if (heightAt(stock, i, j) < 0) cut++;
    // Grid points fall anywhere across the slot, so each edge can be off by up to one step.
    expect(flat.diameter - (cut - 1) * stock.dy).toBeGreaterThanOrEqual(-1e-9);
    expect(flat.diameter - (cut - 1) * stock.dy).toBeLessThan(2 * stock.dy);
    expect(heightAt(stock, i, Math.round(30 / stock.dy))).toBe(-3);
  });

  it('cuts a ball slot with a circular cross-section', () => {
    const stock = createStock(sheet, ball);
    cutSegment(stock, a, b, ball);
    expectHeights(stock, levelCut(stock, ball, a, b));
    // At 2 mm off center: −3 + 3 − √(9 − 4).
    const i = Math.round(50 / stock.dx);
    const j = Math.round(32 / stock.dy);
    const d = Math.abs(j * stock.dy - 30);
    expect(heightAt(stock, i, j)).toBeCloseTo(-Math.sqrt(9 - d * d), 5);
  });

  it('cuts a V slot 2·depth·tan(half-angle) wide at the surface', () => {
    const stock = createStock(sheet, vbit);
    cutSegment(stock, a, b, vbit);
    expectHeights(stock, levelCut(stock, vbit, a, b));
    const i = Math.round(50 / stock.dx);
    let cut = 0;
    for (let j = 0; j < stock.ny; j++) if (heightAt(stock, i, j) < -1e-9) cut++;
    const width = 2 * 3 * Math.tan(Math.PI / 4);
    expect(width - (cut - 1) * stock.dy).toBeGreaterThanOrEqual(-1e-9);
    expect(width - (cut - 1) * stock.dy).toBeLessThan(2 * stock.dy);
  });

  it('makes a round hole for a plunge', () => {
    const stock = createStock(sheet, flat);
    cutSegment(stock, p(50, 30, 2), p(50, 30, -4), flat);
    const bottom = p(50, 30, -4);
    expectHeights(stock, levelCut(stock, flat, bottom, bottom));
  });

  it('changes nothing for a move that stays at or above the sheet top', () => {
    const stock = createStock(sheet, flat);
    expect(cutSegment(stock, p(10, 10, 5), p(90, 50, 5), flat)).toBeNull();
    expect(cutSegment(stock, p(10, 10, 0), p(90, 50, 0), flat)).toBeNull();
    expect(cutSegment(stock, p(10, 10, 5), p(10, 10, 0), flat)).toBeNull();
    expect(allocatedTiles(stock) === 0).toBe(true);
  });

  it('clips cuts past the sheet edge and clamps them at the sheet bottom', () => {
    const stock = createStock(sheet, flat);
    const from = p(-20, 0, -15);
    const to = p(120, 0, -15);
    cutSegment(stock, from, to, flat);
    expectHeights(stock, levelCut(stock, flat, from, to));
    expect(heightAt(stock, 0, 0)).toBe(-10);
    expect(heightAt(stock, stock.nx - 1, 0)).toBe(-10);
    expect(cutSegment(stock, p(-50, 30, -3), p(-10, 30, -3), flat)).toBeNull();
  });

  it.each([
    ['flat', flat],
    ['ball', ball],
    ['V', vbit],
  ] as const)('cuts a sloped move exactly with a %s bit', (_, bit) => {
    // Brute force: the bit stamped at many points along the move.
    const from = p(20, 20, 1);
    const to = p(70, 45, -5);
    const stock = createStock(sheet, bit);
    cutSegment(stock, from, to, bit);
    // Stamps 0.03 mm apart can only miss by what the surface changes over
    // half a step, and never cut deeper than the exact sweep.
    const steps = 2000;
    let over = 0;
    let under = 0;
    for (let j = 0; j < stock.ny; j++) {
      for (let i = 0; i < stock.nx; i++) {
        const x = i * stock.dx;
        const y = j * stock.dy;
        if (distToSegment(x, y, from, to) > bit.diameter / 2) continue;
        let z = 0;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const q = p(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t);
          z = Math.min(z, q.z + tipOffset(bit.shape, bit.diameter, Math.hypot(x - q.x, y - q.y)));
        }
        const h = heightAt(stock, i, j);
        const brute = Math.max(stock.floor, z);
        over = Math.max(over, h - brute);
        under = Math.max(under, brute - h);
      }
    }
    expect(over).toBeLessThan(1e-5);
    expect(under).toBeLessThan(0.02);
  });

  it.each([
    ['level', p(20, 30, -3), p(80, 35, -3)],
    ['sloped', p(20, 20, 1), p(70, 45, -5)],
    ['vertical', p(50, 30, 1), p(50, 30, -6)],
  ])('cuts a %s move in two pieces the same as whole', (_, from, to) => {
    for (const bit of [flat, ball, vbit]) {
      for (const split of [0.5, 0.3]) {
        const whole = createStock(sheet, bit);
        cutSegment(whole, from, to, bit);
        const mid = p(from.x + (to.x - from.x) * split, from.y + (to.y - from.y) * split, from.z + (to.z - from.z) * split);
        const pieces = createStock(sheet, bit);
        cutSegment(pieces, from, mid, bit);
        cutSegment(pieces, mid, to, bit);
        expectHeights(pieces, (x, y) => heightAt(whole, Math.round(x / whole.dx), Math.round(y / whole.dy)));
      }
    }
  });
});
