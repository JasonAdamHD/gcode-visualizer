/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { MachineParams } from './params';
import {
  DEFAULT_PARAMS,
  MM_PER_INCH,
  convertParams,
  displayDecimals,
  formatNumber,
  parseParams,
  serializeParams,
  unitFactor,
  validateParams,
} from './params';

const vbit: MachineParams = { ...DEFAULT_PARAMS, bit: { diameter: 0.5, shape: { kind: 'vbit', includedAngleDeg: 60 } } };

/** Serialized DEFAULT_PARAMS with `mutate` applied to a deep copy. */
const withRaw = (mutate: (raw: Record<string, any>) => void): string => {
  const raw = JSON.parse(serializeParams(DEFAULT_PARAMS));
  mutate(raw);
  return JSON.stringify(raw);
};

describe('unitFactor', () => {
  it('converts inches to millimeters and back', () => {
    expect(unitFactor('in', 'mm')).toBe(MM_PER_INCH);
    expect(unitFactor('mm', 'in')).toBeCloseTo(1 / MM_PER_INCH);
    expect(unitFactor('mm', 'mm')).toBe(1);
  });
});

describe('convertParams', () => {
  it('is a no-op when units match', () => {
    expect(convertParams(DEFAULT_PARAMS, 'in')).toBe(DEFAULT_PARAMS);
  });

  it('scales every length, rate and acceleration, preserving the V-bit angle', () => {
    const mm = convertParams(vbit, 'mm');
    expect(mm.units).toBe('mm');
    expect(mm.sheet.x).toBeCloseTo(2438.4);
    expect(mm.sheet.y).toBeCloseTo(1219.2);
    expect(mm.sheet.thickness).toBeCloseTo(19.05);
    expect(mm.bit.diameter).toBeCloseTo(12.7);
    expect(mm.feedRate).toBeCloseTo(5080);
    expect(mm.plungeRate).toBeCloseTo(1270);
    expect(mm.spoilboardPenetration).toBeCloseTo(0.254);
    expect(mm.rapidRateXY).toBeCloseTo(10160);
    expect(mm.rapidRateZ).toBeCloseTo(3810);
    expect(mm.safeHeight).toBeCloseTo(12.7);
    expect(mm.depthPerPass).toBeCloseTo(6.35);
    expect(mm.acceleration).toBeCloseTo(254);
    expect(mm.junctionDeviation).toBeCloseTo(0.0508);
    expect(mm.bit.shape).toEqual({ kind: 'vbit', includedAngleDeg: 60 });
  });

  it('round-trips in → mm → in within 1e-9', () => {
    const back = convertParams(convertParams(vbit, 'mm'), 'in');
    const flat = (p: MachineParams) => [
      p.sheet.x,
      p.sheet.y,
      p.sheet.thickness,
      p.bit.diameter,
      p.feedRate,
      p.plungeRate,
      p.spoilboardPenetration,
      p.rapidRateXY,
      p.rapidRateZ,
      p.safeHeight,
      p.depthPerPass,
      p.acceleration,
      p.junctionDeviation,
    ];
    flat(back).forEach((v, i) => expect(Math.abs(v - flat(vbit)[i])).toBeLessThan(1e-9));
    expect(back.units).toBe('in');
  });
});

describe('formatNumber / displayDecimals', () => {
  it('rounds to the unit precision and trims trailing zeros', () => {
    expect(formatNumber(0.25, displayDecimals('in'))).toBe('0.25');
    expect(formatNumber(1 / 3, displayDecimals('in'))).toBe('0.3333');
    expect(formatNumber(2438.4000000001, displayDecimals('mm'))).toBe('2438.4');
    expect(formatNumber(96, displayDecimals('in'))).toBe('96');
  });
});

describe('validateParams', () => {
  it('accepts the defaults and a valid V-bit', () => {
    expect(validateParams(DEFAULT_PARAMS)).toEqual({});
    expect(validateParams(vbit)).toEqual({});
  });

  it('rejects each non-positive length or rate', () => {
    const p = DEFAULT_PARAMS;
    expect(validateParams({ ...p, sheet: { ...p.sheet, x: 0 } })).toHaveProperty(['sheet.x']);
    expect(validateParams({ ...p, sheet: { ...p.sheet, y: -1 } })).toHaveProperty(['sheet.y']);
    expect(validateParams({ ...p, sheet: { ...p.sheet, thickness: 0 } })).toHaveProperty(['sheet.thickness']);
    expect(validateParams({ ...p, bit: { ...p.bit, diameter: 0 } })).toHaveProperty(['bit.diameter']);
    expect(validateParams({ ...p, feedRate: 0 })).toHaveProperty(['feedRate']);
    expect(validateParams({ ...p, plungeRate: -5 })).toHaveProperty(['plungeRate']);
    expect(validateParams({ ...p, feedRate: NaN })).toHaveProperty(['feedRate']);
    for (const key of ['rapidRateXY', 'rapidRateZ', 'safeHeight', 'depthPerPass', 'acceleration'] as const) {
      expect(validateParams({ ...p, [key]: 0 })).toHaveProperty([key]);
      expect(validateParams({ ...p, [key]: -1 })).toHaveProperty([key]);
    }
  });

  it('allows zero junction deviation but rejects negative', () => {
    expect(validateParams({ ...DEFAULT_PARAMS, junctionDeviation: 0 })).toEqual({});
    expect(validateParams({ ...DEFAULT_PARAMS, junctionDeviation: -0.001 })).toHaveProperty(['junctionDeviation']);
  });

  it('allows zero penetration but rejects negative', () => {
    expect(validateParams({ ...DEFAULT_PARAMS, spoilboardPenetration: 0 })).toEqual({});
    expect(validateParams({ ...DEFAULT_PARAMS, spoilboardPenetration: -0.1 })).toHaveProperty([
      'spoilboardPenetration',
    ]);
  });

  it('requires a V-bit angle strictly between 0 and 180', () => {
    for (const angle of [0, 180, -10, 200]) {
      const p: MachineParams = { ...vbit, bit: { ...vbit.bit, shape: { kind: 'vbit', includedAngleDeg: angle } } };
      expect(validateParams(p)).toHaveProperty(['bit.includedAngleDeg']);
    }
  });
});

describe('serializeParams / parseParams', () => {
  it('round-trips', () => {
    for (const p of [DEFAULT_PARAMS, vbit, convertParams(vbit, 'mm')]) {
      expect(parseParams(serializeParams(p))).toEqual({ ok: true, params: p });
    }
  });

  it('includes the version', () => {
    expect(serializeParams(DEFAULT_PARAMS)).toContain('"version": 2');
  });

  /** A version-1 file: no motion fields. */
  const v1 = (params: MachineParams): string => {
    const raw: Record<string, unknown> = JSON.parse(serializeParams(params));
    for (const key of ['rapidRateXY', 'rapidRateZ', 'safeHeight', 'depthPerPass', 'acceleration', 'junctionDeviation']) {
      delete raw[key];
    }
    raw.version = 1;
    return JSON.stringify(raw);
  };

  it('migrates a version-1 inch file with the default motion fields', () => {
    expect(parseParams(v1(vbit))).toEqual({ ok: true, params: vbit });
  });

  it('migrates a version-1 millimeter file with defaults converted to mm', () => {
    const mm = convertParams(vbit, 'mm');
    const result = parseParams(v1(mm));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.version).toBe(2);
    expect(result.params.units).toBe('mm');
    expect(result.params.sheet).toEqual(mm.sheet);
    expect(result.params.rapidRateXY).toBeCloseTo(10160);
    expect(result.params.safeHeight).toBeCloseTo(12.7);
    expect(result.params.acceleration).toBeCloseTo(254);
    expect(result.params.junctionDeviation).toBeCloseTo(0.0508);
  });

  it('drops unknown extra fields', () => {
    const result = parseParams(withRaw((r) => (r.extra = 'x')));
    expect(result).toEqual({ ok: true, params: DEFAULT_PARAMS });
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['non-object', '[1, 2]'],
    ['null', 'null'],
    ['wrong version', withRaw((r) => (r.version = 3))],
    ['v2 missing a motion field', withRaw((r) => delete r.acceleration)],
    ['negative junction deviation', withRaw((r) => (r.junctionDeviation = -1))],
    ['missing version', withRaw((r) => delete r.version)],
    ['bad units', withRaw((r) => (r.units = 'cm'))],
    ['missing sheet', withRaw((r) => delete r.sheet)],
    ['missing field', withRaw((r) => delete r.feedRate)],
    ['string number', withRaw((r) => (r.sheet.x = '96'))],
    ['wrong bit kind', withRaw((r) => (r.bit.shape = { kind: 'drill' }))],
    ['V-bit without angle', withRaw((r) => (r.bit.shape = { kind: 'vbit' }))],
    ['negative value', withRaw((r) => (r.bit.diameter = -0.25))],
    ['overflow to Infinity', serializeParams(DEFAULT_PARAMS).replace('"feedRate": 200', '"feedRate": 1e999')],
  ])('rejects %s', (_name, text) => {
    const result = parseParams(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });
});
