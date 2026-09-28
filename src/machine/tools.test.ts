/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, convertParams } from './params';
import type { Tool, ToolLibrary } from './tools';
import {
  applyTool,
  nextToolNumber,
  resolveActiveTool,
  paramsMatchTool,
  parseLibrary,
  serializeLibrary,
  toolFromParams,
  toolLabel,
  validateLibrary,
  validateTool,
} from './tools';

const quarter: Tool = toolFromParams(DEFAULT_PARAMS, 1, '1/4" up-cut', 'a', 1000);
const vbit: Tool = {
  id: 'b',
  number: 3,
  name: '90° V-bit',
  units: 'mm',
  diameter: 12.7,
  shape: { kind: 'vbit', includedAngleDeg: 90 },
  flute: { kind: 'compression', upcutLength: 3 },
  fluteCount: 2,
  spindleRpm: 16000,
  updatedAt: 2000,
};
const library: ToolLibrary = { version: 1, tools: [quarter, vbit] };

describe('toolFromParams / applyTool', () => {
  it('captures the bit, feeds and spindle speed in the params units', () => {
    expect(quarter).toEqual({
      id: 'a',
      number: 1,
      name: '1/4" up-cut',
      units: 'in',
      diameter: 0.25,
      shape: { kind: 'flat' },
      flute: { kind: 'up' },
      fluteCount: 2,
      feedRate: 200,
      plungeRate: 50,
      spindleRpm: 18000,
      updatedAt: 1000,
    });
    expect(paramsMatchTool(DEFAULT_PARAMS, quarter)).toBe(true);
  });

  it("applies a tool in another unit system, converting its lengths and keeping params it does not set", () => {
    const p = applyTool(DEFAULT_PARAMS, vbit);
    expect(p.bit.diameter).toBeCloseTo(0.5, 12);
    expect(p.bit.shape).toEqual({ kind: 'vbit', includedAngleDeg: 90 });
    expect(p.bit.flute.kind).toBe('compression');
    if (p.bit.flute.kind === 'compression') expect(p.bit.flute.upcutLength).toBeCloseTo(3 / 25.4, 12);
    expect(p.spindleRpm).toBe(16000);
    // The V-bit has no feeds of its own.
    expect(p.feedRate).toBe(DEFAULT_PARAMS.feedRate);
    expect(p.units).toBe('in');
    expect(paramsMatchTool(p, vbit)).toBe(true);
    // Still a match after the params switch to mm.
    expect(paramsMatchTool(convertParams(p, 'mm'), vbit)).toBe(true);
  });

  it('notices an edit since the tool was picked', () => {
    const p = applyTool(DEFAULT_PARAMS, quarter);
    expect(paramsMatchTool({ ...p, bit: { ...p.bit, fluteCount: 3 } }, quarter)).toBe(false);
    expect(paramsMatchTool({ ...p, feedRate: 150 }, quarter)).toBe(false);
    expect(paramsMatchTool({ ...p, bit: { ...p.bit, diameter: 0.125 } }, quarter)).toBe(false);
  });
});

describe('validation', () => {
  it('accepts valid tools and reports each kind of problem', () => {
    expect(validateTool(quarter)).toEqual([]);
    expect(validateTool(vbit)).toEqual([]);
    expect(validateTool({ ...quarter, number: 0 })).toHaveLength(1);
    expect(validateTool({ ...quarter, number: 1.5 })).toHaveLength(1);
    expect(validateTool({ ...quarter, name: '  ' })).toHaveLength(1);
    expect(validateTool({ ...quarter, diameter: 0 })).toHaveLength(1);
    expect(validateTool({ ...quarter, fluteCount: 9 })).toHaveLength(1);
    expect(validateTool({ ...quarter, feedRate: -1 })).toHaveLength(1);
    expect(validateTool({ ...vbit, shape: { kind: 'vbit', includedAngleDeg: 180 } })).toHaveLength(1);
    expect(validateTool({ ...vbit, flute: { kind: 'compression', upcutLength: 0 } })).toHaveLength(1);
  });

  it('rejects a library with a tool number or id used twice', () => {
    expect(validateLibrary(library)).toEqual([]);
    expect(validateLibrary({ version: 1, tools: [quarter, { ...vbit, number: 1 }] })).toEqual(['Tool number 1 is used twice']);
    expect(validateLibrary({ version: 1, tools: [quarter, { ...vbit, id: 'a' }] })).toEqual(['Tool id a is used twice']);
  });
});

describe('resolveActiveTool', () => {
  it('keeps a stored id that is in the library and picks nothing otherwise', () => {
    expect(resolveActiveTool('b', library)).toBe('b');
    expect(resolveActiveTool(null, library)).toBeNull();
    expect(resolveActiveTool('', library)).toBeNull();
    expect(resolveActiveTool('gone', library)).toBeNull();
  });
});

describe('nextToolNumber and toolLabel', () => {
  it('finds the lowest free number', () => {
    expect(nextToolNumber(library)).toBe(2);
    expect(nextToolNumber({ version: 1, tools: [] })).toBe(1);
  });

  it('labels a tool on one line', () => {
    expect(toolLabel(vbit)).toBe('T3 · 90° V-bit (12.7 mm 90° V, 2 fl)');
  });
});

describe('serializeLibrary / parseLibrary', () => {
  it('round-trips', () => {
    expect(parseLibrary(serializeLibrary(library))).toEqual({ ok: true, library });
  });

  it('drops unknown fields', () => {
    const raw = JSON.parse(serializeLibrary(library));
    raw.tools[0].color = 'red';
    raw.extra = 1;
    expect(parseLibrary(JSON.stringify(raw))).toEqual({ ok: true, library });
  });

  it.each([
    ['malformed JSON', '{'],
    ['a non-object', '[]'],
    ['a wrong version', JSON.stringify({ version: 2, tools: [] })],
    ['missing tools', JSON.stringify({ version: 1 })],
    ['a tool without an id', JSON.stringify({ version: 1, tools: [{ ...quarter, id: '' }] })],
    ['an unknown shape', JSON.stringify({ version: 1, tools: [{ ...quarter, shape: { kind: 'drill' } }] })],
    ['a string diameter', JSON.stringify({ version: 1, tools: [{ ...quarter, diameter: '0.25' }] })],
    ['a duplicate number', JSON.stringify({ version: 1, tools: [quarter, { ...vbit, number: 1 }] })],
  ])('rejects %s', (_, text) => {
    const result = parseLibrary(text);
    expect(result.ok).toBe(false);
  });
});
