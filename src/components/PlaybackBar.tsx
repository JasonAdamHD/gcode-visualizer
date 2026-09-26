/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Units } from '../machine/params';
import { displayDecimals } from '../machine/params';
import type { Playback } from '../state/usePlayback';
import { PLAYBACK_SPEEDS } from '../state/usePlayback';
import { formatDuration } from '../toolpath/estimate';
import type { TimelineSample } from '../toolpath/timeline';
import './PlaybackBar.css';

type PlaybackBarProps = {
  playback: Playback;
  /** Job length in seconds. */
  total: number;
  /** Machine state at the playback time. */
  sample: TimelineSample;
  units: Units;
};

const KIND_LABELS: Record<NonNullable<TimelineSample['kind']>, string> = {
  rapid: 'Rapid',
  plunge: 'Plunge',
  feed: 'Cut',
  retract: 'Retract',
};

/** Play/pause, restart, scrubber, speed and a readout of where the bit is. */
export function PlaybackBar({ playback, total, sample, units }: PlaybackBarProps) {
  const { time, playing, speed } = playback;
  const empty = !(total > 0);
  const decimals = displayDecimals(units);
  const coord = (v: number) => v.toFixed(decimals);

  return (
    <div className="toolbar playback-bar">
      <button type="button" onClick={playback.toggle} disabled={empty} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={playback.restart} disabled={empty || time === 0}>
        Restart
      </button>
      <input
        type="range"
        className="playback-scrubber"
        aria-label="Playback position"
        min={0}
        max={empty ? 1 : total}
        step="any"
        value={empty ? 0 : time}
        disabled={empty}
        onChange={(e) => playback.seek(Number(e.target.value))}
      />
      <span className="playback-time">
        {formatDuration(time)} / {formatDuration(total)}
      </span>
      <label>
        Speed
        <select value={speed} onChange={(e) => playback.setSpeed(Number(e.target.value))}>
          {PLAYBACK_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <span className="playback-readout">
        {sample.kind ? KIND_LABELS[sample.kind] : 'Idle'} · X {coord(sample.position.x)} Y {coord(sample.position.y)} Z{' '}
        {coord(sample.position.z)} {units} · F {Math.round(sample.speed * 60)} {units}/min
      </span>
    </div>
  );
}
