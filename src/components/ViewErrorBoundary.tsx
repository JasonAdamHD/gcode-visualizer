/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Component } from 'react';
import type { ReactNode } from 'react';
import './Workspace.css';

type ViewErrorBoundaryProps = {
  /** The 2D/3D switch, kept usable so the user can leave a broken view. */
  viewToggle: ReactNode;
  children: ReactNode;
};

type ViewErrorBoundaryState = { error: Error | null };

/**
 * Contains a failure of the 3D view (its chunk failing to load, or WebGL
 * setup throwing) to the view area, so the rest of the app and the drawing
 * survive and the user can switch back to 2D.
 */
export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="canvas-workspace">
        <div className="toolbar">{this.props.viewToggle}</div>
        <p className="view-error">
          The 3D view could not be opened ({this.state.error.message}). Switch back to 2D, or reload the page to try
          again.
        </p>
      </div>
    );
  }
}
