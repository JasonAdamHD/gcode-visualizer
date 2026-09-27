/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import type { Diagnostic, DiagnosticCode, Severity } from '../gcode/diagnostics';
import { groupDiagnostics } from '../gcode/diagnostics';
import './DiagnosticsList.css';

/** Rows shown when a group is expanded; the rest are summarized. */
const MAX_ROWS = 200;

const LABELS: Record<DiagnosticCode, string> = {
  syntax: 'Syntax errors',
  'duplicate-word': 'Repeated words',
  'modal-conflict': 'Conflicting G-codes',
  'unsupported-word': 'Unsupported words (ignored)',
  'unused-word': 'Unused I/J/R',
  'missing-feed': 'Cut before any F',
  'invalid-feed': 'Invalid feed rate',
  'arc-missing-center': 'Arc without I/J/R',
  'arc-zero-radius': 'Arc with zero radius',
  'arc-radius-mismatch': 'Arc radius mismatch',
  'arc-radius-too-small': 'Arc radius too small',
  'arc-full-circle-r': 'Full circle by R',
  'arc-plane': 'Arc outside the XY plane',
  'unit-change': 'Unit changes',
  'no-units': 'No units set',
  'rapid-into-material': 'Rapid into material',
  'too-deep': 'Too deep',
  'out-of-bounds': 'Off the sheet',
  'no-cut': 'Nothing cut',
};

const SEVERITY_LABELS: Record<Severity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };

/**
 * Diagnostics grouped by code, errors first, each group a disclosure with
 * its count that expands to its lines (1-based) and messages.
 */
export function DiagnosticsList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const groups = useMemo(() => groupDiagnostics(diagnostics), [diagnostics]);
  if (groups.length === 0) return <p className="derived">No problems found.</p>;

  return (
    <ul className="diagnostics">
      {groups.map((group) => (
        <li key={group.code}>
          <details>
            <summary>
              <span className={`severity severity-${group.severity}`} title={SEVERITY_LABELS[group.severity]}>
                <span className="visually-hidden">{SEVERITY_LABELS[group.severity]}: </span>
              </span>
              <span className="diagnostic-label">{LABELS[group.code]}</span>
              <span className="diagnostic-count">{group.items.length}</span>
            </summary>
            <ol className="diagnostic-rows">
              {group.items.slice(0, MAX_ROWS).map((d, i) => (
                <li key={i}>
                  {d.line >= 0 && <span className="diagnostic-line">Line {d.line + 1}</span>} {d.message}
                </li>
              ))}
              {group.items.length > MAX_ROWS && <li className="diagnostic-more">+{group.items.length - MAX_ROWS} more</li>}
            </ol>
          </details>
        </li>
      ))}
    </ul>
  );
}
