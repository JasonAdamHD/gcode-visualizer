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
};

/** Problems list and source listing for an open program; both jump playback to a line. */
export function ProgramPane({ lines, diagnostics, currentLine, onSelectLine }: ProgramPaneProps) {
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
        <h2>Problems</h2>
        <DiagnosticsList diagnostics={diagnostics} onSelectLine={selectDiagnostic} />
      </section>
      <section className="program-source">
        <h2>Source</h2>
        <SourceListing
          lines={lines}
          currentLine={currentLine}
          markers={markers}
          onSelectLine={onSelectLine}
          reveal={reveal}
        />
      </section>
    </aside>
  );
}
