/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { BitKind, BitShape, FieldKey, MachineParams, Units } from '../machine/params';
import { displayDecimals, formatNumber, parseParams, serializeParams, validateParams } from '../machine/params';
import type { CutTimeEstimate } from '../toolpath/estimate';
import { formatDuration } from '../toolpath/estimate';
import { passDepths } from '../toolpath/moves';
import type { CutSide } from '../toolpath/offset';
import type { Toolpath } from '../toolpath/toolpath';
import { NumberField } from './NumberField';
import './ParametersPanel.css';

type ParametersPanelProps = {
  params: MachineParams;
  update: (updater: (prev: MachineParams) => MachineParams) => void;
  toolpath: Toolpath;
  estimate: CutTimeEstimate;
  /** Whether the drawn path is closed; picks which cut sides are offered. */
  closed: boolean;
  /** Current cut side, already valid for `closed`. */
  cutSide: CutSide;
  onCutSideChange: (side: CutSide) => void;
  /** Switches units; the caller also rescales the drawing. */
  onUnitsChange: (units: Units) => void;
  /** Applies imported params; the caller also rescales the drawing if units differ. */
  onImport: (params: MachineParams) => void;
  onReset: () => void;
  open: boolean;
  onToggle: () => void;
};

const BIT_LABELS: Record<BitKind, string> = {
  flat: 'Flat end',
  ball: 'Ball end',
  vbit: 'V-bit',
};

const CLOSED_SIDES: [CutSide, string][] = [
  ['outside', 'Outside'],
  ['inside', 'Inside'],
  ['on', 'On line'],
];
const OPEN_SIDES: [CutSide, string][] = [
  ['left', 'Left'],
  ['right', 'Right'],
  ['on', 'On line'],
];

const DEFAULT_VBIT_ANGLE = 90;
const EXPORT_FILENAME = 'cnc-params.json';

function shapeFor(kind: BitKind, current: BitShape): BitShape {
  if (kind === current.kind) return current;
  return kind === 'vbit' ? { kind: 'vbit', includedAngleDeg: DEFAULT_VBIT_ANGLE } : { kind };
}

/** Sidebar for editing machine/job parameters. */
export function ParametersPanel({
  params,
  update,
  toolpath,
  estimate,
  closed,
  cutSide,
  onCutSideChange,
  onUnitsChange,
  onImport,
  onReset,
  open,
  onToggle,
}: ParametersPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileMessage, setFileMessage] = useState<{ error: boolean; text: string } | null>(null);
  const { units } = params;
  const decimals = displayDecimals(units);
  const rate = `${units}/min`;
  const totalDepth = params.sheet.thickness + params.spoilboardPenetration;
  const passCount = passDepths(totalDepth, params.depthPerPass).length;

  /** Renders a NumberField bound to one params field via a pure setter. */
  const field = (
    key: FieldKey,
    label: string,
    value: number,
    set: (p: MachineParams, v: number) => MachineParams,
    suffix: string | undefined = units,
    fieldDecimals = decimals
  ) => (
    <NumberField
      label={label}
      value={value}
      suffix={suffix}
      decimals={fieldDecimals}
      validate={(v) => validateParams(set(params, v))[key]}
      onCommit={(v) => update((p) => set(p, v))}
    />
  );

  const handleExport = () => {
    const blob = new Blob([serializeParams(params)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_FILENAME;
    a.click();
    // Some browsers resolve the blob URL asynchronously; revoke after the download starts.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setFileMessage(null);
  };

  // Parsing stays in the browser; a failed import changes nothing.
  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // allow re-importing the same file
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileMessage({ error: true, text: `Couldn't read ${file.name}` });
      return;
    }
    const result = parseParams(text);
    if (!result.ok) {
      setFileMessage({ error: true, text: `Couldn't import ${file.name}: ${result.error}` });
      return;
    }
    onImport(result.params);
    setFileMessage({ error: false, text: `Imported ${file.name}` });
  };

  const handleReset = () => {
    if (!window.confirm('Reset all parameters to their defaults?')) return;
    onReset();
    setFileMessage(null);
  };

  if (!open) {
    return (
      <aside className="params-panel collapsed">
        <button type="button" className="panel-toggle" onClick={onToggle} aria-expanded={false}>
          Parameters ◂
        </button>
      </aside>
    );
  }

  return (
    <aside className="params-panel">
      <div className="panel-header">
        <h2>Parameters</h2>
        <button type="button" className="panel-toggle" onClick={onToggle} aria-expanded={true}>
          Hide ▸
        </button>
      </div>

      <fieldset>
        <legend>Units</legend>
        <div className="segmented" role="group" aria-label="Units">
          {(['in', 'mm'] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={units === u}
              onClick={() => units !== u && onUnitsChange(u)}
            >
              {u === 'in' ? 'Inches' : 'Millimeters'}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Sheet</legend>
        {field('sheet.x', 'Width (X)', params.sheet.x, (p, x) => ({ ...p, sheet: { ...p.sheet, x } }))}
        {field('sheet.y', 'Height (Y)', params.sheet.y, (p, y) => ({ ...p, sheet: { ...p.sheet, y } }))}
        {field('sheet.thickness', 'Thickness', params.sheet.thickness, (p, thickness) => ({
          ...p,
          sheet: { ...p.sheet, thickness },
        }))}
      </fieldset>

      <fieldset>
        <legend>Bit</legend>
        <div className="number-field">
          <label htmlFor="bit-shape">Shape</label>
          <select
            id="bit-shape"
            value={params.bit.shape.kind}
            onChange={(e) =>
              update((p) => ({ ...p, bit: { ...p.bit, shape: shapeFor(e.target.value as BitKind, p.bit.shape) } }))
            }
          >
            {(Object.keys(BIT_LABELS) as BitKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {BIT_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        {field('bit.diameter', 'Diameter', params.bit.diameter, (p, diameter) => ({
          ...p,
          bit: { ...p.bit, diameter },
        }))}
        {params.bit.shape.kind === 'vbit' &&
          field(
            'bit.includedAngleDeg',
            'Included angle',
            params.bit.shape.includedAngleDeg,
            (p, includedAngleDeg) => ({ ...p, bit: { ...p.bit, shape: { kind: 'vbit', includedAngleDeg } } }),
            '°',
            2
          )}
      </fieldset>

      <fieldset>
        <legend>Feeds</legend>
        {field('feedRate', 'Feed rate', params.feedRate, (p, feedRate) => ({ ...p, feedRate }), rate)}
        {field('plungeRate', 'Plunge rate', params.plungeRate, (p, plungeRate) => ({ ...p, plungeRate }), rate)}
        {field('rapidRateXY', 'Rapid XY', params.rapidRateXY, (p, rapidRateXY) => ({ ...p, rapidRateXY }), rate)}
        {field('rapidRateZ', 'Rapid Z', params.rapidRateZ, (p, rapidRateZ) => ({ ...p, rapidRateZ }), rate)}
      </fieldset>

      <fieldset>
        <legend>Depth</legend>
        {field(
          'spoilboardPenetration',
          'Spoilboard penetration',
          params.spoilboardPenetration,
          (p, spoilboardPenetration) => ({ ...p, spoilboardPenetration })
        )}
        {field('depthPerPass', 'Depth per pass', params.depthPerPass, (p, depthPerPass) => ({ ...p, depthPerPass }))}
        <p className="derived">
          Total cut depth{' '}
          <output>
            {formatNumber(totalDepth, decimals)} {units}
          </output>
        </p>
        <p className="derived">
          Passes <output>{passCount}</output>
        </p>
      </fieldset>

      <fieldset>
        <legend>Machine</legend>
        {field('safeHeight', 'Safe height', params.safeHeight, (p, safeHeight) => ({ ...p, safeHeight }))}
        {field(
          'acceleration',
          'Acceleration',
          params.acceleration,
          (p, acceleration) => ({ ...p, acceleration }),
          `${units}/s²`
        )}
        {field(
          'junctionDeviation',
          'Junction deviation',
          params.junctionDeviation,
          (p, junctionDeviation) => ({ ...p, junctionDeviation })
        )}
      </fieldset>

      <fieldset>
        <legend>Toolpath</legend>
        <div className="segmented" role="group" aria-label="Cut side">
          {(closed ? CLOSED_SIDES : OPEN_SIDES).map(([side, label]) => (
            <button key={side} type="button" aria-pressed={cutSide === side} onClick={() => onCutSideChange(side)}>
              {label}
            </button>
          ))}
        </div>
        <p className="derived">
          Compensation radius{' '}
          <output>
            {formatNumber(cutSide === 'on' ? 0 : toolpath.radius, decimals)} {units}
          </output>
        </p>
        <p className="derived">
          Toolpath length{' '}
          <output>
            {formatNumber(toolpath.length, 2)} {units}
          </output>
        </p>
        {toolpath.warnings.map((w) => (
          <p key={w} className="field-error toolpath-warning" role="status">
            {w}
          </p>
        ))}
      </fieldset>

      <fieldset>
        <legend>Estimate</legend>
        {estimate.total > 0 ? (
          <>
            <p className="derived estimate-total">
              Total time <output>{formatDuration(estimate.total)}</output>
            </p>
            <p className="derived">
              Cutting <output>{formatDuration(estimate.cutting)}</output>
            </p>
            <p className="derived">
              Plunging <output>{formatDuration(estimate.plunging)}</output>
            </p>
            <p className="derived">
              Rapids &amp; retracts <output>{formatDuration(estimate.rapids + estimate.retracts)}</output>
            </p>
            <p className="derived" title="Time lost to acceleration and corner slowdowns; already included above">
              incl. accel &amp; corner loss <output>{formatDuration(estimate.cornerLoss)}</output>
            </p>
            <p className="derived">
              Passes <output>{estimate.passes}</output>
            </p>
            <p className="derived">
              Cut length{' '}
              <output>
                {formatNumber(estimate.cutLength, 2)} {units}
              </output>
            </p>
          </>
        ) : (
          <p className="derived">Draw a path to estimate the cut time.</p>
        )}
      </fieldset>

      <fieldset>
        <legend>Settings file</legend>
        <div className="button-row">
          <button type="button" onClick={handleExport}>
            Export
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Import
          </button>
          <button type="button" onClick={handleReset}>
            Reset to defaults
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={handleImport}
        />
        {fileMessage && (
          <p className={fileMessage.error ? 'file-message field-error' : 'file-message'} role="status">
            {fileMessage.text}
          </p>
        )}
      </fieldset>
    </aside>
  );
}
