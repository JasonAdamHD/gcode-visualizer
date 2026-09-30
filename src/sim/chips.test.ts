/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { FluteDirection } from '../machine/params';
import type { ChipSource, SurfaceAt } from './chips';
import { chipAngle, chipScale, createChips, emitChips, launchChip, stepChips, upShare } from './chips';

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
  chip: { length: 3, width: 3, thickness: 0.15 },
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

  it('sends chips thrown up upward and keeps the rest moving slowly in the cut', () => {
    const rand = random(3);
    for (let k = 0; k < 500; k++) {
      const chip = launchChip(source(up), rand);
      if (chip.up) {
        expect(chip.velocity.z).toBeGreaterThan(0);
      } else {
        expect(chip.velocity.z).toBeLessThanOrEqual(0);
        expect(chip.position.z).toBeGreaterThanOrEqual(-3);
        expect(Math.hypot(chip.velocity.x, chip.velocity.y)).toBeLessThan(0.3 * MM);
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
  // A groove 3 deep and 6 wide along y = 30, cut from x = 20 to 80.
  const groove: SurfaceAt = (x, y) => {
    if (x < 0 || y < 0 || x > sheet.x || y > sheet.y) return null;
    return x >= 20 && x <= 80 && Math.abs(y - 30) <= 3 ? -3 : 0;
  };

  it('sizes each chip from the chip being cut, within ±30 %', () => {
    const chips = createChips(100);
    emitChips(chips, 100, source(up), random(6));
    for (let c = 0; c < chips.count; c++) {
      const [l, w, t] = chips.dims.slice(c * 3, c * 3 + 3);
      expect(l / 3).toBeGreaterThanOrEqual(0.7 - 1e-6);
      expect(l / 3).toBeLessThanOrEqual(1.3 + 1e-6);
      // One factor for the whole chip, so its proportions hold.
      expect(w / l).toBeCloseTo(1, 5);
      expect(t / l).toBeCloseTo(0.05, 5);
    }
  });

  it('makes room in a full pool by removing the oldest chips', () => {
    const chips = createChips(10);
    const flat = () => 0;
    expect(emitChips(chips, 6, source(up), random(1))).toBe(6);
    stepChips(chips, 0.1, 1000, flat, -20);
    expect(emitChips(chips, 4, source(up), random(2))).toBe(4);
    stepChips(chips, 0.1, 1000, flat, -20);
    // Full: the next 3 replace 3 of the first 6, the oldest.
    expect(emitChips(chips, 3, source(up), random(3))).toBe(3);
    expect(chips.count).toBe(10);
    const ages = Array.from(chips.age.subarray(0, chips.count)).map((a) => Math.round(a * 10) / 10).sort();
    expect(ages).toEqual([0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2]);
    // More than the pool holds: a pool of new chips.
    expect(emitChips(chips, 25, source(up), random(4))).toBe(10);
    expect(Array.from(chips.age.subarray(0, chips.count)).every((a) => a === 0)).toBe(true);
  });

  it('flies chips under gravity until they rest on the surface below them, then removes them', () => {
    const chips = createChips(400);
    emitChips(chips, 200, source(up), random(9));
    emitChips(chips, 200, source(down), random(10));
    const lowest = -20;
    let t = 0;
    let everLanded = 0;
    let inGroove = 0;
    while (chips.count > 0 && t < 10) {
      stepChips(chips, 1 / 60, MM, groove, lowest);
      t += 1 / 60;
      for (let c = 0; c < chips.count; c++) {
        const surface = groove(chips.pos[c * 3], chips.pos[c * 3 + 1]);
        // Never below the material while over the sheet.
        if (surface !== null) expect(chips.pos[c * 3 + 2]).toBeGreaterThanOrEqual(surface - 1e-4);
        if (chips.landed[c]) {
          everLanded++;
          expect(chips.vel[c * 3 + 2]).toBe(0);
          // Resting on the surface where it came down: the groove floor or the sheet top.
          expect(chips.pos[c * 3 + 2]).toBe(surface);
          if (surface === -3) inGroove++;
        }
      }
    }
    expect(inGroove).toBeGreaterThan(0);
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
      stepChips(chips, 1 / 240, MM, groove, -20);
    }
    expect(chips.landed[0]).toBe(1);
    const rest = chipAngle(chips, 0);
    // Within one step's worth of tumbling of where it was, then fixed.
    expect(Math.abs(rest - before)).toBeLessThanOrEqual(Math.abs(chips.spin[0] / chips.age[0]) / 240 + 1e-6);
    stepChips(chips, 0.1, MM, groove, -20);
    expect(chipAngle(chips, 0)).toBe(rest);
  });

  it('lets gravity pull a flying chip down', () => {
    const chips = createChips(1);
    emitChips(chips, 1, { ...source(up), tip: { x: 50, y: 30, z: 0 }, flute: up }, () => 0.01);
    const vz = chips.vel[2];
    stepChips(chips, 0.05, MM, groove, -20);
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
