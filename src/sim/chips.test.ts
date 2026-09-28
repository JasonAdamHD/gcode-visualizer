/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { FluteDirection } from '../machine/params';
import type { ChipSource } from './chips';
import { chipAngle, chipScale, chipsForVolume, createChips, emitChips, launchChip, stepChips, upShare } from './chips';

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const MM = 1000; // world units per meter, millimeters
const source = (flute: FluteDirection, depth = 3, travel = { x: 1, y: 0 }): ChipSource => ({
  tip: { x: 50, y: 30, z: -depth },
  travel,
  bitDiameter: 6,
  flute,
  unitsPerMeter: MM,
});
const up: FluteDirection = { kind: 'up' };
const down: FluteDirection = { kind: 'down' };

/** Launches `n` chips and returns the share thrown up. */
function shareUp(s: ChipSource, n = 2000): number {
  const rand = random(7);
  let count = 0;
  for (let k = 0; k < n; k++) if (launchChip(s, rand).up) count++;
  return count / n;
}

describe('upShare and launchChip', () => {
  it('throws most up-cut chips up and most down-cut chips into the cut', () => {
    expect(shareUp(source(up))).toBeGreaterThan(0.85);
    expect(shareUp(source(down))).toBeLessThan(0.15);
  });

  it('treats a compression bit as up-cut within its up-cut length and packs chips deeper', () => {
    const compression: FluteDirection = { kind: 'compression', upcutLength: 3.175 };
    expect(upShare(compression, 3)).toBe(upShare(up, 3));
    expect(upShare(compression, 6)).toBeLessThan(0.2);
    expect(shareUp(source(compression, 2))).toBeGreaterThan(0.85);
    expect(shareUp(source(compression, 8))).toBeLessThan(0.2);
  });

  it('sends chips up out of the cut to rest on the sheet top, and keeps the rest on the cut floor', () => {
    const rand = random(3);
    for (let k = 0; k < 500; k++) {
      const chip = launchChip(source(up), rand);
      if (chip.up) {
        expect(chip.velocity.z).toBeGreaterThan(0);
        expect(chip.floor).toBe(0);
      } else {
        expect(chip.velocity.z).toBeLessThanOrEqual(0);
        expect(chip.floor).toBe(-3);
      }
    }
  });

  it('flings chips along a clockwise edge, from the side behind the bit', () => {
    const rand = random(11);
    const s = source(up, 3, { x: 0, y: 1 });
    for (let k = 0; k < 500; k++) {
      const chip = launchChip(s, rand);
      const off = { x: chip.position.x - s.tip.x, y: chip.position.y - s.tip.y };
      // Behind: away from +Y travel.
      expect(off.y).toBeLessThanOrEqual(1e-9);
      if (!chip.up) continue;
      // Clockwise seen from above: the edge at (cos θ, sin θ) moves along (sin θ, −cos θ).
      const tangent = { x: off.y / 3, y: -off.x / 3 };
      expect(chip.velocity.x * tangent.x + chip.velocity.y * tangent.y).toBeGreaterThan(0);
    }
  });

  it('scales speeds with the units', () => {
    const inches = { ...source(up), unitsPerMeter: 1000 / 25.4 };
    const a = launchChip(source(up), random(5));
    const b = launchChip(inches, random(5));
    expect(b.velocity.z / a.velocity.z).toBeCloseTo(1 / 25.4, 9);
  });
});

describe('emitChips and stepChips', () => {
  const sheet = { x: 100, y: 60 };

  it('adds chips up to the capacity', () => {
    const chips = createChips(10);
    expect(emitChips(chips, 6, source(up), random(1))).toBe(6);
    expect(emitChips(chips, 6, source(up), random(2))).toBe(4);
    expect(chips.count).toBe(10);
  });

  it('flies chips under gravity until they rest on their floor, then removes them at the end of life', () => {
    const chips = createChips(200);
    emitChips(chips, 200, source(up), random(9));
    const lowest = -20;
    let t = 0;
    let everLanded = 0;
    while (chips.count > 0 && t < 10) {
      stepChips(chips, 1 / 60, MM, sheet, lowest);
      t += 1 / 60;
      for (let c = 0; c < chips.count; c++) {
        // Never below its floor while on the sheet.
        const x = chips.pos[c * 3];
        const y = chips.pos[c * 3 + 1];
        if (x >= 0 && y >= 0 && x <= sheet.x && y <= sheet.y) expect(chips.pos[c * 3 + 2]).toBeGreaterThanOrEqual(chips.floor[c] - 1e-4);
        if (chips.landed[c]) {
          everLanded++;
          expect(chips.vel[c * 3 + 2]).toBe(0);
        }
      }
    }
    expect(everLanded).toBeGreaterThan(0);
    expect(chips.count).toBe(0);
    expect(t).toBeLessThan(3.3);
  });

  it('keeps a chip at the angle it landed at', () => {
    const chips = createChips(1);
    // 0.5 is above the down-cut up share, so this chip stays in the cut and lands on its floor.
    emitChips(chips, 1, source(down), () => 0.5);
    let before = chipAngle(chips, 0);
    for (let k = 0; k < 600 && !chips.landed[0] && chips.count > 0; k++) {
      before = chipAngle(chips, 0);
      stepChips(chips, 1 / 240, MM, sheet, -20);
    }
    expect(chips.landed[0]).toBe(1);
    const rest = chipAngle(chips, 0);
    // Within one step's worth of tumbling of where it was, then fixed.
    expect(Math.abs(rest - before)).toBeLessThanOrEqual(Math.abs(chips.spin[0] / chips.age[0]) / 240 + 1e-6);
    stepChips(chips, 0.1, MM, sheet, -20);
    expect(chipAngle(chips, 0)).toBe(rest);
  });

  it('lets gravity pull a flying chip down', () => {
    const chips = createChips(1);
    emitChips(chips, 1, { ...source(up), tip: { x: 50, y: 30, z: 0 }, flute: up }, () => 0.01);
    const vz = chips.vel[2];
    stepChips(chips, 0.05, MM, sheet, -20);
    expect(chips.vel[2]).toBeLessThan(vz);
  });

  it('shrinks chips away over the last part of their life', () => {
    const chips = createChips(1);
    emitChips(chips, 1, source(down), random(4));
    expect(chipScale(chips, 0)).toBe(1);
    chips.age[0] = chips.life[0] * 0.95;
    expect(chipScale(chips, 0)).toBeCloseTo(0.2, 5);
  });
});

describe('chipsForVolume', () => {
  it('throws one chip per 2 % of the bit diameter cubed', () => {
    expect(chipsForVolume(0.02 * 216, 6)).toBeCloseTo(1, 12);
    expect(chipsForVolume(0, 6)).toBe(0);
  });
});
