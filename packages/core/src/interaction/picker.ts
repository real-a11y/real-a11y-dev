/**
 * DevTools-style element picker — installable on/off, dependency-injected
 * so it can be unit-tested in jsdom without any chrome.runtime.
 *
 * Behavior (mirrors Chrome's "select an element in the page to inspect it"):
 *   - When enabled, installs capture-phase listeners on the document:
 *       click     → preventDefault + stopPropagation, resolve the click
 *                   target up the DOM tree to the nearest tracked node id,
 *                   notify the host (panel) and exit pick mode
 *       mousemove → call onHighlight(id) for tracked elements, onClearHighlight()
 *                   when over an untracked one
 *       keydown   → Escape exits pick mode without selecting
 *       the rest of the pointer sequence (see SUPPRESSED_EVENTS)
 *                 → preventDefault + stopPropagation only, so the page never
 *                   sees the lead-in to a pick
 *   - When disabled, removes every listener, calls onClearHighlight(),
 *     and restores the body cursor it captured on enable. The cursor swap
 *     is skipped entirely when `isSubFrame` is true (only the top frame
 *     should change the user-visible cursor).
 *   - Every transition fires onModeChange so the panel UI stays in sync
 *     even when the picker exits autonomously (Escape, NODE_PICKED click).
 *   - setEnabled is idempotent — calling with the current state is a no-op.
 */

/**
 * Pointer events swallowed wholesale while pick mode is on.
 *
 * Suppressing only `click` is not enough: real pages act on the events that
 * come first. Radix and Headless UI open dropdowns on `pointerdown`, focus
 * moves on `mousedown`, and Material ripples start on `pointerdown` — so
 * clicking a menu button to inspect it would open the menu even though the
 * click itself never lands. Chrome's own inspect mode suppresses the whole
 * sequence; this list is that sequence, minus `click`, which stays a real
 * handler because it is what resolves the pick.
 */
const SUPPRESSED_EVENTS = [
  "pointerdown",
  "mousedown",
  "pointerup",
  "mouseup",
  "auxclick",
] as const;

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
  let onSuppress: ((e: Event) => void) | null = null;

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

    onSuppress = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    doc.addEventListener("click", onClick, true);
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("keydown", onKey, true);
    for (const type of SUPPRESSED_EVENTS) {
      doc.addEventListener(type, onSuppress, true);
    }

    if (!isSubFrame && doc.body) {
      prevCursor = doc.body.style.cursor;
      doc.body.style.cursor = "crosshair";
    }
  }

  function uninstall(): void {
    if (onClick) doc.removeEventListener("click", onClick, true);
    if (onMove) doc.removeEventListener("mousemove", onMove, true);
    if (onKey) doc.removeEventListener("keydown", onKey, true);
    if (onSuppress) {
      for (const type of SUPPRESSED_EVENTS) {
        doc.removeEventListener(type, onSuppress, true);
      }
    }
    onClick = null;
    onMove = null;
    onKey = null;
    onSuppress = null;

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
