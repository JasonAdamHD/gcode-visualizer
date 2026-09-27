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
  | 'no-units'
  | 'rapid-into-material'
  | 'too-deep'
  | 'out-of-bounds'
  | 'no-cut';

/** A problem found in a G-code file. `line` is 0-based, like `Move.sourceLine`; the UI shows it 1-based. */
export type Diagnostic = {
  line: number;
  severity: Severity;
  code: DiagnosticCode;
  message: string;
};

/** Diagnostics sharing a code, for a list that stays short on a 10⁵-line file. */
export type DiagnosticGroup = {
  code: DiagnosticCode;
  severity: Severity;
  /** The group's diagnostics in line order. */
  items: Diagnostic[];
};

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Groups diagnostics by code, errors first, then warnings, then info; within
 * a severity, groups are ordered by their first line.
 */
export function groupDiagnostics(diagnostics: Diagnostic[]): DiagnosticGroup[] {
  const groups = new Map<DiagnosticCode, DiagnosticGroup>();
  for (const d of diagnostics) {
    const group = groups.get(d.code);
    if (group) group.items.push(d);
    else groups.set(d.code, { code: d.code, severity: d.severity, items: [d] });
  }
  const sorted = [...groups.values()];
  for (const g of sorted) g.items.sort((a, b) => a.line - b.line);
  return sorted.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.items[0].line - b.items[0].line
  );
}
