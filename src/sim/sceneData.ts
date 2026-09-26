/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Pure geometry for the 3D view: flat vertex buffers and outlines that the
// Three.js component turns into meshes and lines. Everything is in world
// units and machine coordinates (Z = 0 at the sheet top, negative into
// material), so the scene needs no axis swapping.
import type { Point } from '../geometry/segment';
import type { BitShape, MachineParams } from '../machine/params';
import type { Move } from '../toolpath/moves';
import { linearize } from '../toolpath/planner';

export type MoveKind = Move['kind'];

/** Line-segment vertex buffers per move kind: `[x0, y0, z0, x1, y1, z1, …]`, one pair per straight piece. */
export type MoveLineBuffers = Record<MoveKind, Float32Array>;

/**
 * Splits `moves` into straight pieces (arcs chorded with the planner's
 * tolerance, so the lines match what playback follows) and groups them by
 * move kind, in move order. Zero-length moves contribute nothing.
 */
export function moveLineBuffers(moves: Move[], params: MachineParams): MoveLineBuffers {
  const coords: Record<MoveKind, number[]> = { rapid: [], plunge: [], feed: [], retract: [] };
  for (const b of linearize(moves, params)) {
    const { from, u, length } = b;
    coords[moves[b.move].kind].push(
      from.x,
      from.y,
      from.z,
      from.x + u.x * length,
      from.y + u.y * length,
      from.z + u.z * length
    );
  }
  return {
    rapid: new Float32Array(coords.rapid),
    plunge: new Float32Array(coords.plunge),
    feed: new Float32Array(coords.feed),
    retract: new Float32Array(coords.retract),
  };
}

/**
 * All straight pieces of `moves` in playback order as one line-segment
 * buffer, `[x0, y0, z0, x1, y1, z1, …]`. Piece `i` is timeline block `i`
 * (both come from `linearize`), so drawing the first `i` pieces shows the
 * path traversed before block `i`.
 */
export function pathBuffer(moves: Move[], params: MachineParams): Float32Array {
  const blocks = linearize(moves, params);
  const out = new Float32Array(blocks.length * 6);
  blocks.forEach(({ from, u, length }, i) => {
    out.set([from.x, from.y, from.z, from.x + u.x * length, from.y + u.y * length, from.z + u.z * length], i * 6);
  });
  return out;
}

/** Quarter-circle steps used to outline a ball-nose tip. */
const BALL_STEPS = 12;

/**
 * Side outline of a bit for a lathe (surface of revolution): points as
 * `{ x: radius, y: height }`, from the tip on the axis at (0, 0) out and up
 * to the top of the shank at `length`, then back to the axis. Flat is a
 * cylinder; ball is a hemisphere of radius `diameter / 2` then a cylinder;
 * a V-bit is a cone with half-angle `includedAngleDeg / 2` then a cylinder.
 * `length` is raised if needed so the tip shape always fits.
 */
export function bitProfile(shape: BitShape, diameter: number, length: number): Point[] {
  const r = diameter / 2;
  const tip: Point[] = [{ x: 0, y: 0 }];
  switch (shape.kind) {
    case 'flat':
      tip.push({ x: r, y: 0 });
      break;
    case 'ball':
      for (let k = 1; k <= BALL_STEPS; k++) {
        const phi = ((Math.PI / 2) * k) / BALL_STEPS;
        tip.push({ x: r * Math.sin(phi), y: r - r * Math.cos(phi) });
      }
      break;
    case 'vbit': {
      const half = (shape.includedAngleDeg / 2) * (Math.PI / 180);
      tip.push({ x: r, y: r / Math.tan(half) });
      break;
    }
  }
  const top = Math.max(length, tip[tip.length - 1].y);
  return [...tip, { x: r, y: top }, { x: 0, y: top }];
}
