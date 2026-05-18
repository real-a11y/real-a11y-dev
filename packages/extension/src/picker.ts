/**
 * DevTools-style element picker — installable on/off, dependency-injected
 * so it can be unit-tested in jsdom without any chrome.runtime.
 *
 * Behavior (mirrors Chrome's "select an element in the page to inspect it"):
 *   - When enabled, installs three capture-phase listeners on the document:
 *       click     → preventDefault + stopPropagation, resolve the click
 *                   target up the DOM tree to the nearest tracked node id,
 *                   notify the host (panel) and exit pick mode
 *       mousemove → call onHighlight(id) for tracked elements, onClearHighlight()
 *                   when over an untracked one
 *       keydown   → Escape exits pick mode without selecting
 *   - When disabled, removes all three listeners, calls onClearHighlight(),
 *     and restores the body cursor it captured on enable. The cursor swap
 *     is skipped entirely when `isSubFrame` is true (only the top frame
 *     should change the user-visible cursor).
 *   - Every transition fires onModeChange so the panel UI stays in sync
 *     even when the picker exits autonomously (Escape, NODE_PICKED click).
 *   - setEnabled is idempotent — calling with the current state is a no-op.
 */

export interface PickerOptions {
  /** Document the picker listens on. */
  doc: Document;
  /** True when this picker is running inside an iframe — skips the cursor swap. */
  isSubFrame: boolean;
  /** Resolve an element to a tracked node id (typically `ElementRefMap.findId`). */
  findId: (el: Element) => string | undefined;
  /** Draw the hover highlight on a tracked element. */
  onHighlight: (nodeId: string) => void;
  /** Clear any current highlight. */
  onClearHighlight: () => void;
  /** Called when the user picks a tracked element. */
  onPicked: (nodeId: string) => void;
  /** Called on every on/off transition (covers Escape, auto-exit after pick). */
  onModeChange: (enabled: boolean) => void;
}

export interface Picker {
  /** True if pick mode is currently on. */
  isEnabled(): boolean;
  /** Turn pick mode on or off. No-op when already in the requested state. */
  setEnabled(enabled: boolean): void;
  /** Force-tear-down: removes listeners and restores cursor unconditionally. */
  teardown(): void;
}

export function createPicker(options: PickerOptions): Picker {
  const {
    doc,
    isSubFrame,
    findId,
    onHighlight,
    onClearHighlight,
    onPicked,
    onModeChange,
  } = options;

  let enabled = false;
  let prevCursor: string | null = null;
  let onClick: ((e: MouseEvent) => void) | null = null;
  let onMove: ((e: MouseEvent) => void) | null = null;
  let onKey: ((e: KeyboardEvent) => void) | null = null;

  function resolveTracked(start: Element | null): string | undefined {
    let el: Element | null = start;
    while (el) {
      const id = findId(el);
      if (id) return id;
      el = el.parentElement;
    }
    return undefined;
  }

  function install(): void {
    onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const id = resolveTracked(e.target as Element | null);
      if (id) onPicked(id);
      // Whether or not we found a tracked element, exit pick mode so the
      // user doesn't get stuck — picking on padding or whitespace is
      // expected to do nothing meaningful but should still close the mode.
      setEnabled(false);
    };
    onMove = (e: MouseEvent) => {
      const id = resolveTracked(e.target as Element | null);
      if (id) onHighlight(id);
      else onClearHighlight();
    };
    onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setEnabled(false);
      }
    };

    doc.addEventListener("click", onClick, true);
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("keydown", onKey, true);

    if (!isSubFrame && doc.body) {
      prevCursor = doc.body.style.cursor;
      doc.body.style.cursor = "crosshair";
    }
  }

  function uninstall(): void {
    if (onClick) doc.removeEventListener("click", onClick, true);
    if (onMove) doc.removeEventListener("mousemove", onMove, true);
    if (onKey) doc.removeEventListener("keydown", onKey, true);
    onClick = null;
    onMove = null;
    onKey = null;

    onClearHighlight();

    if (!isSubFrame && prevCursor !== null && doc.body) {
      doc.body.style.cursor = prevCursor;
      prevCursor = null;
    }
  }

  function setEnabled(next: boolean): void {
    if (next === enabled) return;
    enabled = next;
    if (next) install();
    else uninstall();
    onModeChange(next);
  }

  function teardown(): void {
    if (enabled) {
      enabled = false;
      uninstall();
    }
  }

  return {
    isEnabled: () => enabled,
    setEnabled,
    teardown,
  };
}
