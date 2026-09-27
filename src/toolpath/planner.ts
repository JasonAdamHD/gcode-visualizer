/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// A time estimate that mirrors GRBL's planner (planner.c): moves become
// straight 3D blocks, corners get a junction speed from the junction
// deviation, and backward/forward passes limit every block to what the
// acceleration allows, giving trapezoidal velocity profiles. Internally
// everything is in world units and seconds.
import { arcFromBulge } from '../geometry/segment';
import type { MachineParams } from '../machine/params';
import { unitFactor } from '../machine/params';
import type { Move, Point3 } from './moves';

/** GRBL's default arc tolerance (max chord-to-arc distance), in millimeters. */
export const ARC_TOLERANCE_MM = 0.002;

/** A straight piece of a move, as the planner sees it. Speeds are units/second. */
export type Block = {
  /** Index of the move this block belongs to. */
  move: number;
  /** Start point of the block. */
  from: Point3;
  length: number;
  /** Unit direction vector. */
  u: Point3;
  /** Nominal (programmed) speed. */
  vNom: number;
};

export type PlanResult = {
  /** Seconds per move, parallel to the input moves (for playback). */
  moveTimes: number[];
  /** Seconds per move if every block ran at its nominal speed throughout. */
  nominalTimes: number[];
  /** Total planned seconds. */
  total: number;
};

const EPS = 1e-12;

/**
 * Number of chords for an arc of `radius` sweeping `theta` radians so that
 * no chord strays more than `tolerance` from the arc (GRBL mc_arc):
 * `ceil(|θ| / (2·acos(1 − tol/r)))`, at least 1.
 */
export function arcChordCount(radius: number, theta: number, tolerance: number): number {
  if (tolerance >= radius) return 1;
  const perChord = 2 * Math.acos(1 - tolerance / radius);
  return Math.max(1, Math.ceil(Math.abs(theta) / perChord));
}

/**
 * Nominal speed (units/s) for `move` in direction `u`. Feeds and plunges
 * run at the move's own `feedRate` (an imported F word) when it has one,
 * else at `params.feedRate` / `params.plungeRate`. Rapids are limited per
 * axis, so the fastest speed keeps XY within `rapidRateXY` and Z within
 * `rapidRateZ`.
 */
function nominalSpeed(move: Move, u: Point3, params: MachineParams): number {
  if (move.kind === 'feed') return (move.feedRate ?? params.feedRate) / 60;
  if (move.kind === 'plunge') return (move.feedRate ?? params.plungeRate) / 60;
  const xy = Math.hypot(u.x, u.y);
  const z = Math.abs(u.z);
  return Math.min(
    xy > EPS ? params.rapidRateXY / 60 / xy : Infinity,
    z > EPS ? params.rapidRateZ / 60 / z : Infinity
  );
}

/** Points along a move: its end for a straight move, chord ends for an arc (excluding the start). */
function movePoints(move: Move, tolerance: number): Point3[] {
  const arc = move.bulge ? arcFromBulge(move.from, move.to, move.bulge) : null;
  if (!arc) return [move.to];
  const n = arcChordCount(arc.radius, arc.theta, tolerance);
  const a0 = Math.atan2(move.from.y - arc.center.y, move.from.x - arc.center.x);
  const points: Point3[] = [];
  for (let k = 1; k < n; k++) {
    const a = a0 + (arc.theta * k) / n;
    const t = k / n;
    points.push({
      x: arc.center.x + arc.radius * Math.cos(a),
      y: arc.center.y + arc.radius * Math.sin(a),
      z: move.from.z + (move.to.z - move.from.z) * t,
    });
  }
  points.push(move.to);
  return points;
}

/** Splits moves into straight blocks, arcs into chords within the GRBL arc tolerance. Zero-length pieces are dropped. */
export function linearize(moves: Move[], params: MachineParams): Block[] {
  const tolerance = ARC_TOLERANCE_MM * unitFactor('mm', params.units);
  const blocks: Block[] = [];
  moves.forEach((move, index) => {
    let from = move.from;
    for (const to of movePoints(move, tolerance)) {
      const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
      const length = Math.hypot(d.x, d.y, d.z);
      if (length > EPS) {
        const u = { x: d.x / length, y: d.y / length, z: d.z / length };
        blocks.push({ move: index, from, length, u, vNom: nominalSpeed(move, u, params) });
      }
      from = to;
    }
  });
  return blocks;
}

/**
 * Maximum speed (units/s) through the junction from direction `ua` to `ub`,
 * as in GRBL: with `cosθ = −(ua·ub)`, a reversal gives 0, a straight line
 * is unlimited, otherwise `s = sqrt((1 − cosθ)/2)` and
 * `v² = accel · deviation · s / (1 − s)`. The caller caps it by the blocks'
 * nominal speeds.
 */
export function junctionSpeed(ua: Point3, ub: Point3, acceleration: number, deviation: number): number {
  const cos = -(ua.x * ub.x + ua.y * ub.y + ua.z * ub.z);
  if (cos > 0.999999) return 0;
  if (cos < -0.999999) return Infinity;
  const s = Math.sqrt(0.5 * (1 - cos));
  return Math.sqrt((acceleration * deviation * s) / (1 - s));
}

/**
 * Time (s) to cover `length` starting at `v0` and ending at `v1` with
 * cruise speed `vmax` and acceleration `a`: a trapezoid when there is room
 * to reach `vmax`, otherwise a triangle peaking below it. Assumes the speeds
 * are reachable (the planner guarantees it).
 */
export function blockTime(length: number, v0: number, v1: number, vmax: number, a: number): number {
  const dAcc = (vmax * vmax - v0 * v0) / (2 * a);
  const dDec = (vmax * vmax - v1 * v1) / (2 * a);
  if (dAcc + dDec <= length) {
    return (vmax - v0) / a + (vmax - v1) / a + (length - dAcc - dDec) / vmax;
  }
  const vp = Math.sqrt((2 * a * length + v0 * v0 + v1 * v1) / 2);
  return (vp - v0) / a + (vp - v1) / a;
}

/** A block after planning: its entry and exit speeds (units/s) and its time (s). */
export type PlannedBlock = Block & {
  vEntry: number;
  vExit: number;
  time: number;
};

/**
 * Plans `moves` the way GRBL does and returns every straight block with the
 * speeds it enters and leaves at and the time it takes. The machine starts
 * and ends at rest; between blocks the speed is capped by the junction speed
 * and both blocks' nominal speeds, then a backward pass
 * (`v_entry² ≤ v_exit² + 2aL`) and a forward pass
 * (`v_exit² ≤ v_entry² + 2aL`) keep every change within the acceleration.
 */
export function planBlocks(moves: Move[], params: MachineParams): PlannedBlock[] {
  const a = params.acceleration;
  const blocks = linearize(moves, params);
  const n = blocks.length;

  // entry[i] is the speed entering block i; entry[n] is the final stop.
  const entry = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i++) {
    const prev = blocks[i - 1];
    const cur = blocks[i];
    const vj = junctionSpeed(prev.u, cur.u, a, params.junctionDeviation);
    entry[i] = Math.min(vj, prev.vNom, cur.vNom);
  }
  for (let i = n - 1; i >= 0; i--) {
    entry[i] = Math.min(entry[i], Math.sqrt(entry[i + 1] ** 2 + 2 * a * blocks[i].length));
  }
  entry[0] = 0;
  for (let i = 0; i < n; i++) {
    entry[i + 1] = Math.min(entry[i + 1], Math.sqrt(entry[i] ** 2 + 2 * a * blocks[i].length));
  }

  return blocks.map((b, i) => ({
    ...b,
    vEntry: entry[i],
    vExit: entry[i + 1],
    time: blockTime(b.length, entry[i], entry[i + 1], b.vNom, a),
  }));
}

/** Plans `moves` with `planBlocks` and returns the time of each move and the total. */
export function planTime(moves: Move[], params: MachineParams): PlanResult {
  const moveTimes = new Array<number>(moves.length).fill(0);
  const nominalTimes = new Array<number>(moves.length).fill(0);
  let total = 0;
  for (const b of planBlocks(moves, params)) {
    moveTimes[b.move] += b.time;
    nominalTimes[b.move] += b.length / b.vNom;
    total += b.time;
  }
  return { moveTimes, nominalTimes, total };
}
