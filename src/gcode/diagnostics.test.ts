/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Diagnostic } from './diagnostics';
import { groupDiagnostics } from './diagnostics';

const d = (line: number, severity: Diagnostic['severity'], code: Diagnostic['code']): Diagnostic => ({
  line,
  severity,
  code,
  message: `${code} at ${line}`,
});

describe('groupDiagnostics', () => {
  it('is empty for no diagnostics', () => {
    expect(groupDiagnostics([])).toEqual([]);
  });

  it('groups by code with items in line order', () => {
    const groups = groupDiagnostics([d(9, 'warning', 'out-of-bounds'), d(4, 'warning', 'out-of-bounds')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.line)).toEqual([4, 9]);
  });

  it('orders errors, then warnings, then info, and by first line within a severity', () => {
    const groups = groupDiagnostics([
      d(0, 'info', 'no-units'),
      d(7, 'warning', 'unsupported-word'),
      d(12, 'error', 'too-deep'),
      d(3, 'warning', 'out-of-bounds'),
      d(5, 'error', 'syntax'),
    ]);
    expect(groups.map((g) => g.code)).toEqual(['syntax', 'too-deep', 'out-of-bounds', 'unsupported-word', 'no-units']);
  });
});
