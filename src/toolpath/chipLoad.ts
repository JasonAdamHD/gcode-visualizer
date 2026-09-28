/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Chip load: how much material each cutting edge takes per pass, the
// number that decides whether a router bit cuts cleanly, rubs and burns,
// or is overloaded. Lengths in the job's units; feeds per minute.
import type { MachineParams } from '../machine/params';
import type { Move } from './moves';

export type ChipLoadRating = 'low' | 'ok' | 'high';

/**
 * A rule-of-thumb chip load band for wood with carbide router bits, as
 * fractions of the bit diameter (a 1/4" bit: about 0.004–0.012 in per
 * tooth). Below it the edges rub and burn; above it they are overloaded.
 * Real recommendations vary by material and bit; this is a guide, and it
 * is for side cutting (plunging normally runs lighter).
 */
export const CHIP_LOAD_BAND = [0.015, 0.05] as const;

/**
 * Chip load (feed per tooth): `feed ÷ (rpm × flutes)`, in the feed's length
 * units per tooth. Null when the spindle is stopped (or there are no
 * flutes), since nothing is being cut into chips.
 */
export function chipLoad(feedPerMinute: number, rpm: number, flutes: number): number | null {
  if (!(rpm > 0) || !(flutes >= 1)) return null;
  return feedPerMinute / (rpm * flutes);
}

/** Chips the bit makes per second while cutting: one per tooth pass, `rpm × flutes ÷ 60`. */
export function chipsPerSecond(rpm: number, flutes: number): number {
  return rpm > 0 && flutes >= 1 ? (rpm * flutes) / 60 : 0;
}

/** Where a chip load sits against `CHIP_LOAD_BAND` for a bit of `diameter`. */
export function rateChipLoad(load: number, diameter: number): ChipLoadRating {
  if (load < CHIP_LOAD_BAND[0] * diameter) return 'low';
  if (load > CHIP_LOAD_BAND[1] * diameter) return 'high';
  return 'ok';
}

/**
 * The feed rate and spindle speed a move cuts at: the program's own F and
 * S when it has them, otherwise the params' plunge rate (plunges) or feed
 * rate and spindle speed. Null for rapids and retracts, which do not cut.
 */
export function cutConditions(move: Move, params: MachineParams): { feedRate: number; rpm: number } | null {
  if (move.kind !== 'feed' && move.kind !== 'plunge') return null;
  return {
    feedRate: move.feedRate ?? (move.kind === 'plunge' ? params.plungeRate : params.feedRate),
    rpm: move.spindleRpm ?? params.spindleRpm,
  };
}

/** A chip's size: `length` along the tooth's path, `width` across it, `thickness` the chip load. */
export type ChipSize = { length: number; width: number; thickness: number };

/**
 * How much chips curl up: a chip's visible length as a share of the arc it
 * was cut along.
 */
const CURL = 1 / 3;

/**
 * The size of the chips a bit of `diameter` makes at chip load `load`
 * with `engaged` depth of cut: as thick as the chip load, as wide as the
 * engaged depth, and as long as the tooth's arc through the material (half
 * the circumference when slotting), curled up to a third of that.
 */
export function chipSize(load: number, engaged: number, diameter: number): ChipSize {
  return { length: ((Math.PI * diameter) / 2) * CURL, width: engaged, thickness: load };
}

/**
 * The chips cut and their size over a stretch of `distance` along the
 * path that removed `volume` of material: one chip per tooth pass,
 * `distance ÷ load`, each as wide as the depth the bit actually engaged
 * (`volume ÷ (distance × diameter)`, held between the chip load and two
 * diameters). None when nothing was removed or the spindle is stopped.
 */
export function chipsCut(
  volume: number,
  distance: number,
  load: number | null,
  diameter: number
): { count: number; size: ChipSize } | null {
  if (load === null || !(volume > 0) || !(distance > 0)) return null;
  const engaged = Math.min(2 * diameter, Math.max(load, volume / (distance * diameter)));
  return { count: distance / load, size: chipSize(load, engaged, diameter) };
}
