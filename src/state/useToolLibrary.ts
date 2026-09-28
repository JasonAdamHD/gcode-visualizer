/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useState } from 'react';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import type { Tool, ToolLibrary } from '../machine/tools';
import { newToolId, nextToolNumber, parseLibrary, resolveActiveTool, serializeLibrary, toolFromParams } from '../machine/tools';

export const TOOLS_STORAGE_KEY = 'cnc-visualizer.tools';
const ACTIVE_STORAGE_KEY = 'cnc-visualizer.activeTool';

/** A new library: one tool, the default 1/4" up-cut flat end mill. */
function starterLibrary(): ToolLibrary {
  return { version: 1, tools: [toolFromParams(DEFAULT_PARAMS, 1, '1/4" up-cut flat')] };
}

function load(): { library: ToolLibrary; activeId: string | null } {
  try {
    const text = localStorage.getItem(TOOLS_STORAGE_KEY);
    const parsed = text === null ? null : parseLibrary(text);
    const library = parsed?.ok ? parsed.library : starterLibrary();
    return { library, activeId: resolveActiveTool(localStorage.getItem(ACTIVE_STORAGE_KEY), library) };
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return { library: starterLibrary(), activeId: null };
  }
}

export type ToolLibraryState = {
  library: ToolLibrary;
  /** The tool picked to cut with, or null. */
  activeId: string | null;
  active: Tool | null;
  select: (id: string | null) => void;
  /** Adds the params' current bit as a new tool (next free number) and picks it. */
  saveNew: (params: MachineParams, name: string) => void;
  /** Changes a tool's fields (bumping its change time). */
  edit: (id: string, change: Partial<Omit<Tool, 'id' | 'updatedAt'>>) => void;
  /** Overwrites a tool with the params' current bit, feeds and spindle speed. */
  updateFromParams: (id: string, params: MachineParams) => void;
  remove: (id: string) => void;
};

/**
 * The tool library and the picked tool, remembered per viewer in
 * localStorage (and, later, synced to an account). It knows nothing about
 * the params: the caller applies a picked tool to them.
 */
export function useToolLibrary(): ToolLibraryState {
  const [state, setState] = useState(load);
  const { library, activeId } = state;

  useEffect(() => {
    try {
      localStorage.setItem(TOOLS_STORAGE_KEY, serializeLibrary(library));
      localStorage.setItem(ACTIVE_STORAGE_KEY, activeId ?? '');
    } catch {
      // Quota exceeded or storage unavailable: keep working in memory.
    }
  }, [library, activeId]);

  const select = useCallback((id: string | null) => setState((s) => ({ ...s, activeId: id })), []);

  const saveNew = useCallback((params: MachineParams, name: string) => {
    // Fixed here so the updater is pure (React may run it twice).
    const id = newToolId();
    const now = Date.now();
    setState((s) => {
      const tool = toolFromParams(params, nextToolNumber(s.library), name, id, now);
      return { library: { ...s.library, tools: [...s.library.tools, tool] }, activeId: id };
    });
  }, []);

  const edit = useCallback((id: string, change: Partial<Omit<Tool, 'id' | 'updatedAt'>>) => {
    setState((s) => ({
      ...s,
      library: {
        ...s.library,
        tools: s.library.tools.map((t) => (t.id === id ? { ...t, ...change, updatedAt: Date.now() } : t)),
      },
    }));
  }, []);

  const updateFromParams = useCallback((id: string, params: MachineParams) => {
    setState((s) => ({
      ...s,
      library: {
        ...s.library,
        tools: s.library.tools.map((t) => (t.id === id ? toolFromParams(params, t.number, t.name, t.id) : t)),
      },
    }));
  }, []);

  const remove = useCallback((id: string) => {
    setState((s) => {
      const tools = s.library.tools.filter((t) => t.id !== id);
      return { library: { ...s.library, tools }, activeId: s.activeId === id ? null : s.activeId };
    });
  }, []);

  const active = library.tools.find((t) => t.id === activeId) ?? null;
  return { library, activeId, active, select, saveNew, edit, updateFromParams, remove };
}
