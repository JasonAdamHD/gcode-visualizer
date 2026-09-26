/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Path, Point, Segment } from '../geometry/segment';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS, convertParams } from '../machine/params';
import type { Move } from './moves';
import { PLUNGE_CLEARANCE_IN, buildMoves, moveLength, passDepths } from './moves';

const seg = (start: Point, end: Point, bulge = 0): Segment => ({ type: bulge ? 'arc' : 'line', start, end, bulge });

const square = (x0: number, y0: number, size = 2): Path => {
  const pts = [
    { x: x0, y: y0 },
    { x: x0 + size, y: y0 },
    { x: x0 + size, y: y0 + size },
    { x: x0, y: y0 + size },
  ];
  return pts.map((pt, i) => seg(pt, pts[(i + 1) % 4]));
};

/** 0.75 in sheet, no spoilboard, 0.25 in per pass: 3 passes at -0.25, -0.5, -0.75. */
const params: MachineParams = { ...DEFAULT_PARAMS, spoilboardPenetration: 0, depthPerPass: 0.25 };
const safe = params.safeHeight;
const count = (moves: Move[], kind: Move['kind']) => moves.filter((m) => m.kind === kind).length;

/** Every move starts where the previous one ended. */
const expectContinuous = (moves: Move[]) => {
  for (let i = 1; i < moves.length; i++) expect(moves[i].from).toEqual(moves[i - 1].to);
};

describe('passDepths', () => {
  it('splits an exact multiple into equal passes', () => {
    expect(passDepths(0.75, 0.25)).toEqual([-0.25, -0.5, -0.75]);
  });

  it('uses equal steps for a non-multiple, ending exactly at the final depth', () => {
    const d = passDepths(0.76, 0.25);
    expect(d).toHaveLength(4);
    d.forEach((z, i) => expect(z).toBeCloseTo(-0.19 * (i + 1), 12));
    expect(d[3]).toBe(-0.76);
  });

  it('cuts in one pass when depth per pass covers the whole depth', () => {
    expect(passDepths(0.5, 1)).toEqual([-0.5]);
    expect(passDepths(0.5, 0.5)).toEqual([-0.5]);
  });

  it('is empty for no depth', () => {
    expect(passDepths(0, 0.25)).toEqual([]);
  });
});

describe('buildMoves', () => {
  it('is empty with no loops', () => {
    expect(buildMoves([], [], params)).toEqual([]);
  });

  it('starts and ends at home and is continuous', () => {
    const moves = buildMoves([square(1, 1)], [true], params);
    expect(moves[0].from).toEqual({ x: 0, y: 0, z: safe });
    expect(moves[moves.length - 1].to).toEqual({ x: 0, y: 0, z: safe });
    expectContinuous(moves);
  });

  it('plunges straight to the next pass on a closed loop without retracting', () => {
    const moves = buildMoves([square(1, 1)], [true], params);
    expect(count(moves, 'retract')).toBe(1); // only the final one
    expect(count(moves, 'plunge')).toBe(3);
    expect(count(moves, 'feed')).toBe(12);
    const plunges = moves.filter((m) => m.kind === 'plunge');
    expect(plunges.map((m) => m.to.z)).toEqual([-0.25, -0.5, -0.75]);
    expect(plunges[1].from).toEqual({ x: 1, y: 1, z: -0.25 });
  });

  it('retracts and returns to the start between passes on an open path', () => {
    const open: Path = [seg({ x: 1, y: 1 }, { x: 4, y: 1 }), seg({ x: 4, y: 1 }, { x: 4, y: 3 }, 0.3)];
    const moves = buildMoves([open], [false], params);
    expectContinuous(moves);
    expect(count(moves, 'retract')).toBe(3);
    for (const plunge of moves.filter((m) => m.kind === 'plunge')) expect(plunge.from).toMatchObject({ x: 1, y: 1 });
    // Arcs carry their bulge onto the feed moves.
    expect(moves.filter((m) => m.kind === 'feed' && m.bulge === 0.3)).toHaveLength(3);
  });

  it('starts every plunge after a rapid lower at the clearance above the current surface', () => {
    const open: Path = [seg({ x: 1, y: 1 }, { x: 4, y: 1 })];
    const moves = buildMoves([open], [false], params);
    const surfaces = [0, -0.25, -0.5];
    const plunges = moves.filter((m) => m.kind === 'plunge');
    expect(plunges).toHaveLength(3);
    plunges.forEach((plunge, i) => expect(plunge.from.z).toBeCloseTo(surfaces[i] + PLUNGE_CLEARANCE_IN, 12));
    moves.forEach((m, i) => {
      if (m.kind === 'plunge') expect(moves[i - 1]).toMatchObject({ kind: 'rapid', to: m.from });
    });
  });

  it('converts the plunge clearance to millimeters', () => {
    const mm = convertParams(params, 'mm');
    const first = buildMoves([square(25.4, 25.4, 50.8)], [true], mm).find((m) => m.kind === 'plunge')!;
    expect(first.from.z).toBeCloseTo(PLUNGE_CLEARANCE_IN * 25.4, 9);
  });

  it('cuts loops nearest-first, retracting and rapiding between them', () => {
    const moves = buildMoves([square(20, 20), square(1, 1)], [true, true], params);
    expectContinuous(moves);
    expect(moves.find((m) => m.kind === 'plunge')!.from).toMatchObject({ x: 1, y: 1 });
    expect(count(moves, 'retract')).toBe(2);
    const between = moves.findIndex((m) => m.kind === 'retract');
    expect(moves[between + 1]).toMatchObject({ kind: 'rapid', to: { x: 20, y: 20, z: safe } });
  });

  it('never rapids upward to reach the clearance when the safe height is tiny', () => {
    const low = { ...params, safeHeight: 0.01 };
    for (const m of buildMoves([square(1, 1)], [true], low)) {
      if (m.kind === 'rapid') expect(m.to.z).toBeLessThanOrEqual(m.from.z);
    }
  });
});

describe('moveLength', () => {
  it('follows arcs', () => {
    const m: Move = { kind: 'feed', from: { x: 1, y: 0, z: 0 }, to: { x: -1, y: 0, z: 0 }, bulge: 1 };
    expect(moveLength(m)).toBeCloseTo(Math.PI, 12);
  });
});
