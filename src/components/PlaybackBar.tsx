/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Units } from '../machine/params';
import { displayDecimals } from '../machine/params';
import {
  MAX_SPEED,
  MIN_SPEED,
  PLAYBACK_SPEEDS,
  SPEED_STEP_OCTAVES,
  formatSpeed,
  speedFromSlider,
} from '../state/playbackSpeed';
import type { Playback } from '../state/usePlayback';
import { formatDuration } from '../toolpath/estimate';
import type { ScrubberTick } from '../toolpath/scrubber';
import { BAND_CUT, BAND_RAPID, BAND_VERTICAL, scrubberBands } from '../toolpath/scrubber';
import type { Timeline, TimelineSample } from '../toolpath/timeline';
import './PlaybackBar.css';

type PlaybackBarProps = {
  playback: Playback;
  timeline: Timeline;
  /** Machine state at the playback time. */
  sample: TimelineSample;
  units: Units;
  /** Problems to mark along the scrubber. */
  ticks?: ScrubberTick[];
  /** Breakpoint times to mark along the scrubber. */
  breakpoints?: Float64Array;
  /** Jumps to the previous (−1) or next (1) move; the step buttons are shown only with it. */
  onStep?: (direction: 1 | -1) => void;
};

const KIND_LABELS: Record<NonNullable<TimelineSample['kind']>, string> = {
  rapid: 'Rapid',
  plunge: 'Plunge',
  feed: 'Cut',
  retract: 'Retract',
};

const NO_TICKS: ScrubberTick[] = [];
const NO_BREAKPOINTS = new Float64Array();

/** Play/pause, restart, scrubber with markers, speed and a readout of where the bit is. */
export function PlaybackBar({
  playback,
  timeline,
  sample,
  units,
  ticks = NO_TICKS,
  breakpoints = NO_BREAKPOINTS,
  onStep,
}: PlaybackBarProps) {
  const { time, playing, speed } = playback;
  const total = timeline.total;
  const empty = !(total > 0);
  const decimals = displayDecimals(units);
  const coord = (v: number) => v.toFixed(decimals);
  const detents = useId();

  return (
    <div className="toolbar playback-bar">
      <button type="button" onClick={playback.toggle} disabled={empty} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={playback.restart} disabled={empty || time === 0} title="Back to the start (Home)">
        Restart
      </button>
      {onStep && (
        <>
          <button type="button" onClick={() => onStep(-1)} disabled={empty} title="Previous move (←; Shift+← for one block)">
            ◀ Move
          </button>
          <button type="button" onClick={() => onStep(1)} disabled={empty} title="Next move (→; Shift+→ for one block)">
            Move ▶
          </button>
        </>
      )}
      <div className="playback-scrubber">
        <input
          type="range"
          aria-label="Playback position"
          min={0}
          max={empty ? 1 : total}
          step="any"
          value={empty ? 0 : time}
          disabled={empty}
          onChange={(e) => playback.seek(Number(e.target.value))}
        />
        <ScrubberMarks timeline={timeline} ticks={ticks} breakpoints={breakpoints} />
      </div>
      <span className="playback-time">
        {formatDuration(time)} / {formatDuration(total)}
      </span>
      <label className="playback-speed" title="Playback speed (+ and − double and halve it)">
        Speed
        <input
          type="range"
          aria-label="Playback speed"
          min={Math.log2(MIN_SPEED)}
          max={Math.log2(MAX_SPEED)}
          step={SPEED_STEP_OCTAVES}
          list={detents}
          value={Math.log2(speed)}
          onChange={(e) => playback.setSpeed(speedFromSlider(Number(e.target.value)))}
        />
        <span className="playback-speed-value">{formatSpeed(speed)}×</span>
      </label>
      <datalist id={detents}>
        {PLAYBACK_SPEEDS.map((s) => (
          <option key={s} value={Math.log2(s)} label={`${s}×`} />
        ))}
      </datalist>
      <span className="playback-readout">
        {sample.kind ? KIND_LABELS[sample.kind] : 'Idle'} · X {coord(sample.position.x)} Y {coord(sample.position.y)} Z{' '}
        {coord(sample.position.z)} {units} · F {Math.round(sample.speed * 60)} {units}/min
      </span>
    </div>
  );
}

/** Colors for the marks, from the theme. */
function markColors(el: HTMLElement) {
  const style = getComputedStyle(el);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    [BAND_RAPID]: v('--text', '#6b6375'),
    [BAND_VERTICAL]: v('--accent', '#7a3bff'),
    [BAND_CUT]: v('--toolpath', '#0e8f7e'),
    error: v('--severity-error', '#d93a3a'),
    warning: v('--severity-warning', '#c27c0e'),
    info: v('--severity-info', '#3b82f6'),
    breakpoint: v('--breakpoint', '#e11d48'),
  };
}

/**
 * A strip under the scrubber: the dominant motion over time as colored
 * bands (one bin per pixel), problem ticks and breakpoint markers. One
 * canvas draw however long the program is.
 */
function ScrubberMarks({
  timeline,
  ticks,
  breakpoints,
}: {
  timeline: Timeline;
  ticks: ScrubberTick[];
  breakpoints: Float64Array;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [scheme, setScheme] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => setScheme((n) => n + 1);
    media.addEventListener('change', onScheme);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', onScheme);
    };
  }, []);

  const bands = useMemo(() => scrubberBands(timeline, width), [timeline, width]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const total = timeline.total;
    if (!(total > 0)) return;
    const colors = markColors(canvas);

    // Bands along the bottom half; rapids fainter so cutting stands out.
    const bin = width / bands.length;
    for (let k = 0; k < bands.length; k++) {
      const code = bands[k] as typeof BAND_RAPID | typeof BAND_VERTICAL | typeof BAND_CUT | 0;
      if (code === 0) continue;
      ctx.globalAlpha = code === BAND_RAPID ? 0.35 : 0.9;
      ctx.fillStyle = colors[code];
      ctx.fillRect(k * bin, height / 2, Math.ceil(bin), height / 2);
    }
    ctx.globalAlpha = 1;

    const x = (t: number) => Math.min(width - 1, Math.max(0, Math.round((t / total) * width)));
    for (const tick of ticks) {
      ctx.fillStyle = colors[tick.severity];
      ctx.fillRect(x(tick.time) - 1, 0, 2, height);
    }
    ctx.fillStyle = colors.breakpoint;
    for (const t of breakpoints) {
      ctx.beginPath();
      ctx.arc(x(t), height / 4, height / 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }, [bands, ticks, breakpoints, width, scheme, timeline.total]);

  return <canvas ref={ref} className="playback-marks" aria-hidden="true" />;
}
