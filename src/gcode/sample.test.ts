/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../machine/params';
import { analyzeProgram } from './analyze';
import { parseGcode } from './parse';
import text from '../../public/samples/demo.nc?raw';

// The bundled sample must keep demonstrating what it says it does.
describe('public/samples/demo.nc', () => {
  const params = DEFAULT_PARAMS;
  const program = parseGcode(text, { point: { x: 0, y: 0, z: params.safeHeight }, units: params.units });
  const lines = text.split(/\r?\n/);

  it('parses as inches with no errors', () => {
    expect(program.units).toBe('in');
    expect(program.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('reports only its spindle on/off and program-end words as unsupported', () => {
    const words = program.diagnostics.map((d) => d.message.split(' ')[0]);
    expect(words).toEqual(['M3', 'M5', 'M30']);
  });

  it('cuts at its S18000 spindle speed', () => {
    const cuts = program.moves.filter((m) => m.kind === 'feed' || m.kind === 'plunge');
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts.every((m) => m.spindleRpm === 18000)).toBe(true);
  });

  it('flags exactly the deliberate slot off the sheet', () => {
    const found = analyzeProgram(program.moves, params);
    expect(found.map((d) => d.code)).toEqual(['out-of-bounds']);
    expect(lines[found[0].line]).toBe('G1 X100 F200');
  });

  it('has arcs, including a full circle and a helix', () => {
    expect(program.moves.filter((m) => m.bulge).length).toBeGreaterThanOrEqual(6);
    expect(program.moves.some((m) => m.bulge && m.from.z !== m.to.z)).toBe(true);
  });
});
