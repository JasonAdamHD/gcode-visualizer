/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MachineParams, Units } from '../machine/params';
import type { Tooling } from '../machine/tooling';
import { unitFactor } from '../machine/params';
import type { ExactCutInput } from '../sim/exactCut';
import { MAX_EXACT_STROKES, cuttingSegmentsByTool, segmentsKey } from '../sim/exactCut';
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
  tooling: Tooling,
  units: Units,
  enabled: boolean
): ExactCut {
  const mm = unitFactor('mm', units);
  const { segments, tools } = useMemo(
    () => cuttingSegmentsByTool(timeline.blocks, ARC_TOLERANCE_MM * mm, (i) => tooling.ofMove[timeline.blocks[i].move] ?? 0),
    [timeline, tooling, mm]
  );
  // The bits as the solve sees them (diameter and shape only).
  const bitsJson = JSON.stringify(tooling.bits.map((b) => ({ diameter: b.diameter, shape: b.shape })));
  // The timeline is rebuilt on any params change (a feed rate, say), but the
  // job only changes when the geometry does: segments with the same contents
  // keep the earlier array, adjusted during render so no stale job starts.
  const key = useMemo(() => `${segmentsKey(segments)}|${segmentsKey(tools)}|${bitsJson}`, [segments, tools, bitsJson]);
  const [kept, setKept] = useState({ key, segments, tools, bitsJson });
  if (kept.key !== key) setKept({ key, segments, tools, bitsJson });
  const job = kept.key === key ? kept : { segments, tools, bitsJson };
  const input = useMemo<ExactCutInput>(
    () => ({
      sheet: { x: sheet.x, y: sheet.y, thickness: sheet.thickness },
      bits: JSON.parse(job.bitsJson),
      segments: job.segments,
      tools: job.tools,
      tolerance: BIT_TOLERANCE_MM * mm,
    }),
    [job.segments, job.tools, job.bitsJson, sheet.x, sheet.y, sheet.thickness, mm]
  );
  const moves = input.segments.length / 6;
  const skipped = moves > MAX_EXACT_STROKES;
  const [result, setResult] = useState<Result | null>(null);
  // The job the last finished mesh belongs to: showing the stock again does not redo it.
  const readyFor = useRef<ExactCutInput | null>(null);

  useEffect(() => {
    if (!enabled || skipped || readyFor.current === input) return;
    let worker: Worker | null = null;
    const timer = setTimeout(() => {
      worker = new Worker(new URL('../workers/exactCut.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<ExactCutReply>) => {
        const reply = e.data;
        if (reply.type === 'progress') setResult({ input, status: 'computing', progress: reply.fraction });
        else if (reply.type === 'done') {
          readyFor.current = input;
          setResult({ input, status: 'ready', positions: reply.positions, indices: reply.indices });
        }
        else setResult({ input, status: 'failed', message: reply.message });
      };
      worker.onerror = (e) => setResult({ input, status: 'failed', message: e.message || 'The exact cut worker stopped' });
      // A copy of the segments: the memoized input stays usable here.
      worker.postMessage({ ...input, segments: input.segments.slice(), tools: input.tools?.slice() });
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
