/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Playback timing for the 3D simulation. The timeline is built from the
// planner's blocks, so playback follows the same trapezoidal profiles (and
// corner slowdowns) as the cut-time estimate and ends at the same total.
import type { MachineParams } from '../machine/params';
import type { Move, Point3 } from './moves';
import type { PlannedBlock } from './planner';
import { planBlocks } from './planner';

/** Distance covered (world units) and current speed (units/s) at some time within a block. */
export type ProfileState = { distance: number; speed: number };

/**
 * State `t` seconds into a block of `length` that enters at `v0`, leaves at
 * `v1`, cruises at `vmax` and accelerates at `a`: the inverse of
 * `blockTime` for the same profile (accelerate, cruise, decelerate; a
 * triangle peaking below `vmax` when there is no room to cruise). `t` is
 * clamped to the block, so before it the state is the start and after it
 * the end.
 */
export function profileAt(length: number, v0: number, v1: number, vmax: number, a: number, t: number): ProfileState {
  const dAcc = (vmax * vmax - v0 * v0) / (2 * a);
  const dDec = (vmax * vmax - v1 * v1) / (2 * a);
  // Peak speed, the time it is reached and left, and the distance covered by then.
  let vp: number;
  let tUp: number;
  let tCruise: number;
  let dUp: number;
  if (dAcc + dDec <= length) {
    vp = vmax;
    tUp = (vmax - v0) / a;
    tCruise = (length - dAcc - dDec) / vmax;
    dUp = dAcc;
  } else {
    vp = Math.sqrt((2 * a * length + v0 * v0 + v1 * v1) / 2);
    tUp = (vp - v0) / a;
    tCruise = 0;
    dUp = (vp * vp - v0 * v0) / (2 * a);
  }
  const tDown = Math.max(0, (vp - v1) / a);
  const clamp = (d: number) => Math.min(length, Math.max(0, d));

  if (t <= 0) return { distance: 0, speed: v0 };
  if (t < tUp) return { distance: clamp(v0 * t + (a * t * t) / 2), speed: v0 + a * t };
  const tc = t - tUp;
  if (tc < tCruise) return { distance: clamp(dUp + vp * tc), speed: vp };
  const td = Math.min(tc - tCruise, tDown);
  if (td >= tDown) return { distance: length, speed: v1 };
  return { distance: clamp(dUp + vp * tCruise + vp * td - (a * td * td) / 2), speed: vp - a * td };
}

/**
 * A planned move list laid out in time. `blockStart[i]` is when block i
 * starts (`blockStart[n] === total`); `moveStart[m]` is when move m starts
 * (a zero-length move gets the start of whatever follows it). Times are
 * seconds.
 */
export type Timeline = {
  moves: Move[];
  blocks: PlannedBlock[];
  blockStart: Float64Array;
  moveStart: Float64Array;
  acceleration: number;
  /** Where the machine is when there is nothing to play: the sheet origin at safe height. */
  home: Point3;
  total: number;
};

/** Plans `moves` and lays their blocks out in time for playback. */
export function buildTimeline(moves: Move[], params: MachineParams): Timeline {
  const blocks = planBlocks(moves, params);
  const n = blocks.length;
  const blockStart = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) blockStart[i + 1] = blockStart[i] + blocks[i].time;
  const total = blockStart[n];

  // Walk backwards so a move without blocks takes the start of the next block.
  const moveStart = new Float64Array(moves.length);
  let next = n;
  for (let m = moves.length - 1; m >= 0; m--) {
    while (next > 0 && blocks[next - 1].move >= m) next--;
    moveStart[m] = blockStart[next];
  }

  return {
    moves,
    blocks,
    blockStart,
    moveStart,
    acceleration: params.acceleration,
    home: { x: 0, y: 0, z: params.safeHeight },
    total,
  };
}

/** The machine state at one instant of playback. */
export type TimelineSample = {
  /** Tool tip position in world units. */
  position: Point3;
  /** Index of the move in progress (the first move before the start, the last after the end); -1 with no moves. */
  moveIndex: number;
  kind: Move['kind'] | null;
  /** Current speed in units/s. */
  speed: number;
};

/**
 * The machine state `t` seconds into `timeline`, clamped to
 * `[0, total]`: at 0 the machine is at rest at the first block's start, at
 * `total` at rest at the last move's end. An empty timeline samples as
 * home, at rest.
 */
export function sampleTimeline(timeline: Timeline, t: number): TimelineSample {
  const { blocks, blockStart, moves, total } = timeline;
  const n = blocks.length;
  if (n === 0) {
    const position = moves.length > 0 ? moves[0].from : timeline.home;
    return { position, moveIndex: moves.length > 0 ? 0 : -1, kind: moves[0]?.kind ?? null, speed: 0 };
  }
  if (t >= total) {
    const last = blocks[n - 1].move;
    return { position: moves[last].to, moveIndex: last, kind: moves[last].kind, speed: 0 };
  }

  // Largest i with blockStart[i] <= t.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (blockStart[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const b = blocks[lo];
  const { distance, speed } = profileAt(b.length, b.vEntry, b.vExit, b.vNom, timeline.acceleration, t - blockStart[lo]);
  return {
    position: { x: b.from.x + b.u.x * distance, y: b.from.y + b.u.y * distance, z: b.from.z + b.u.z * distance },
    moveIndex: b.move,
    kind: moves[b.move].kind,
    speed,
  };
}
