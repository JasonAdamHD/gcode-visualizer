/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Draws the wood chips as one instanced mesh of small flakes. Chips move in
// wall-clock time, so they keep flying and settling after playback pauses;
// this runs its own animation frames while any chip is alive and asks the
// scene to redraw each one.
import * as THREE from 'three';
import type { ChipSource, Chips, SurfaceAt } from '../sim/chips';
import { chipAngle, chipScale, createChips, emitChips, stepChips } from '../sim/chips';

/** Most chips alive at once. */
export const CHIP_CAPACITY = 4000;

/** Longest step one frame may take, seconds (after a hidden tab, say). */
const MAX_STEP = 0.05;

export type ChipWorld = {
  unitsPerMeter: number;
  /** Where chips come to rest: the stock's surface. */
  surfaceAt: SurfaceAt;
  /** Chips falling off the sheet are dropped below this height. */
  lowest: number;
};

const axis = new THREE.Vector3();
const spin = new THREE.Quaternion();
const scale = new THREE.Vector3();
const position = new THREE.Vector3();
const matrix = new THREE.Matrix4();

export class ChipView {
  readonly mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  private readonly chips: Chips = createChips(CHIP_CAPACITY);
  private readonly render: () => void;
  private world: ChipWorld = { unitsPerMeter: 1000, surfaceAt: () => null, lowest: 0 };
  private frame = 0;
  private last = 0;

  constructor(render: () => void) {
    this.render = render;
    // A unit box, scaled per chip to its length, width and thickness.
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), CHIP_CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** The job the chips belong to; existing chips are cleared when it changes. */
  setWorld(world: ChipWorld) {
    this.world = world;
    this.clear();
  }

  setColor(color: string) {
    this.mesh.material.color.set(color);
  }

  /** Throws `n` chips from `source` and keeps them moving. */
  emit(n: number, source: Omit<ChipSource, 'unitsPerMeter'>) {
    if (n <= 0) return;
    emitChips(this.chips, n, { ...source, unitsPerMeter: this.world.unitsPerMeter }, Math.random);
    this.start();
  }

  clear() {
    this.chips.count = 0;
    this.mesh.count = 0;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.render();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }

  private start() {
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.frame = 0;
    const dt = Math.min(MAX_STEP, (now - this.last) / 1000);
    this.last = now;
    const { unitsPerMeter, surfaceAt, lowest } = this.world;
    stepChips(this.chips, dt, unitsPerMeter, surfaceAt, lowest);
    this.writeInstances();
    this.render();
    if (this.chips.count > 0) this.frame = requestAnimationFrame(this.tick);
  };

  private writeInstances() {
    const c = this.chips;
    for (let k = 0; k < c.count; k++) {
      const i = k * 3;
      axis.set(c.axis[i], c.axis[i + 1], c.axis[i + 2]);
      spin.setFromAxisAngle(axis, chipAngle(c, k));
      const f = chipScale(c, k);
      scale.set(c.dims[i] * f, c.dims[i + 1] * f, c.dims[i + 2] * f);
      position.set(c.pos[i], c.pos[i + 1], c.pos[i + 2]);
      matrix.compose(position, spin, scale);
      this.mesh.setMatrixAt(k, matrix);
    }
    this.mesh.count = c.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
