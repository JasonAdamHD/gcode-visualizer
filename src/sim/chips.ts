/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Wood chips thrown off the bit while it cuts: a fixed-size particle pool
// with simple ballistic physics (gravity, air drag, landing), in machine
// coordinates (Z up, Z = 0 at the sheet top) and wall-clock seconds.
// Believable, not simulated: the flute direction decides where chips go.
//
// - Up-cut flutes lift chips up and out of the cut.
// - Down-cut flutes push chips down into the cut; a few escape.
// - A compression bit is up-cut for its first `upcutLength` from the tip:
//   a pass no deeper than that throws chips up like an up-cut bit; deeper,
//   the down-cut flutes at the top face pack chips into the cut.
//
// The spindle turns clockwise seen from above (as the toolpath code
// assumes), so the cutting edge at angle θ on the bit moves along
// (sin θ, −cos θ) and flings chips that way; chips leave on the side
// behind the bit, where the material is already cut.
import type { FluteDirection } from '../machine/params';
import type { Point3 } from '../toolpath/moves';

/** Standard gravity, m/s². */
const GRAVITY = 9.81;
/** Air drag on a chip, per second (velocity decays by e^(−DRAG·t)); chips are light. */
const DRAG = 3;
/** How long a chip lasts, seconds: flying, then resting before it fades. */
const LIFE = [1.6, 3.2] as const;
/** Share of the last part of its life over which a chip shrinks away. */
const FADE = 0.25;

/** Share of chips thrown up and out of the cut, by how the flutes act. */
const UP_SHARE = { up: 0.92, down: 0.08, packed: 0.12 };

/**
 * Speeds in m/s: [min, max]. Toned down from a real router's spray so most
 * chips land within a few bit diameters to a hand's width of the cut,
 * where a zoomed-in view can see them.
 */
const UP_SPEED = [0.4, 1.0] as const;
const FLING_SPEED = [0.3, 0.9] as const;
const DOWN_FLING_SPEED = [0.05, 0.25] as const;

/** The live chips, stored flat so thousands cost little; `count` of `capacity` are in use. */
export type Chips = {
  capacity: number;
  count: number;
  /** Position `[x, y, z]` per chip, world units. */
  pos: Float32Array;
  /** Velocity per chip, world units per second. */
  vel: Float32Array;
  /** Height where the chip comes to rest. */
  floor: Float32Array;
  /**
   * Tumbling: a unit axis per chip and its rate in radians per second; once
   * the chip has landed, the angle it came to rest at (`chipAngle`).
   */
  axis: Float32Array;
  spin: Float32Array;
  age: Float32Array;
  life: Float32Array;
  /** Chip size as a fraction of the bit diameter. */
  size: Float32Array;
  landed: Uint8Array;
};

export function createChips(capacity: number): Chips {
  return {
    capacity,
    count: 0,
    pos: new Float32Array(capacity * 3),
    vel: new Float32Array(capacity * 3),
    floor: new Float32Array(capacity),
    axis: new Float32Array(capacity * 3),
    spin: new Float32Array(capacity),
    age: new Float32Array(capacity),
    life: new Float32Array(capacity),
    size: new Float32Array(capacity),
    landed: new Uint8Array(capacity),
  };
}

/** Where and how the bit is cutting when chips are thrown. */
export type ChipSource = {
  /** Tool tip position. */
  tip: Point3;
  /** Direction of travel in XY (unit length), or zero for a plunge. */
  travel: { x: number; y: number };
  bitDiameter: number;
  flute: FluteDirection;
  /** World units per meter: speeds and gravity are given in meters. */
  unitsPerMeter: number;
};

/** A random number in [0, 1), injectable so tests are deterministic. */
export type Random = () => number;

const between = (range: readonly [number, number], rand: Random) => range[0] + (range[1] - range[0]) * rand();

/**
 * The share of chips a cut throws up and out: most for up-cut flutes (and
 * a compression bit cutting no deeper than its up-cut length), few for
 * down-cut flutes and a deep compression cut. `depth` is how far the tip
 * is below the sheet top.
 */
export function upShare(flute: FluteDirection, depth: number): number {
  switch (flute.kind) {
    case 'up':
      return UP_SHARE.up;
    case 'down':
      return UP_SHARE.down;
    case 'compression':
      return depth <= flute.upcutLength ? UP_SHARE.up : UP_SHARE.packed;
  }
}

/** A launched chip: offset from the bit axis, velocity, and where it will rest. */
export type Launch = { position: Point3; velocity: Point3; floor: number; up: boolean };

/**
 * One chip's launch from `source`: it leaves the bit's edge at a random
 * angle on the side behind the bit, flung along the edge's clockwise
 * motion. Chips thrown up leave from the top of the cut with an upward
 * speed and come to rest on the sheet top; the rest stay in the cut, moving
 * slowly, and rest on its floor.
 */
export function launchChip(source: ChipSource, rand: Random): Launch {
  const { tip, travel, bitDiameter, unitsPerMeter: m } = source;
  const r = bitDiameter / 2;
  const depth = Math.max(0, -tip.z);
  // Behind the bit: the half facing away from travel (any side for a plunge).
  let theta = 2 * Math.PI * rand();
  if (travel.x !== 0 || travel.y !== 0) {
    const back = Math.atan2(-travel.y, -travel.x);
    theta = back + (rand() - 0.5) * Math.PI;
  }
  const edge = { x: Math.cos(theta), y: Math.sin(theta) };
  const tangent = { x: edge.y, y: -edge.x };
  const up = rand() < upShare(source.flute, depth);
  if (up) {
    const fling = between(FLING_SPEED, rand) * m;
    // A little outward drift as well, so chips spread rather than line up.
    const out = 0.25 * fling * rand();
    return {
      position: { x: tip.x + r * edge.x, y: tip.y + r * edge.y, z: Math.min(0, tip.z + depth * rand()) },
      velocity: {
        x: fling * tangent.x + out * edge.x,
        y: fling * tangent.y + out * edge.y,
        z: between(UP_SPEED, rand) * m,
      },
      floor: 0,
      up,
    };
  }
  const fling = between(DOWN_FLING_SPEED, rand) * m;
  return {
    position: { x: tip.x + r * edge.x * rand(), y: tip.y + r * edge.y * rand(), z: tip.z + depth * rand() },
    velocity: { x: fling * tangent.x, y: fling * tangent.y, z: -0.1 * m * rand() },
    floor: tip.z,
    up,
  };
}

/** Adds up to `n` chips from `source` (as many as there is room for) and returns how many were added. */
export function emitChips(chips: Chips, n: number, source: ChipSource, rand: Random): number {
  const room = Math.min(n, chips.capacity - chips.count);
  for (let k = 0; k < room; k++) {
    const c = chips.count++;
    const { position: p, velocity: v, floor } = launchChip(source, rand);
    chips.pos.set([p.x, p.y, p.z], c * 3);
    chips.vel.set([v.x, v.y, v.z], c * 3);
    chips.floor[c] = floor;
    // A random tumble axis (unit length).
    const u = 2 * rand() - 1;
    const a = 2 * Math.PI * rand();
    const s = Math.sqrt(1 - u * u);
    chips.axis.set([s * Math.cos(a), s * Math.sin(a), u], c * 3);
    chips.spin[c] = (4 + 16 * rand()) * (rand() < 0.5 ? -1 : 1);
    chips.age[c] = 0;
    chips.life[c] = between(LIFE, rand);
    chips.size[c] = 0.15 + 0.2 * rand();
    chips.landed[c] = 0;
  }
  return room;
}

/**
 * Advances every chip by `dt` seconds: gravity (in world units via
 * `unitsPerMeter`) and drag while flying, resting once it drops to its
 * floor, and removal at the end of its life. Chips that fall past the
 * sheet's edge keep falling until `lowest`, then go.
 */
export function stepChips(
  chips: Chips,
  dt: number,
  unitsPerMeter: number,
  sheet: { x: number; y: number },
  lowest: number
) {
  const g = GRAVITY * unitsPerMeter;
  const decay = Math.exp(-DRAG * dt);
  let c = 0;
  while (c < chips.count) {
    chips.age[c] += dt;
    const i = c * 3;
    let dead = chips.age[c] >= chips.life[c];
    if (!dead && !chips.landed[c]) {
      chips.vel[i] *= decay;
      chips.vel[i + 1] *= decay;
      chips.vel[i + 2] = chips.vel[i + 2] * decay - g * dt;
      chips.pos[i] += chips.vel[i] * dt;
      chips.pos[i + 1] += chips.vel[i + 1] * dt;
      chips.pos[i + 2] += chips.vel[i + 2] * dt;
      const x = chips.pos[i];
      const y = chips.pos[i + 1];
      const onSheet = x >= 0 && y >= 0 && x <= sheet.x && y <= sheet.y;
      if (onSheet && chips.vel[i + 2] < 0 && chips.pos[i + 2] <= chips.floor[c]) {
        chips.pos[i + 2] = chips.floor[c];
        chips.vel.fill(0, i, i + 3);
        // Stop tumbling where it is: keep the angle rather than the rate.
        chips.spin[c] *= chips.age[c];
        chips.landed[c] = 1;
      } else if (!onSheet && chips.pos[i + 2] < lowest) {
        dead = true;
      }
    }
    if (dead) {
      removeChip(chips, c);
      continue;
    }
    c++;
  }
}

/** Removes chip `c` by moving the last chip into its place. */
function removeChip(chips: Chips, c: number) {
  const last = --chips.count;
  if (c === last) return;
  chips.pos.copyWithin(c * 3, last * 3, last * 3 + 3);
  chips.vel.copyWithin(c * 3, last * 3, last * 3 + 3);
  chips.axis.copyWithin(c * 3, last * 3, last * 3 + 3);
  chips.floor[c] = chips.floor[last];
  chips.spin[c] = chips.spin[last];
  chips.age[c] = chips.age[last];
  chips.life[c] = chips.life[last];
  chips.size[c] = chips.size[last];
  chips.landed[c] = chips.landed[last];
}

/** A chip's tumble angle about its axis now, radians. */
export function chipAngle(chips: Chips, c: number): number {
  return chips.landed[c] ? chips.spin[c] : chips.spin[c] * chips.age[c];
}

/** A chip's size factor now: 1 until the last `FADE` of its life, then shrinking to 0. */
export function chipScale(chips: Chips, c: number): number {
  const left = (chips.life[c] - chips.age[c]) / (chips.life[c] * FADE);
  return Math.max(0, Math.min(1, left));
}

/** Chips to throw for `volume` (world units³) of material cut by a bit of `diameter`: one per 2 % of d³. */
export function chipsForVolume(volume: number, diameter: number): number {
  return volume / (0.02 * diameter ** 3);
}
