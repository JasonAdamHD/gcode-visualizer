/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Diagnostic } from '../gcode/diagnostics';
import { firstMoveByLine } from '../gcode/step';
import type { MachineParams } from '../machine/params';
import { usePlayback } from '../state/usePlayback';
import type { CutTimeEstimate } from '../toolpath/estimate';
import type { Move } from '../toolpath/moves';
import { chipLoad, chipsPerSecond, cutConditions, rateChipLoad } from '../toolpath/chipLoad';
import { diagnosticTicks } from '../toolpath/scrubber';
import { stopTimes } from '../toolpath/stops';
import {
  adjacentBlockTime,
  adjacentMoveTime,
  buildTimeline,
  moveBlockStarts,
  sampleTimeline,
} from '../toolpath/timeline';
import { ignoreShortcut } from './keyboard';
import { PlaybackBar } from './PlaybackBar';
import { ProgramPane } from './ProgramPane';
import { ProgramView } from './ProgramView';
import { ViewErrorBoundary } from './ViewErrorBoundary';
import type { ViewMode } from './ViewToggle';

// Three.js is only downloaded once the 3D view is first opened.
const Viewer3D = lazy(() => import('./Viewer3D'));

/** An open program, as the workspace needs it. */
export type WorkspaceProgram = {
  fileName: string;
  /** Source lines, numbered like `Move.sourceLine`. */
  lines: string[];
  diagnostics: Diagnostic[];
};

type PlaybackWorkspaceProps = {
  view: ViewMode;
  viewToggle: ReactNode;
  moves: Move[];
  params: MachineParams;
  estimate: CutTimeEstimate;
  /** The open program, or null when playing the drawing's moves (3D only). */
  program: WorkspaceProgram | null;
};

const NO_LINES: number[] = [];

/**
 * Everything that follows the playback clock: the 3D view, the 2D program
 * view and the program pane (problems and source listing). It owns one
 * clock, so all of them agree on the current move, and only this part of
 * the page re-renders while playing.
 *
 * Keys: Space plays and pauses, Home and End jump to the ends, + and −
 * double and halve the speed, Shift+← and Shift+→ step one planner block.
 * With a program open, ← and → step between moves, clicking a line or a
 * problem seeks to it, and breakpoints (and optionally every problem)
 * pause playback. Breakpoints last until another file is opened.
 */
export function PlaybackWorkspace({ view, viewToggle, moves, params, estimate, program }: PlaybackWorkspaceProps) {
  const timeline = useMemo(() => buildTimeline(moves, params), [moves, params]);

  const blockStarts = useMemo(() => moveBlockStarts(timeline), [timeline]);
  const lineCount = program?.lines.length ?? 0;
  const lineMoves = useMemo(() => firstMoveByLine(moves, lineCount), [moves, lineCount]);

  // Breakpoints belong to the open file: a new file starts without any.
  const [breakpoints, setBreakpoints] = useState<Set<number>>(() => new Set());
  const [stopAtProblems, setStopAtProblems] = useState(false);
  const [breakpointsFor, setBreakpointsFor] = useState(program?.lines);
  if (program?.lines !== breakpointsFor) {
    setBreakpointsFor(program?.lines);
    setBreakpoints(new Set());
  }
  const toggleBreakpoint = useCallback(
    (line: number) =>
      setBreakpoints((prev) => {
        const next = new Set(prev);
        if (!next.delete(line)) next.add(line);
        return next;
      }),
    []
  );

  const diagnostics = program?.diagnostics;
  const problemLines = useMemo(() => diagnostics?.map((d) => d.line) ?? NO_LINES, [diagnostics]);
  const breakpointTimes = useMemo(() => stopTimes(timeline, lineMoves, breakpoints), [timeline, lineMoves, breakpoints]);
  const stops = useMemo(
    () => (stopAtProblems ? stopTimes(timeline, lineMoves, [...breakpoints, ...problemLines]) : breakpointTimes),
    [stopAtProblems, timeline, lineMoves, breakpoints, problemLines, breakpointTimes]
  );
  const ticks = useMemo(
    () => (diagnostics ? diagnosticTicks(timeline, lineMoves, diagnostics) : undefined),
    [timeline, lineMoves, diagnostics]
  );

  const playback = usePlayback(timeline.total, timeline, stops);
  const sample = useMemo(() => sampleTimeline(timeline, playback.time), [timeline, playback.time]);

  // Step-through highlights only apply to programs; drawing playback is unchanged.
  const moveIndex = program ? sample.moveIndex : -1;
  const currentMove = moveIndex >= 0 ? moves[moveIndex] : null;
  const currentBlocks = useMemo(
    () =>
      moveIndex >= 0
        ? { first: blockStarts[moveIndex], count: blockStarts[moveIndex + 1] - blockStarts[moveIndex] }
        : null,
    [moveIndex, blockStarts]
  );
  const currentLine = currentMove?.sourceLine ?? null;

  // The first problem line whose time is after now, for "Next problem".
  const nextProblemLine = useMemo(() => {
    let best: { time: number; line: number } | null = null;
    for (const line of problemLines) {
      const m = lineMoves[line] ?? -1;
      if (m < 0) continue;
      const time = timeline.moveStart[m];
      if (time > playback.time + 1e-9 && (!best || time < best.time || (time === best.time && line < best.line))) {
        best = { time, line };
      }
    }
    return best?.line ?? null;
  }, [problemLines, lineMoves, timeline, playback.time]);

  const { seek, toggle, time, runTo, scaleSpeed } = playback;
  const step = useCallback(
    (direction: 1 | -1) => {
      const t = adjacentMoveTime(timeline, time, direction);
      if (t !== null) seek(t);
    },
    [timeline, time, seek]
  );
  const selectLine = useCallback(
    (line: number) => {
      const m = lineMoves[line] ?? -1;
      if (m >= 0) seek(timeline.moveStart[m]);
    },
    [lineMoves, timeline, seek]
  );
  const runToLine = useCallback(
    (line: number) => {
      const m = lineMoves[line] ?? -1;
      if (m >= 0) runTo(timeline.moveStart[m]);
    },
    [lineMoves, timeline, runTo]
  );

  const stepping = program !== null;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (ignoreShortcut(e)) return;
      // A focused button handles Space itself.
      if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        seek(e.key === 'Home' ? 0 : timeline.total);
      } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
        e.preventDefault();
        scaleSpeed(e.key === '+' || e.key === '=' ? 2 : 0.5);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const direction = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) {
          e.preventDefault();
          const t = adjacentBlockTime(timeline, time, direction);
          if (t !== null) seek(t);
        } else if (stepping) {
          e.preventDefault();
          step(direction);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle, seek, step, stepping, timeline, time, scaleSpeed]);

  const onStep = stepping ? step : undefined;
  // Chip load of the move being played, when it cuts.
  const playedMove = sample.moveIndex >= 0 ? moves[sample.moveIndex] : undefined;
  const conditions = playedMove ? cutConditions(playedMove, params) : null;
  const flutes = params.bit.fluteCount;
  const load = conditions ? chipLoad(conditions.feedRate, conditions.rpm, flutes) : null;
  const chipLoadInfo = conditions
    ? {
        load,
        // The band is for side cutting; plunging normally runs lighter, so it is not rated.
        rating: load === null || playedMove?.kind === 'plunge' ? null : rateChipLoad(load, params.bit.diameter),
        perSecond: chipsPerSecond(conditions.rpm, flutes),
      }
    : null;

  const playbackBar = (
    <PlaybackBar
      playback={playback}
      timeline={timeline}
      sample={sample}
      units={params.units}
      ticks={ticks}
      breakpoints={breakpointTimes}
      onStep={onStep}
      chipLoad={chipLoadInfo}
    />
  );

  return (
    <>
      {view === '3d' ? (
        <ViewErrorBoundary viewToggle={viewToggle}>
          <Suspense fallback={<div className="canvas-workspace view-loading">Loading 3D view…</div>}>
            <Viewer3D
              moves={moves}
              params={params}
              estimate={estimate}
              viewToggle={viewToggle}
              timeline={timeline}
              sample={sample}
              currentMove={currentBlocks}
              playbackBar={playbackBar}
              stepping={stepping}
              atEnd={timeline.total > 0 && playback.time >= timeline.total}
              playing={playback.playing}
            />
          </Suspense>
        </ViewErrorBoundary>
      ) : (
        program && (
          <ProgramView
            moves={moves}
            sheet={params.sheet}
            fileName={program.fileName}
            lineCount={lineCount}
            estimate={estimate}
            viewToggle={viewToggle}
            sample={sample}
            currentMove={currentMove}
            playbackBar={playbackBar}
          />
        )
      )}
      {program && (
        <ProgramPane
          lines={program.lines}
          diagnostics={program.diagnostics}
          currentLine={currentLine}
          onSelectLine={selectLine}
          onRunToLine={runToLine}
          breakpoints={breakpoints}
          onToggleBreakpoint={toggleBreakpoint}
          stopAtProblems={stopAtProblems}
          onStopAtProblemsChange={setStopAtProblems}
          nextProblemLine={nextProblemLine}
        />
      )}
    </>
  );
}
