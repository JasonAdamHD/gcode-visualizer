/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Keeps a Stock in step with the playback clock. Cutting is a `min`, so
// the stock at any time is the same however it was reached: forward play
// cuts only the new piece of path, and a seek backwards restores a saved
// copy (checkpoint) from before the target and cuts forward from there.
import type { Point3 } from '../toolpath/moves';
import type { Timeline } from '../toolpath/timeline';
import type { Bit, DirtyRect, Stock } from './stock';
import { cutSegment, restoreTiles, snapshotTiles, unionRect } from './stock';

/**
 * Most checkpoints kept at once. A checkpoint shares the stock's tiles
 * (copy on write), so it costs a tile table plus the tiles cut after it.
 */
export const MAX_CHECKPOINTS = 16;

/** Default work (grid points visited) between checkpoints. */
const CHECKPOINT_WORK = 1 << 22;

/** Where playback is: a timeline block and the tool tip, as in `TimelineSample`. */
export type CutTarget = { block: number; position: Point3 };

export type AdvanceResult = {
  /** True when the stock has caught up with the target. */
  done: boolean;
  /** Grid points changed by this call (the whole grid after a checkpoint restore). */
  dirty: DirtyRect | null;
  /** How far the cut has got towards the target, 0 to 1. */
  progress: number;
};

export type StockSimulatorOptions = {
  /** Work units (grid points visited) between checkpoints. */
  checkpointWork?: number;
  maxCheckpoints?: number;
};

type Checkpoint = { block: number; tiles: (Float32Array | null)[] };

/**
 * Cuts `stock` along `timeline` up to wherever playback is. The cut state
 * is `(block, distance)`: every block before `block` is cut, and `block`
 * itself from its start to `distance` (world units along it). Checkpoints
 * are taken at block boundaries while cutting forward; when there are too
 * many, every other one is dropped and the spacing doubles.
 */
export class StockSimulator {
  readonly stock: Stock;
  private readonly timeline: Timeline;
  private readonly bitOf: (move: number) => Bit;
  private readonly maxCheckpoints: number;
  private checkpointWork: number;
  private checkpoints: Checkpoint[] = [];
  private workSinceCheckpoint = 0;
  private block = 0;
  private distance = 0;

  /** `bitOf(m)` is the bit that cuts move `m` (a program can change tools). */
  constructor(timeline: Timeline, stock: Stock, bitOf: (move: number) => Bit, options: StockSimulatorOptions = {}) {
    this.timeline = timeline;
    this.stock = stock;
    this.bitOf = bitOf;
    this.checkpointWork = options.checkpointWork ?? CHECKPOINT_WORK;
    this.maxCheckpoints = Math.max(1, options.maxCheckpoints ?? MAX_CHECKPOINTS);
  }

  /**
   * Cuts until the stock matches `target`, doing roughly at most `budget`
   * work units (grid points visited; a block is never split for the
   * budget, so one long block can overrun it). Call again with the same
   * or a newer target until `done`.
   */
  advanceTo(target: CutTarget, budget = Infinity): AdvanceResult {
    const blocks = this.timeline.blocks;
    const [tb, ts] = this.resolve(target);
    let dirty: DirtyRect | null = null;

    // Behind the current cut: go back to a checkpoint. Ahead: skip to the
    // latest checkpoint before the target if it is further on than the cut.
    const behind = tb < this.block || (tb === this.block && ts < this.distance);
    const cp = this.checkpointAtOrBefore(tb);
    if (behind || (cp && cp.block > this.block)) {
      this.restore(cp);
      dirty = { i0: 0, j0: 0, i1: this.stock.nx - 1, j1: this.stock.ny - 1 };
    }

    let work = 0;
    while (this.block < tb || (this.block === tb && this.distance < ts)) {
      if (work >= budget) return { done: false, dirty, progress: tb > 0 ? this.block / tb : 0 };
      const b = blocks[this.block];
      const end = this.block < tb ? b.length : ts;
      const rect = cutSegment(this.stock, pointAt(b, this.distance), pointAt(b, end), this.bitOf(b.move));
      const cost = 1 + (rect ? (rect.i1 - rect.i0 + 1) * (rect.j1 - rect.j0 + 1) : 0);
      work += cost;
      dirty = unionRect(dirty, rect);
      if (this.block < tb) {
        this.block++;
        this.distance = 0;
        this.workSinceCheckpoint += cost;
        this.maybeCheckpoint();
      } else {
        this.distance = end;
      }
    }
    return { done: true, dirty, progress: 1 };
  }

  /** Block index and distance along it for `target`; the end of a block is the start of the next. */
  private resolve(target: CutTarget): [number, number] {
    const blocks = this.timeline.blocks;
    if (target.block < 0 || blocks.length === 0) return [0, 0];
    const index = Math.min(target.block, blocks.length - 1);
    const { from, u, length } = blocks[index];
    const p = target.position;
    const along = (p.x - from.x) * u.x + (p.y - from.y) * u.y + (p.z - from.z) * u.z;
    const distance = Math.min(length, Math.max(0, along));
    if (distance >= length && index + 1 < blocks.length) return [index + 1, 0];
    return [index, distance];
  }

  private checkpointAtOrBefore(block: number): Checkpoint | null {
    let found: Checkpoint | null = null;
    for (const cp of this.checkpoints) {
      if (cp.block > block) break;
      found = cp;
    }
    return found;
  }

  /** Back to a checkpoint, or to uncut stock with none. */
  private restore(cp: Checkpoint | null) {
    restoreTiles(this.stock, cp ? cp.tiles : null);
    this.block = cp ? cp.block : 0;
    this.distance = 0;
    this.workSinceCheckpoint = 0;
  }

  private maybeCheckpoint() {
    if (this.workSinceCheckpoint < this.checkpointWork) return;
    const last = this.checkpoints[this.checkpoints.length - 1];
    if (last && last.block >= this.block) return;
    this.checkpoints.push({ block: this.block, tiles: snapshotTiles(this.stock) });
    this.workSinceCheckpoint = 0;
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints = this.checkpoints.filter((_, k) => k % 2 === 1);
      this.checkpointWork *= 2;
    }
  }
}

function pointAt(b: { from: Point3; u: Point3 }, distance: number): Point3 {
  return { x: b.from.x + b.u.x * distance, y: b.from.y + b.u.y * distance, z: b.from.z + b.u.z * distance };
}
