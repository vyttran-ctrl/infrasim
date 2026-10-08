import { useEffect } from 'react';
import { useApp } from '../app/store';
import { cancelNewRoad, isPickingRoadEnd } from './interactions';
import { restart, toggleRun } from './session';
import { closeResults, useTest } from './testRun';
import { undoLastEdit, useUI } from './uiStore';

function isTyping(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button'].includes(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

/** Space play/pause, R restart, Ctrl+Z undo, Esc closes the top-most thing. */
export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const app = useApp.getState();
      const ui = useUI.getState();

      if (e.key === 'Escape') {
        if (ui.menuOpen) ui.setMenuOpen(false);
        else if (ui.popover) ui.setPopover(null);
        else if (ui.importOpen) ui.setImportOpen(false);
        else if (app.compareOpen) app.setCompareOpen(false);
        else if (isPickingRoadEnd()) cancelNewRoad();
        else if (app.selection) app.select(null);
        else if (useTest.getState().open) closeResults();
        return;
      }
      if (isTyping(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoLastEdit();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === ' ') {
        // Space drives the run (buttons still activate with Enter).
        e.preventDefault();
        toggleRun();
        return;
      }
      if (e.key.toLowerCase() === 'r') restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
