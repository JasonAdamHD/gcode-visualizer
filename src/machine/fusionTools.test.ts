/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { fromFusionLibrary, readToolFile } from './fusionTools';
import { DEFAULT_PARAMS } from './params';
import { serializeLibrary, toolFromParams } from './tools';

// Hand-written in the layout of Fusion's tool library export: the older
// "start-values": { "*": … } form and the newer "presets" array.
const fusion = {
  version: 1,
  data: [
    {
      type: 'flat end mill',
      unit: 'inches',
      description: '#201 - 1/4" Square',
      guid: 'g-flat',
      last_modified: 1500000000000,
      geometry: { DC: 0.25, NOF: 3, LCF: 0.75, RE: 0 },
      'post-process': { number: 4, comment: '' },
      'start-values': { '*': { n: 18000, v_f: 90, v_f_plunge: 30, f_z: 0.002 } },
    },
    {
      type: 'chamfer mill',
      unit: 'millimeters',
      description: '3 flute 8.3mm chamfer mill',
      guid: 'g-chamfer',
      geometry: { DC: 8.3, NOF: 3, TA: 45 },
      'post-process': { number: 8 },
      'start-values': { presets: [{ name: 'Wood', n: 12000, v_f: 1500, v_f_plunge: 500 }] },
    },
    {
      type: 'counter sink',
      unit: 'inches',
      description: '#302 - 60 Deg V-bit',
      guid: 'g-60',
      geometry: { DC: 0.4375, NOF: 2, SIG: 60 },
      'post-process': { number: 302 },
    },
    {
      type: 'ball end mill',
      unit: 'inches',
      description: '#111 - 1/16" Ballnose',
      guid: 'g-ball',
      geometry: { DC: 0.0625, NOF: 2, RE: 0.03125 },
      'post-process': { number: 1 },
    },
    {
      type: 'bull nose end mill',
      unit: 'millimeters',
      description: '6 mm bull nose',
      geometry: { DC: 6, NOF: 4, RE: 1 },
      'post-process': {},
    },
    { type: 'drill', unit: 'millimeters', description: '5 mm drill', geometry: { DC: 5, SIG: 118 } },
    { type: 'flat end mill', unit: 'inches', description: 'no diameter', geometry: {} },
  ],
};

describe('fromFusionLibrary', () => {
  const { tools, skipped, notes } = fromFusionLibrary(fusion, 42);
  const byName = (name: string) => tools.find((t) => t.name.startsWith(name))!;

  it('imports the mill types this app can cut with, and skips the rest with a reason', () => {
    expect(tools.map((t) => t.name)).toEqual([
      '#201 - 1/4" Square',
      '3 flute 8.3mm chamfer mill',
      '#302 - 60 Deg V-bit',
      '#111 - 1/16" Ballnose',
      '6 mm bull nose',
    ]);
    expect(skipped).toEqual([
      { name: '5 mm drill', reason: 'drill tools are not supported' },
      { name: 'no diameter', reason: 'no diameter (DC)' },
    ]);
  });

  it('reads diameter, flutes, units, number and the older preset form', () => {
    expect(byName('#201')).toEqual({
      id: 'g-flat',
      number: 4,
      name: '#201 - 1/4" Square',
      units: 'in',
      diameter: 0.25,
      shape: { kind: 'flat' },
      flute: { kind: 'up' },
      fluteCount: 3,
      feedRate: 90,
      plungeRate: 30,
      spindleRpm: 18000,
      updatedAt: 1500000000000,
    });
  });

  it('turns a chamfer mill half angle and a counter sink point angle into V-bit included angles', () => {
    expect(byName('3 flute').shape).toEqual({ kind: 'vbit', includedAngleDeg: 90 });
    expect(byName('3 flute').units).toBe('mm');
    expect(byName('#302').shape).toEqual({ kind: 'vbit', includedAngleDeg: 60 });
  });

  it('reads the newer presets array', () => {
    expect(byName('3 flute')).toMatchObject({ spindleRpm: 12000, feedRate: 1500, plungeRate: 500 });
  });

  it('keeps tools without presets free of feeds, and notes what it left out', () => {
    expect(byName('#302').feedRate).toBeUndefined();
    expect(byName('6 mm').shape).toEqual({ kind: 'flat' });
    expect(notes).toEqual(['6 mm bull nose: corner radius ignored (imported as a flat end mill)']);
    // No number and no guid: number 0 (assigned on merge) and a fresh id.
    expect(byName('6 mm').number).toBe(0);
    expect(byName('6 mm').id).toBeTruthy();
    expect(byName('6 mm').updatedAt).toBe(42);
  });
});

describe('readToolFile', () => {
  it("recognizes this app's own export", () => {
    const library = { version: 1 as const, tools: [toolFromParams(DEFAULT_PARAMS, 1, 'Mine', 'x', 5)] };
    const result = readToolFile(serializeLibrary(library));
    expect(result).toEqual({ ok: true, format: 'app', import: { tools: library.tools, skipped: [], notes: [] } });
  });

  it('recognizes a Fusion library', () => {
    const result = readToolFile(JSON.stringify(fusion));
    expect(result.ok && result.format).toBe('fusion');
  });

  it('explains what is wrong with other files', () => {
    expect(readToolFile('not json')).toEqual({ ok: false, error: 'Not valid JSON' });
    expect(readToolFile('{"hello": 1}')).toEqual({ ok: false, error: 'Not a tool library from this app or from Fusion' });
    const bad = readToolFile(JSON.stringify({ version: 1, tools: [{ id: 'x' }] }));
    expect(bad.ok).toBe(false);
  });
});
