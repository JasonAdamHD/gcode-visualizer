/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import './ProgramBar.css';

/** File types offered by the Open dialog; any file can still be dropped. */
const ACCEPT = '.nc,.gcode,.ngc,.tap,.txt,text/plain';

type ProgramBarProps = {
  /** Name of the open program, or null while showing the drawing. */
  fileName: string | null;
  error: string | null;
  onOpen: (file: File) => void;
  onLoadSample: () => void;
  onClose: () => void;
};

/** Header controls for opening a G-code file or the sample, and the open file's chip. */
export function ProgramBar({ fileName, error, onOpen, onLoadSample, onClose }: ProgramBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow reopening the same file
    if (file) onOpen(file);
  };

  return (
    <div className="program-bar">
      <button type="button" onClick={() => inputRef.current?.click()}>
        Open G-code
      </button>
      <button type="button" onClick={onLoadSample}>
        Load sample
      </button>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={handleChange} />
      {fileName && (
        <span
          className="file-chip"
          title="Read in your browser only; never uploaded or saved. The program is assumed to start at the sheet origin at safe height."
        >
          <span className="file-name">{fileName}</span>
          <button type="button" onClick={onClose} aria-label={`Close ${fileName}`}>
            ✕
          </button>
        </span>
      )}
      {error && (
        <span className="program-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
