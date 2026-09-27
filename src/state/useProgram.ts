/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useRef, useState } from 'react';

/** An opened G-code file: its name and text. */
export type ProgramSource = { name: string; text: string };

export type ProgramFile = {
  source: ProgramSource | null;
  /** Why the last open failed; the previous file (if any) stays open. */
  error: string | null;
  /** Opens a file picked or dropped by the user. */
  load: (file: File) => void;
  /** Opens a file bundled with the app (the sample), fetched from `url`. */
  loadUrl: (url: string, name: string) => void;
  close: () => void;
};

/**
 * The opened G-code file. It is read in the browser and kept only in
 * memory: never uploaded and never persisted (see the README's Privacy
 * section). If opens overlap, the last one requested wins; a failed open
 * leaves the current state unchanged apart from the error.
 */
export function useProgram(): ProgramFile {
  const [source, setSource] = useState<ProgramSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const read = useCallback(async (name: string, getText: () => Promise<string>) => {
    const request = ++latest.current;
    let text: string;
    try {
      text = await getText();
    } catch {
      if (request === latest.current) setError(`Couldn't open ${name}`);
      return;
    }
    if (request !== latest.current) return;
    setSource({ name, text });
    setError(null);
  }, []);

  const load = useCallback((file: File) => void read(file.name, () => file.text()), [read]);

  const loadUrl = useCallback(
    (url: string, name: string) =>
      void read(name, async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }),
    [read]
  );

  const close = useCallback(() => {
    latest.current++;
    setSource(null);
    setError(null);
  }, []);

  return { source, error, load, loadUrl, close };
}
