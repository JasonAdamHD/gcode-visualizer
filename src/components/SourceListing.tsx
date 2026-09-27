/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Severity } from '../gcode/diagnostics';
import './SourceListing.css';

/** Row height in px; fixed so the visible rows follow from the scroll offset alone. */
const ROW = 20;
/** Rows rendered above and below the visible ones. */
const OVERSCAN = 12;

type SourceListingProps = {
  lines: string[];
  /** 0-based line of the current move, or null. Highlighted and kept in view. */
  currentLine: number | null;
  /** The most severe diagnostic on each line, if any. */
  markers: Map<number, Severity>;
  onSelectLine: (line: number) => void;
  /** Lines with a breakpoint. */
  breakpoints: Set<number>;
  /** Adds or removes the breakpoint on a line (gutter click). */
  onToggleBreakpoint: (line: number) => void;
  /** Plays until a line is reached (Alt+click). */
  onRunToLine: (line: number) => void;
  /** Scrolls this line into view when it changes (`key` repeats a request for the same line). */
  reveal: { line: number; key: number } | null;
};

/**
 * The program's source with line numbers, virtualized: only the rows in
 * view (plus a margin) are in the DOM, so a 10⁵-line file scrolls smoothly.
 * Clicking the line number toggles a breakpoint; clicking the text jumps
 * there, or with Alt runs playback until it gets there.
 */
export function SourceListing({
  lines,
  currentLine,
  markers,
  onSelectLine,
  breakpoints,
  onToggleBreakpoint,
  onRunToLine,
  reveal,
}: SourceListingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Keeps `line` visible, scrolling it to a third of the way down if it is not.
  const scrollIntoView = (line: number) => {
    const el = ref.current;
    if (!el || el.clientHeight === 0) return;
    const top = line * ROW;
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  };

  useEffect(() => {
    if (currentLine !== null) scrollIntoView(currentLine);
  }, [currentLine]);

  useEffect(() => {
    if (reveal) scrollIntoView(reveal.line);
  }, [reveal]);

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const digits = String(lines.length).length;

  const rows = [];
  for (let i = first; i < last; i++) {
    const severity = markers.get(i);
    const breakpoint = breakpoints.has(i);
    rows.push(
      <div
        key={i}
        className={i === currentLine ? 'source-row current' : 'source-row'}
        style={{ top: i * ROW, height: ROW }}
        aria-current={i === currentLine ? 'step' : undefined}
      >
        <button
          type="button"
          className={breakpoint ? 'source-gutter breakpoint' : 'source-gutter'}
          style={{ width: `${digits + 3}ch` }}
          onClick={() => onToggleBreakpoint(i)}
          aria-pressed={breakpoint}
          aria-label={`Breakpoint on line ${i + 1}`}
          title={breakpoint ? 'Remove breakpoint' : 'Add breakpoint: playback pauses here'}
        >
          <span className="source-breakpoint" />
          <span className="source-number">{i + 1}</span>
        </button>
        <button
          type="button"
          className="source-line"
          onClick={(e) => (e.altKey ? onRunToLine(i) : onSelectLine(i))}
          title="Click to jump here; Alt+click to play until here"
        >
          <span className={severity ? `source-marker severity-${severity}` : 'source-marker'} />
          <code className="source-text">{lines[i]}</code>
        </button>
      </div>
    );
  }

  return (
    <div
      className="source-listing"
      ref={ref}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        setHeight(e.currentTarget.clientHeight);
      }}
    >
      <div className="source-rows" style={{ height: lines.length * ROW }}>
        {rows}
      </div>
    </div>
  );
}
