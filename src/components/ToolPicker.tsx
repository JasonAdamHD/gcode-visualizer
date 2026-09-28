/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState } from 'react';
import type { MachineParams } from '../machine/params';
import { displayDecimals, formatNumber } from '../machine/params';
import { paramsMatchTool, toolLabel } from '../machine/tools';
import type { ToolLibraryState } from '../state/useToolLibrary';
import './ToolPicker.css';

type ToolPickerProps = {
  params: MachineParams;
  tools: ToolLibraryState;
  /** Cuts with a tool: applies its bit, feeds and spindle speed to the params. */
  onApply: (toolId: string) => void;
};

/** A default name for the params' current bit, e.g. `0.25 in flat up-cut`. */
function describeBit(params: MachineParams): string {
  const { bit, units } = params;
  const shape = bit.shape.kind === 'vbit' ? `${bit.shape.includedAngleDeg}° V-bit` : `${bit.shape.kind}`;
  const flute = bit.flute.kind === 'up' ? 'up-cut' : bit.flute.kind === 'down' ? 'down-cut' : 'compression';
  return `${formatNumber(bit.diameter, displayDecimals(units))} ${units} ${shape} ${flute}`;
}

/**
 * Picks the tool to cut with from the library, and keeps the library in
 * step with the bit fields below it: save the current bit as a new tool,
 * update the picked tool after editing, rename, renumber or delete it.
 */
export function ToolPicker({ params, tools, onApply }: ToolPickerProps) {
  const { library, active } = tools;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edited = active !== null && !paramsMatchTool(params, active);
  const numberTaken = (n: number) => library.tools.some((t) => t.number === n && t.id !== active?.id);

  return (
    <div className="tool-picker">
      <div className="number-field">
        <label htmlFor="tool-select">Tool</label>
        <select
          id="tool-select"
          value={active?.id ?? ''}
          onChange={(e) => {
            setConfirmDelete(false);
            const id = e.target.value || null;
            tools.select(id);
            if (id) onApply(id);
          }}
        >
          <option value="">No tool (bit below)</option>
          {[...library.tools]
            .sort((a, b) => a.number - b.number)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {toolLabel(t)}
              </option>
            ))}
        </select>
      </div>
      {active && (
        <div className="tool-details">
          <label>
            T
            <input
              key={`n-${active.id}-${active.number}`}
              type="number"
              min={1}
              max={999}
              step={1}
              defaultValue={active.number}
              aria-label="Tool number"
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= 999 && !numberTaken(n)) tools.edit(active.id, { number: n });
                else e.target.value = String(active.number);
              }}
            />
          </label>
          <input
            key={`name-${active.id}-${active.name}`}
            type="text"
            defaultValue={active.name}
            aria-label="Tool name"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name) tools.edit(active.id, { name });
              else e.target.value = active.name;
            }}
          />
        </div>
      )}
      <div className="tool-actions">
        {edited && (
          <button type="button" onClick={() => tools.updateFromParams(active.id, params)} title="Save the bit, feeds and spindle speed below into this tool">
            Update T{active.number}
          </button>
        )}
        <button type="button" onClick={() => tools.saveNew(params, describeBit(params))} title="Add the bit below to the library as a new tool">
          Save as new tool
        </button>
        {active &&
          (confirmDelete ? (
            <button
              type="button"
              className="danger"
              onClick={() => {
                tools.remove(active.id);
                setConfirmDelete(false);
              }}
            >
              Delete T{active.number}?
            </button>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ))}
      </div>
      {edited && <p className="derived note">Edited since T{active.number} was picked.</p>}
    </div>
  );
}
