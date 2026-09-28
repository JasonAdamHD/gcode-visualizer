/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../machine/params';
import type { Move } from './moves';
import { chipLoad, chipSize, chipsCut, chipsPerSecond, cutConditions, rateChipLoad } from './chipLoad';

const p = (x: number, y: number, z: number) => ({ x, y, z });

describe('chipLoad', () => {
  it('is feed divided by spindle speed times flutes', () => {
    // 200 in/min at 18 000 RPM with 2 flutes: 0.00556 in per tooth.
    expect(chipLoad(200, 18000, 2)).toBeCloseTo(200 / 36000, 12);
    expect(chipLoad(5080, 18000, 2)).toBeCloseTo(0.1411, 4);
  });

  it('is null with the spindle stopped', () => {
    expect(chipLoad(200, 0, 2)).toBeNull();
    expect(chipLoad(200, 18000, 0)).toBeNull();
  });
});

describe('chipsPerSecond', () => {
  it('is one chip per tooth pass', () => {
    expect(chipsPerSecond(18000, 2)).toBe(600);
    expect(chipsPerSecond(24000, 3)).toBe(1200);
    expect(chipsPerSecond(0, 2)).toBe(0);
  });
});

describe('rateChipLoad', () => {
  it('rates against a band that scales with the bit diameter', () => {
    // A 1/4" bit: about 0.004–0.012 in per tooth.
    expect(rateChipLoad(0.002, 0.25)).toBe('low');
    expect(rateChipLoad(0.0056, 0.25)).toBe('ok');
    expect(rateChipLoad(0.02, 0.25)).toBe('high');
    // The same 0.02 in is fine for a 1/2" bit.
    expect(rateChipLoad(0.02, 0.5)).toBe('ok');
  });
});

describe('cutConditions', () => {
  const feed: Move = { kind: 'feed', from: p(0, 0, -1), to: p(1, 0, -1) };
  it("uses the program's F and S when a move has them", () => {
    expect(cutConditions({ ...feed, feedRate: 150, spindleRpm: 12000 }, DEFAULT_PARAMS)).toEqual({ feedRate: 150, rpm: 12000 });
  });

  it('falls back to the params: feed rate for feeds, plunge rate for plunges', () => {
    expect(cutConditions(feed, DEFAULT_PARAMS)).toEqual({ feedRate: 200, rpm: 18000 });
    const plunge: Move = { kind: 'plunge', from: p(0, 0, 0), to: p(0, 0, -1) };
    expect(cutConditions(plunge, DEFAULT_PARAMS)).toEqual({ feedRate: 50, rpm: 18000 });
  });

  it('is null for moves that do not cut', () => {
    expect(cutConditions({ ...feed, kind: 'rapid' }, DEFAULT_PARAMS)).toBeNull();
    expect(cutConditions({ ...feed, kind: 'retract' }, DEFAULT_PARAMS)).toBeNull();
  });
});

describe('chipsCut', () => {
  it('makes one chip per tooth pass, as wide as the engaged depth and as thick as the chip load', () => {
    // A 1/4" slot 0.25 deep, 1 in long: 0.0625 in³.
    const load = 200 / 36000;
    const cut = chipsCut(0.0625, 1, load, 0.25);
    expect(cut?.count).toBeCloseTo(180, 9);
    expect(cut?.size.width).toBeCloseTo(0.25, 12);
    expect(cut?.size.thickness).toBe(load);
    expect(cut?.size).toEqual(chipSize(load, 0.25, 0.25));
  });

  it('holds the engaged depth between the chip load and two diameters', () => {
    expect(chipsCut(1e-9, 1, 0.005, 0.25)?.size.width).toBe(0.005);
    expect(chipsCut(10, 1, 0.005, 0.25)?.size.width).toBe(0.5);
  });

  it('makes nothing when nothing was removed, the bit did not move, or the spindle is stopped', () => {
    expect(chipsCut(0, 1, 0.005, 0.25)).toBeNull();
    expect(chipsCut(0.06, 0, 0.005, 0.25)).toBeNull();
    expect(chipsCut(0.06, 1, null, 0.25)).toBeNull();
  });
});
