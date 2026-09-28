/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useMemo, useState } from 'react';
import type { MachineParams, Units } from '../machine/params';
import { unitFactor } from '../machine/params';
import type { ExactCutInput } from '../sim/exactCut';
import { MAX_EXACT_STROKES, cuttingSegments } from '../sim/exactCut';
import { ARC_TOLERANCE_MM } from '../toolpath/planner';
import type { Timeline } from '../toolpath/timeline';
import type { ExactCutReply } from '../workers/exactCut.worker';

/** How far the exact cut's round bit may stray from a true circle, in millimeters. */
const BIT_TOLERANCE_MM = 0.01;

/** Wait this long after the job last changed before starting, so editing does not restart it on every change. */
const START_DELAY_MS = 400;

export type ExactCut =
  | { status: 'off' }
  /** `progress` is the fraction of moves swept; at 1 the final union is running. */
  | { status: 'computing'; progress: number }
  | { status: 'ready'; positions: Float32Array; indices: Uint32Array }
  | { status: 'skipped'; moves: number }
  | { status: 'failed'; message: string };

type Result = { input: ExactCutInput } & ExactCut;

/**
 * The exact finished part for `timeline`, computed in a Web Worker while
 * `enabled`: status and progress while it runs, then the mesh. Jobs with
 * more than `MAX_EXACT_STROKES` swept moves (after merging) are skipped.
 * A new job cancels the running one.
 */
export function useExactCut(
  timeline: Timeline,
  sheet: MachineParams['sheet'],
  bit: MachineParams['bit'],
  units: Units,
  enabled: boolean
): ExactCut {
  const input = useMemo<ExactCutInput>(() => {
    const mm = unitFactor('mm', units);
    return {
      sheet: { x: sheet.x, y: sheet.y, thickness: sheet.thickness },
      bit: { diameter: bit.diameter, shape: bit.shape },
      segments: cuttingSegments(timeline.blocks, ARC_TOLERANCE_MM * mm),
      tolerance: BIT_TOLERANCE_MM * mm,
    };
  }, [timeline, sheet.x, sheet.y, sheet.thickness, bit.diameter, bit.shape, units]);
  const moves = input.segments.length / 6;
  const skipped = moves > MAX_EXACT_STROKES;
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!enabled || skipped) return;
    let worker: Worker | null = null;
    const timer = setTimeout(() => {
      worker = new Worker(new URL('../workers/exactCut.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<ExactCutReply>) => {
        const reply = e.data;
        if (reply.type === 'progress') setResult({ input, status: 'computing', progress: reply.fraction });
        else if (reply.type === 'done') setResult({ input, status: 'ready', positions: reply.positions, indices: reply.indices });
        else setResult({ input, status: 'failed', message: reply.message });
      };
      worker.onerror = (e) => setResult({ input, status: 'failed', message: e.message || 'The exact cut worker stopped' });
      // A copy of the segments: the memoized input stays usable here.
      worker.postMessage({ ...input, segments: input.segments.slice() });
    }, START_DELAY_MS);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [input, enabled, skipped]);

  if (!enabled) return { status: 'off' };
  if (skipped) return { status: 'skipped', moves };
  // A result for an older job does not count.
  if (!result || result.input !== input) return { status: 'computing', progress: 0 };
  const { input: _job, ...state } = result;
  return state;
}
