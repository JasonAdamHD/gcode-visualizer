/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import type { Move, Point3 } from '../toolpath/moves';
import type { Timeline } from '../toolpath/timeline';
import { buildTimeline, sampleTimeline } from '../toolpath/timeline';
import { createStock, denseHeights, heightAt } from './stock';
import type { StockSimulatorOptions } from './stockSim';
import { StockSimulator } from './stockSim';

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });

const params: MachineParams = {
  ...DEFAULT_PARAMS,
  units: 'mm',
  sheet: { x: 60, y: 40, thickness: 10 },
  bit: { diameter: 6, shape: { kind: 'ball' }, flute: { kind: 'up' }, fluteCount: 2 },
  feedRate: 1000,
  plungeRate: 300,
  rapidRateXY: 3000,
  rapidRateZ: 1000,
  safeHeight: 5,
  depthPerPass: 3,
  acceleration: 500,
  junctionDeviation: 0.01,
};

/** Rapids, plunges, level and sloped feeds, an arc and a retract. */
const moves: Move[] = [
  { kind: 'rapid', from: p(0, 0, 5), to: p(10, 10, 5) },
  { kind: 'plunge', from: p(10, 10, 5), to: p(10, 10, -3) },
  { kind: 'feed', from: p(10, 10, -3), to: p(40, 10, -3) },
  { kind: 'feed', from: p(40, 10, -3), to: p(40, 30, -3), bulge: 0.6 },
  { kind: 'feed', from: p(40, 30, -3), to: p(15, 25, -7) },
  { kind: 'retract', from: p(15, 25, -7), to: p(15, 25, 5) },
  { kind: 'rapid', from: p(15, 25, 5), to: p(50, 20, 5) },
  { kind: 'plunge', from: p(50, 20, 5), to: p(50, 20, -12) },
  { kind: 'retract', from: p(50, 20, -12), to: p(50, 20, 5) },
];
const timeline = buildTimeline(moves, params);

const simulator = (tl: Timeline = timeline, options?: StockSimulatorOptions) =>
  new StockSimulator(tl, createStock(params.sheet, params.bit), () => params.bit, options);

/** Heights after cutting uncut stock straight to `t`. */
function fromScratch(t: number, tl: Timeline = timeline): Float32Array {
  const sim = simulator(tl);
  expect(sim.advanceTo(sampleTimeline(tl, t)).done).toBe(true);
  return denseHeights(sim.stock);
}

function maxDiff(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
  return worst;
}

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe('StockSimulator', () => {
  it('cuts each move with its own bit', () => {
    // Two parallel slots: the first with a 6 mm bit, the second with a 2 mm one.
    const twoTools: Move[] = [
      { kind: 'plunge', from: p(10, 10, 5), to: p(10, 10, -2) },
      { kind: 'feed', from: p(10, 10, -2), to: p(50, 10, -2) },
      { kind: 'retract', from: p(50, 10, -2), to: p(50, 30, 5) },
      { kind: 'plunge', from: p(50, 30, 5), to: p(50, 30, -2) },
      { kind: 'feed', from: p(50, 30, -2), to: p(10, 30, -2) },
    ];
    const tl = buildTimeline(twoTools, params);
    const small = { ...params.bit, diameter: 2, shape: { kind: 'flat' } as const };
    const big = { ...params.bit, diameter: 6, shape: { kind: 'flat' } as const };
    const sim = new StockSimulator(tl, createStock(params.sheet, small), (m) => (m < 3 ? big : small));
    sim.advanceTo(sampleTimeline(tl, tl.total));
    const width = (y: number) => {
      let n = 0;
      for (let j = 0; j < sim.stock.ny; j++) {
        const yy = j * sim.stock.dy;
        if (Math.abs(yy - y) < 5 && heightAt(sim.stock, Math.round(30 / sim.stock.dx), j) < 0) n++;
      }
      return (n - 1) * sim.stock.dy;
    };
    expect(width(10)).toBeGreaterThan(5.5);
    expect(width(10)).toBeLessThanOrEqual(6);
    expect(width(30)).toBeGreaterThan(1.5);
    expect(width(30)).toBeLessThanOrEqual(2);
  });

  it('cuts nothing at the start and something by the end', () => {
    expect(fromScratch(0).every((h) => h === 0)).toBe(true);
    const end = fromScratch(timeline.total);
    expect(end.reduce((a, b) => Math.min(a, b), 0)).toBe(-10);
  });

  it('gives the same stock after any sequence of seeks as cutting from scratch', () => {
    const next = random(42);
    // Frequent, few checkpoints so restores and evictions both happen.
    const sim = simulator(timeline, { checkpointWork: 200, maxCheckpoints: 3 });
    let t = 0;
    for (let k = 0; k < 60; k++) {
      // Mostly small steps forward, as in playback, with jumps both ways.
      const r = next();
      if (r < 0.5) t = Math.min(timeline.total, t + next() * timeline.total * 0.05);
      else t = next() * timeline.total;
      expect(sim.advanceTo(sampleTimeline(timeline, t)).done).toBe(true);
      expect(maxDiff(denseHeights(sim.stock), fromScratch(t))).toBeLessThan(1e-5);
    }
  });

  it('cuts a block in pieces over many frames the same as in one go', () => {
    const sim = simulator();
    for (let k = 0; k <= 400; k++) sim.advanceTo(sampleTimeline(timeline, (timeline.total * k) / 400));
    expect(maxDiff(denseHeights(sim.stock), fromScratch(timeline.total))).toBeLessThan(1e-5);
  });

  it('spreads a small budget over several calls and ends equal to one unbounded call', () => {
    const sim = simulator();
    const end = sampleTimeline(timeline, timeline.total);
    let calls = 0;
    let last = -1;
    for (;;) {
      const result = sim.advanceTo(end, 500);
      calls++;
      expect(result.progress).toBeGreaterThanOrEqual(last);
      expect(result.progress).toBeLessThanOrEqual(1);
      last = result.progress;
      if (result.done) break;
    }
    expect(calls).toBeGreaterThan(3);
    expect(last).toBe(1);
    expect(denseHeights(sim.stock)).toEqual(fromScratch(timeline.total));
  });

  it('reports the grid points it changed, and the whole grid after a restore', () => {
    const sim = simulator();
    const first = sim.advanceTo(sampleTimeline(timeline, timeline.total));
    expect(first.dirty).not.toBeNull();
    const back = sim.advanceTo(sampleTimeline(timeline, 0));
    expect(back.dirty).toEqual({ i0: 0, j0: 0, i1: sim.stock.nx - 1, j1: sim.stock.ny - 1 });
    expect(denseHeights(sim.stock).every((h) => h === 0)).toBe(true);
  });

  it('handles an empty timeline', () => {
    const empty = buildTimeline([], params);
    const sim = simulator(empty);
    expect(sim.advanceTo(sampleTimeline(empty, 0))).toEqual({ done: true, dirty: null, progress: 1 });
  });

  it('completes a 10⁵-block program', () => {
    // A zig-zag of short level cuts across the sheet.
    const big: Move[] = [{ kind: 'plunge', from: p(5, 5, 5), to: p(5, 5, -1) }];
    for (let k = 0; k < 100_000; k++) {
      const from = big[big.length - 1].to;
      const x = 5 + (k % 100) * 0.5;
      const y = 5 + Math.floor(k / 100) * 0.03;
      big.push({ kind: 'feed', from, to: p(k % 200 < 100 ? x : 55 - (x - 5), y, -1) });
    }
    const tl = buildTimeline(big, params);
    expect(tl.blocks.length).toBeGreaterThan(99_000);
    const sim = simulator(tl);
    let calls = 0;
    while (!sim.advanceTo(sampleTimeline(tl, tl.total), 2_000_000).done) calls++;
    expect(calls).toBeGreaterThan(0);
    expect(denseHeights(sim.stock).reduce((a, b) => Math.min(a, b), 0)).toBeCloseTo(-1, 5);
  }, 60_000);
});
