/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import './Workspace.css';

export type ViewMode = '2d' | '3d';

type ViewToggleProps = {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
};

/** Segmented 2D / 3D switch shown at the start of each view's toolbar. */
export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <span className="view-toggle" role="group" aria-label="View">
      <button type="button" aria-pressed={view === '2d'} onClick={() => onChange('2d')}>
        2D
      </button>
      <button type="button" aria-pressed={view === '3d'} onClick={() => onChange('3d')}>
        3D
      </button>
    </span>
  );
}
