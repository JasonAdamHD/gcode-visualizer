/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useId, useState } from 'react';
import { formatNumber } from '../machine/params';

type NumberFieldProps = {
  label: string;
  value: number;
  /** Suffix shown beside the input, e.g. "in" or "mm/min". */
  suffix?: string;
  /** Decimal places shown for the committed value (trailing zeros trimmed). */
  decimals: number;
  /** Returns an error message for a candidate value, or undefined if it is acceptable. */
  validate: (value: number) => string | undefined;
  onCommit: (value: number) => void;
};

/**
 * A numeric input that keeps a local draft string so the user can type
 * intermediate text like "0." or clear the field. The draft is committed only
 * when it parses and passes `validate`; otherwise the error is shown and the
 * committed value is left alone. Blurring reformats the draft from the
 * committed value, discarding any invalid text. The draft resyncs when `value` changes from outside (unit
 * switch, import, reset).
 */
export function NumberField({ label, value, suffix, decimals, validate, onCommit }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => formatNumber(value, decimals));
  const [error, setError] = useState<string | undefined>();
  const [syncedValue, setSyncedValue] = useState(value);

  // Adjust state during render when the committed value changes externally.
  // A value we just committed from this draft already matches it, so leave
  // the user's text (e.g. "1.50") untouched in that case.
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (Number(draft) !== value) {
      setDraft(formatNumber(value, decimals));
      setError(undefined);
    }
  }

  const handleChange = (text: string) => {
    setDraft(text);
    const parsed = text.trim() === '' ? NaN : Number(text);
    if (!Number.isFinite(parsed)) {
      setError('Enter a number');
      return;
    }
    const message = validate(parsed);
    setError(message);
    if (!message && parsed !== value) onCommit(parsed);
  };

  // Normalize the draft to the committed value, e.g. "3." -> "3", or discard
  // an invalid draft.
  const handleBlur = () => {
    setDraft(formatNumber(value, decimals));
    setError(undefined);
  };

  return (
    <div className="number-field">
      <label htmlFor={id}>{label}</label>
      <div className="number-field-input">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
      {error && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
