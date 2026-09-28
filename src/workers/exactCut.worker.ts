/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Computes the exact finished part off the main thread: the boolean
// operations can take tens of seconds on a long job. One request per
// worker; the page terminates the worker when the job changes.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { ExactCutInput } from '../sim/exactCut';
import { exactCut } from '../sim/exactCut';

export type ExactCutReply =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; positions: Float32Array; indices: Uint32Array }
  | { type: 'error'; message: string };

const post = (reply: ExactCutReply, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(reply, transfer);

self.onmessage = async (e: MessageEvent<ExactCutInput>) => {
  try {
    const wasm = await Module({ locateFile: () => wasmUrl });
    wasm.setup();
    let reported = -1;
    const mesh = exactCut(wasm, e.data, (fraction) => {
      // Whole percents only; the page redraws its status on each one.
      const percent = Math.floor(fraction * 100);
      if (percent === reported) return;
      reported = percent;
      post({ type: 'progress', fraction });
    });
    post({ type: 'done', positions: mesh.positions, indices: mesh.indices }, [mesh.positions.buffer, mesh.indices.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
