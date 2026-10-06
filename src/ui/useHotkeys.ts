import { useEffect } from 'react';
import { useApp } from '../app/store';
import { toggleRun } from './RunBar';
import { SPEEDS, TOOL_BY_KEY } from './tools';
import { undoLastEdit, useUI } from './uiStore';

function isTyping(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button'].includes(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const app = useApp.getState();
      const ui = useUI.getState();

      if (e.key === 'Escape') {
        if (app.compareOpen) app.setCompareOpen(false);
        else if (ui.popover) ui.setPopover(null);
        else if (ui.importOpen) ui.setImportOpen(false);
        else if (app.pendingNode) app.setPendingNode(null);
        else if (app.selection) app.select(null);
        else if (ui.sheetOpen) ui.setSheetOpen(false);
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
        // Space drives the run (buttons still activate with Enter); checkboxes keep it.
        if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') return;
        e.preventDefault();
        toggleRun();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'r') {
        app.reset();
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= SPEEDS.length) {
        app.setSpeed(SPEEDS[n - 1]);
        return;
      }
      const tool = TOOL_BY_KEY[k];
      if (tool) app.setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
