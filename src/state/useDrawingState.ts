/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useMemo, useState } from 'react';
import type { Path, Point, Segment } from '../geometry/segment';
import { bulgeFromDrag, isPathClosed, pathLength, pointsEqual, scalePath, scalePoint } from '../geometry/segment';

type DrawingState = {
  segments: Path;
  draftStart: Point | null;
};

const EMPTY_STATE: DrawingState = { segments: [], draftStart: null };

type DragHandle = {
  segmentIndex: number;
  point: Point | null;
  base: DrawingState;
};

export function useDrawingState() {
  const [history, setHistory] = useState<DrawingState[]>([EMPTY_STATE]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [drag, setDrag] = useState<DragHandle | null>(null);

  const state = history[historyIndex];

  const commit = useCallback(
    (next: DrawingState) => {
      setHistory((prev) => [...prev.slice(0, historyIndex + 1), next]);
      setHistoryIndex((i) => i + 1);
    },
    [historyIndex]
  );

  const placePoint = useCallback(
    (point: Point) => {
      if (isPathClosed(state.segments)) return;
      if (!state.draftStart) {
        commit({ segments: state.segments, draftStart: point });
        return;
      }
      if (pointsEqual(state.draftStart, point)) return;
      const segment: Segment = { type: 'line', start: state.draftStart, end: point, bulge: 0 };
      commit({ segments: [...state.segments, segment], draftStart: point });
    },
    [state, commit]
  );

  const deleteLast = useCallback(() => {
    if (state.segments.length > 0) {
      const removed = state.segments[state.segments.length - 1];
      commit({ segments: state.segments.slice(0, -1), draftStart: removed.start });
    } else if (state.draftStart) {
      commit({ segments: [], draftStart: null });
    }
  }, [state, commit]);

  const closePath = useCallback(() => {
    if (state.segments.length < 2 || !state.draftStart) return;
    const first = state.segments[0].start;
    if (pointsEqual(first, state.draftStart)) return;
    const segment: Segment = { type: 'line', start: state.draftStart, end: first, bulge: 0 };
    commit({ segments: [...state.segments, segment], draftStart: first });
  }, [state, commit]);

  const reset = useCallback(() => commit(EMPTY_STATE), [commit]);

  const undo = useCallback(() => setHistoryIndex((i) => Math.max(0, i - 1)), []);
  const redo = useCallback(
    () => setHistoryIndex((i) => Math.min(history.length - 1, i + 1)),
    [history.length]
  );

  /**
   * Uniformly scales every snapshot in history (e.g. by 25.4 on an in -> mm
   * switch) without adding an entry or moving the index. Units live outside
   * drawing history, so an undoable rescale would let undo put inch geometry
   * on a millimeter sheet. Cancels any in-progress arc drag.
   */
  const rescale = useCallback((factor: number) => {
    if (factor === 1) return;
    setHistory((prev) =>
      prev.map((snap) => ({
        segments: scalePath(snap.segments, factor),
        draftStart: snap.draftStart ? scalePoint(snap.draftStart, factor) : null,
      }))
    );
    setDrag(null);
  }, []);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const beginDrag = useCallback(
    (segmentIndex: number) => {
      setDrag({ segmentIndex, point: null, base: state });
    },
    [state]
  );

  const updateDrag = useCallback((point: Point) => {
    setDrag((d) => (d ? { ...d, point } : d));
  }, []);

  const endDrag = useCallback(() => {
    if (drag && drag.point) {
      const { base } = drag;
      const segment = base.segments[drag.segmentIndex];
      const bulge = bulgeFromDrag(segment.start, segment.end, drag.point);
      const nextSegments = base.segments.map((s, i) =>
        i === drag.segmentIndex ? { ...s, bulge, type: (bulge ? 'arc' : 'line') as Segment['type'] } : s
      );
      commit({ segments: nextSegments, draftStart: base.draftStart });
    }
    setDrag(null);
  }, [drag, commit]);

  const displaySegments = useMemo((): Path => {
    if (!drag || !drag.point) return state.segments;
    const { base } = drag;
    const bulge = bulgeFromDrag(
      base.segments[drag.segmentIndex].start,
      base.segments[drag.segmentIndex].end,
      drag.point
    );
    return base.segments.map((s, i) => (i === drag.segmentIndex ? { ...s, bulge } : s));
  }, [state.segments, drag]);

  const closed = isPathClosed(displaySegments);
  const totalLength = useMemo(() => pathLength(displaySegments), [displaySegments]);

  return {
    segments: displaySegments,
    draftStart: state.draftStart,
    placePoint,
    deleteLast,
    closePath,
    reset,
    undo,
    redo,
    rescale,
    canUndo,
    canRedo,
    beginDrag,
    updateDrag,
    endDrag,
    isDragging: drag !== null,
    dragSegmentIndex: drag?.segmentIndex ?? null,
    closed,
    totalLength,
  };
}
