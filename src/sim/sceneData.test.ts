/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../machine/params';
import type { Move, Point3 } from '../toolpath/moves';
import { buildTimeline } from '../toolpath/timeline';
import { bitProfile, moveLineBuffers, pathBuffer } from './sceneData';

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });

describe('moveLineBuffers', () => {
  const moves: Move[] = [
    { kind: 'rapid', from: p(0, 0, 1), to: p(2, 0, 1) },
    { kind: 'rapid', from: p(2, 0, 1), to: p(2, 0, 0.02) },
    { kind: 'plunge', from: p(2, 0, 0.02), to: p(2, 0, -0.5) },
    // Semicircle of radius 1 around (1, 0), CCW.
    { kind: 'feed', from: p(2, 0, -0.5), to: p(0, 0, -0.5), bulge: 1 },
    { kind: 'feed', from: p(0, 0, -0.5), to: p(0, 0, -0.5) },
    { kind: 'retract', from: p(0, 0, -0.5), to: p(0, 0, 1) },
  ];
  const buffers = moveLineBuffers(moves, DEFAULT_PARAMS);
  const pairs = (buf: Float32Array) => {
    const out: [Point3, Point3][] = [];
    for (let i = 0; i < buf.length; i += 6) {
      out.push([p(buf[i], buf[i + 1], buf[i + 2]), p(buf[i + 3], buf[i + 4], buf[i + 5])]);
    }
    return out;
  };

  it('groups straight moves by kind, in order, and skips zero-length moves', () => {
    expect(pairs(buffers.rapid)).toEqual([
      [p(0, 0, 1), p(2, 0, 1)],
      [p(2, 0, 1), p(2, 0, Math.fround(0.02))],
    ]);
    expect(pairs(buffers.plunge)).toEqual([[p(2, 0, Math.fround(0.02)), p(2, 0, -0.5)]]);
    expect(pairs(buffers.retract)).toEqual([[p(0, 0, -0.5), p(0, 0, 1)]]);
  });

  it('chords arcs with every chord end on the arc, chained end to start', () => {
    const chords = pairs(buffers.feed);
    expect(chords.length).toBeGreaterThan(10);
    expect(chords[0][0]).toEqual(p(2, 0, -0.5));
    expect(chords[chords.length - 1][1].x).toBeCloseTo(0, 6);
    chords.forEach(([a, b], i) => {
      expect(Math.hypot(b.x - 1, b.y)).toBeCloseTo(1, 6);
      expect(b.y).toBeGreaterThanOrEqual(-1e-6); // CCW from (2,0) to (0,0) goes through y > 0.
      expect(a.z).toBe(-0.5);
      if (i > 0) {
        expect(a.x).toBeCloseTo(chords[i - 1][1].x, 6);
        expect(a.y).toBeCloseTo(chords[i - 1][1].y, 6);
      }
    });
  });

  it('is empty for no moves', () => {
    const empty = moveLineBuffers([], DEFAULT_PARAMS);
    for (const buf of Object.values(empty)) expect(buf).toHaveLength(0);
  });
});

describe('pathBuffer', () => {
  const moves: Move[] = [
    { kind: 'rapid', from: p(0, 0, 1), to: p(2, 0, 1) },
    { kind: 'plunge', from: p(2, 0, 1), to: p(2, 0, -0.5) },
    { kind: 'feed', from: p(2, 0, -0.5), to: p(0, 0, -0.5), bulge: 1 },
    { kind: 'retract', from: p(0, 0, -0.5), to: p(0, 0, 1) },
  ];

  it('has one piece per timeline block, starting at each block start', () => {
    const buf = pathBuffer(moves, DEFAULT_PARAMS);
    const { blocks } = buildTimeline(moves, DEFAULT_PARAMS);
    expect(buf).toHaveLength(blocks.length * 6);
    blocks.forEach((b, i) => {
      expect(buf[i * 6]).toBeCloseTo(b.from.x, 6);
      expect(buf[i * 6 + 1]).toBeCloseTo(b.from.y, 6);
      expect(buf[i * 6 + 2]).toBeCloseTo(b.from.z, 6);
    });
  });

  it('holds the same pieces as the per-kind buffers combined', () => {
    const total = Object.values(moveLineBuffers(moves, DEFAULT_PARAMS)).reduce((sum, b) => sum + b.length, 0);
    expect(pathBuffer(moves, DEFAULT_PARAMS)).toHaveLength(total);
  });
});

describe('bitProfile', () => {
  const maxRadius = (pts: { x: number }[]) => Math.max(...pts.map((q) => q.x));

  it.each([
    ['flat', { kind: 'flat' } as const],
    ['ball', { kind: 'ball' } as const],
    ['vbit', { kind: 'vbit', includedAngleDeg: 90 } as const],
  ])('starts at the tip on the axis, is d/2 wide, and closes at the top for %s', (_, shape) => {
    const profile = bitProfile(shape, 0.5, 2);
    expect(profile[0]).toEqual({ x: 0, y: 0 });
    expect(maxRadius(profile)).toBeCloseTo(0.25, 12);
    expect(profile[profile.length - 2]).toEqual({ x: 0.25, y: 2 });
    expect(profile[profile.length - 1]).toEqual({ x: 0, y: 2 });
  });

  it('gives a flat bit a square tip', () => {
    expect(bitProfile({ kind: 'flat' }, 0.5, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 0.25, y: 0 },
      { x: 0.25, y: 2 },
      { x: 0, y: 2 },
    ]);
  });

  it('puts the ball tip on a sphere of radius d/2 centered d/2 above the tip', () => {
    const profile = bitProfile({ kind: 'ball' }, 0.5, 2);
    const tip = profile.slice(0, -2);
    for (const q of tip) expect(Math.hypot(q.x, q.y - 0.25)).toBeCloseTo(0.25, 12);
    expect(tip[tip.length - 1].x).toBeCloseTo(0.25, 12);
    expect(tip[tip.length - 1].y).toBeCloseTo(0.25, 12);
  });

  it('makes the V-bit cone (d/2) / tan(angle/2) tall', () => {
    expect(bitProfile({ kind: 'vbit', includedAngleDeg: 90 }, 0.5, 2)[1].y).toBeCloseTo(0.25, 12);
    expect(bitProfile({ kind: 'vbit', includedAngleDeg: 60 }, 0.5, 2)[1].y).toBeCloseTo(0.25 * Math.sqrt(3), 12);
  });

  it('raises the length so a long tip still fits', () => {
    const profile = bitProfile({ kind: 'vbit', includedAngleDeg: 30 }, 1, 0.1);
    const cone = 0.5 / Math.tan((15 * Math.PI) / 180);
    expect(profile[1].y).toBeCloseTo(cone, 12);
    expect(profile[profile.length - 1].y).toBeCloseTo(cone, 12);
  });
});
