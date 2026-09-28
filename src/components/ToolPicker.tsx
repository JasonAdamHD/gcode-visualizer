/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { readToolFile } from '../machine/fusionTools';
import type { MachineParams } from '../machine/params';
import { displayDecimals, formatNumber } from '../machine/params';
import { paramsMatchTool, serializeLibrary, toolLabel } from '../machine/tools';
import type { ToolLibraryState } from '../state/useToolLibrary';
import './ToolPicker.css';

type ToolPickerProps = {
  params: MachineParams;
  tools: ToolLibraryState;
  /** Cuts with a tool: applies its bit, feeds and spindle speed to the params. */
  onApply: (toolId: string) => void;
};

const EXPORT_FILENAME = 'cnc-tools.json';

/** What an import did, for the panel: a headline and the details. */
type ImportSummary = { ok: boolean; headline: string; details: string[] };

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
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const read = readToolFile(await file.text());
    if (!read.ok) {
      setSummary({ ok: false, headline: `Could not import ${file.name}: ${read.error}`, details: [] });
      return;
    }
    const merged = tools.importTools(read.import.tools);
    const source = read.format === 'fusion' ? 'Fusion library' : 'tool library';
    const parts = [`${merged.added} added`, `${merged.updated} updated`];
    setSummary({
      ok: true,
      headline: `Imported ${file.name} (${source}): ${parts.join(', ')}.`,
      details: [
        ...merged.renumbered.map((t) => `${t.name}: numbered T${t.number} (its number was missing or taken)`),
        ...read.import.skipped.map((t) => `Skipped ${t.name}: ${t.reason}`),
        ...merged.ignored.map((t) => `Skipped ${t.name}: ${t.reason}`),
        ...read.import.notes,
      ],
    });
  };

  const handleExport = () => {
    const blob = new Blob([serializeLibrary(library)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_FILENAME;
    a.click();
    // Some browsers resolve the blob URL asynchronously; revoke after the download starts.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
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
      <div className="tool-actions">
        <button type="button" onClick={() => fileRef.current?.click()} title="Add tools from this app's tool file or a Fusion tool library (.json)">
          Import tools…
        </button>
        <button type="button" onClick={handleExport} disabled={library.tools.length === 0} title="Download the library as a .json file">
          Export tools
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={handleImport} />
      </div>
      {summary && (
        <div className={summary.ok ? 'tool-import' : 'tool-import failed'} role="status">
          <p>{summary.headline}</p>
          {summary.details.length > 0 && (
            <ul>
              {summary.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <button type="button" className="link" onClick={() => setSummary(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
