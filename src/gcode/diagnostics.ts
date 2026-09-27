/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type Severity = 'error' | 'warning' | 'info';

/** Stable identifiers for diagnostics, so the UI can group them. */
export type DiagnosticCode =
  | 'syntax'
  | 'duplicate-word'
  | 'modal-conflict'
  | 'unsupported-word'
  | 'unused-word'
  | 'missing-feed'
  | 'invalid-feed'
  | 'arc-missing-center'
  | 'arc-zero-radius'
  | 'arc-radius-mismatch'
  | 'arc-radius-too-small'
  | 'arc-full-circle-r'
  | 'arc-plane'
  | 'unit-change'
  | 'no-units';

/** A problem found in a G-code file. `line` is 0-based, like `Move.sourceLine`; the UI shows it 1-based. */
export type Diagnostic = {
  line: number;
  severity: Severity;
  code: DiagnosticCode;
  message: string;
};
