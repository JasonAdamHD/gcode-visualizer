/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BitKind, BitShape, FieldKey, MachineParams, Units } from '../machine/params';
import { displayDecimals, formatNumber, validateParams } from '../machine/params';
import { NumberField } from './NumberField';
import './ParametersPanel.css';

type ParametersPanelProps = {
  params: MachineParams;
  update: (updater: (prev: MachineParams) => MachineParams) => void;
  /** Switches units; the caller also rescales the drawing. */
  onUnitsChange: (units: Units) => void;
  open: boolean;
  onToggle: () => void;
};

const BIT_LABELS: Record<BitKind, string> = {
  flat: 'Flat end',
  ball: 'Ball end',
  vbit: 'V-bit',
};

const DEFAULT_VBIT_ANGLE = 90;

function shapeFor(kind: BitKind, current: BitShape): BitShape {
  if (kind === current.kind) return current;
  return kind === 'vbit' ? { kind: 'vbit', includedAngleDeg: DEFAULT_VBIT_ANGLE } : { kind };
}

/** Sidebar for editing machine/job parameters. */
export function ParametersPanel({ params, update, onUnitsChange, open, onToggle }: ParametersPanelProps) {
  const { units } = params;
  const decimals = displayDecimals(units);
  const rate = `${units}/min`;

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
      </fieldset>

      <fieldset>
        <legend>Depth</legend>
        {field(
          'spoilboardPenetration',
          'Spoilboard penetration',
          params.spoilboardPenetration,
          (p, spoilboardPenetration) => ({ ...p, spoilboardPenetration })
        )}
        <p className="derived">
          Total cut depth{' '}
          <output>
            {formatNumber(params.sheet.thickness + params.spoilboardPenetration, decimals)} {units}
          </output>
        </p>
      </fieldset>
    </aside>
  );
}
