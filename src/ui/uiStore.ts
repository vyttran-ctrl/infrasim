// UI-only state that does not belong in the app store: undo stack, the toast,
// open menus. Edits made through the UI go through `commitEdit` so they can
// be undone.

import { create } from 'zustand';
import type { RoadNetwork } from '../sim/types';
import { useApp } from '../app/store';
import { sim } from '../app/simBridge';

interface UndoEntry {
  network: RoadNetwork;
  label: string;
}

export type Popover = 'config' | 'shortcuts' | null;

export interface Toast {
  message: string;
  /** Offer an Undo button (the message describes an edit). */
  undo: boolean;
  id: number;
}

interface UIState {
  undo: UndoEntry[];
  toast: Toast | null;
  popover: Popover;
  menuOpen: boolean;
  importOpen: boolean;
  /** Network still loading at startup or on a map switch. */
  loading: string | null;
  setPopover(p: Popover): void;
  setMenuOpen(open: boolean): void;
  setImportOpen(open: boolean): void;
}

export const useUI = create<UIState>((set) => ({
  undo: [],
  toast: null,
  popover: null,
  menuOpen: false,
  importOpen: false,
  loading: null,
  setPopover: (popover) => set({ popover, menuOpen: false }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setImportOpen: (importOpen) => set({ importOpen, menuOpen: false }),
}));

const UNDO_LIMIT = 50;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;

function showToast(message: string, undo: boolean, ms: number) {
  clearTimeout(toastTimer);
  useUI.setState({ toast: { message, undo, id: ++toastId } });
  toastTimer = setTimeout(() => useUI.setState({ toast: null }), ms);
}

/** A short plain message near the bottom of the map. */
export function flash(message: string, ms = 3600) {
  showToast(message, false, ms);
}

export function dismissToast() {
  clearTimeout(toastTimer);
  useUI.setState({ toast: null });
}

/** Apply an edit through the store, remembering the previous network for undo. */
export function commitEdit(next: RoadNetwork, label: string) {
  const { network, applyEdit } = useApp.getState();
  if (next === network) return;
  useUI.setState((s) => ({ undo: [...s.undo.slice(-(UNDO_LIMIT - 1)), { network, label }] }));
  applyEdit(next, label);
  showToast(label, true, 6000);
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
  flash(`Undone: ${last.label}`);
}

// A fresh load (map switch, scenario restore) clears the change list;
// the undo stack goes with it.
useApp.subscribe((s, prev) => {
  if (s.edits.length === 0 && (prev.edits.length > 0 || s.network !== prev.network) && useUI.getState().undo.length) {
    useUI.setState({ undo: [] });
  }
});
