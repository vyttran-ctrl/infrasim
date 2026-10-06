// UI-only state that does not belong in the app store: undo stack, transient
// messages, panel disclosure. Edits made through the UI go through
// `commitEdit` so they can be undone.

import { create } from 'zustand';
import type { RoadNetwork } from '../sim/types';
import { useApp } from '../app/store';
import { sim } from '../app/simBridge';

interface UndoEntry {
  network: RoadNetwork;
  label: string;
}

type Popover = 'config' | 'save' | null;

interface UIState {
  undo: UndoEntry[];
  /** Short transient message shown in the map hint line. */
  flash: string | null;
  /** Narrow screens: dashboard bottom sheet open. */
  sheetOpen: boolean;
  /** Run bar popover. */
  popover: Popover;
  importOpen: boolean;
  setSheetOpen(open: boolean): void;
  setPopover(p: Popover): void;
  setImportOpen(open: boolean): void;
}

export const useUI = create<UIState>((set) => ({
  undo: [],
  flash: null,
  sheetOpen: false,
  popover: null,
  importOpen: false,
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  setPopover: (popover) => set({ popover }),
  setImportOpen: (importOpen) => set({ importOpen }),
}));

const UNDO_LIMIT = 50;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

export function flash(message: string, ms = 3600) {
  clearTimeout(flashTimer);
  useUI.setState({ flash: message });
  flashTimer = setTimeout(() => useUI.setState({ flash: null }), ms);
}

/** Apply an edit through the store, remembering the previous network for undo. */
export function commitEdit(next: RoadNetwork, label: string) {
  const { network, applyEdit } = useApp.getState();
  if (next === network) return;
  useUI.setState((s) => ({ undo: [...s.undo.slice(-(UNDO_LIMIT - 1)), { network, label }] }));
  applyEdit(next, label);
}

/** Run an edit function and report a thrown message instead of crashing. */
export function tryEdit(fn: () => void) {
  try {
    fn();
  } catch (err) {
    flash(err instanceof Error ? err.message : 'That change could not be applied.');
  }
}

export function undoLastEdit() {
  const stack = useUI.getState().undo;
  const last = stack[stack.length - 1];
  if (!last) return;
  useUI.setState({ undo: stack.slice(0, -1) });
  const { edits, selection } = useApp.getState();
  const prev = last.network;
  const stillThere =
    !selection ||
    (selection.kind === 'edge' ? prev.edges.some((e) => e.id === selection.id) : prev.nodes.some((n) => n.id === selection.id));
  useApp.setState({ network: prev, edits: edits.slice(0, -1), selection: stillThere ? selection : null });
  sim.edit(prev);
  flash(`Undid: ${last.label}`);
}

// A fresh load (network switch, scenario restore) clears the change list;
// the undo stack goes with it.
useApp.subscribe((s, prev) => {
  if (s.edits.length === 0 && (prev.edits.length > 0 || s.network !== prev.network) && useUI.getState().undo.length) {
    useUI.setState({ undo: [] });
  }
});
