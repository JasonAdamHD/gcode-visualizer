/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useRef, useState } from 'react';
import type { Diagnostic, Severity } from '../gcode/diagnostics';
import { DiagnosticsList } from './DiagnosticsList';
import { SourceListing } from './SourceListing';
import './ProgramPane.css';

const RANK: Record<Severity, number> = { info: 1, warning: 2, error: 3 };

type ProgramPaneProps = {
  lines: string[];
  diagnostics: Diagnostic[];
  /** 0-based line of the current move, or null. */
  currentLine: number | null;
  /** Jumps playback to a line (its first move, or the next line that moves). */
  onSelectLine: (line: number) => void;
  /** Plays until a line is reached. */
  onRunToLine: (line: number) => void;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  /** Whether playback also pauses at every problem. */
  stopAtProblems: boolean;
  onStopAtProblemsChange: (on: boolean) => void;
  /** Line of the first problem after the playback time, or null when there is none. */
  nextProblemLine: number | null;
};

/**
 * Problems list and source listing for an open program; both jump playback
 * to a line. Breakpoints and "Stop at problems" pause playback.
 */
export function ProgramPane({
  lines,
  diagnostics,
  currentLine,
  onSelectLine,
  onRunToLine,
  breakpoints,
  onToggleBreakpoint,
  stopAtProblems,
  onStopAtProblemsChange,
  nextProblemLine,
}: ProgramPaneProps) {
  const [reveal, setReveal] = useState<{ line: number; key: number } | null>(null);
  const requests = useRef(0);

  const markers = useMemo(() => {
    const map = new Map<number, Severity>();
    for (const d of diagnostics) {
      const prev = map.get(d.line);
      if (!prev || RANK[d.severity] > RANK[prev]) map.set(d.line, d.severity);
    }
    return map;
  }, [diagnostics]);

  // A diagnostic's own line may have no moves; show it anyway, then seek.
  const selectDiagnostic = (line: number) => {
    setReveal({ line, key: ++requests.current });
    onSelectLine(line);
  };

  return (
    <aside className="program-pane" aria-label="Program">
      <section className="program-problems">
        <div className="program-problems-header">
          <h2>Problems</h2>
          {diagnostics.length > 0 && (
            <>
              <label title="Pause playback at every line with a problem">
                <input
                  type="checkbox"
                  checked={stopAtProblems}
                  onChange={(e) => onStopAtProblemsChange(e.target.checked)}
                />{' '}
                Stop at problems
              </label>
              <button
                type="button"
                disabled={nextProblemLine === null}
                onClick={() => nextProblemLine !== null && selectDiagnostic(nextProblemLine)}
                title="Jump to the next problem after the current time"
              >
                Next problem
              </button>
            </>
          )}
        </div>
        <DiagnosticsList diagnostics={diagnostics} onSelectLine={selectDiagnostic} />
      </section>
      <section className="program-source">
        <h2>Source</h2>
        <SourceListing
          lines={lines}
          currentLine={currentLine}
          markers={markers}
          onSelectLine={onSelectLine}
          breakpoints={breakpoints}
          onToggleBreakpoint={onToggleBreakpoint}
          onRunToLine={onRunToLine}
          reveal={reveal}
        />
      </section>
    </aside>
  );
}
