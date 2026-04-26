export type InputModality = "mouse" | "keyboard";

/**
 * Tracks whether the user's most recent intentional input was the mouse or
 * the keyboard.
 *
 * Why this exists: when a tree row is selected via keyboard arrow keys, the
 * panel scrolls to keep the row in view. That scroll moves *other* rows
 * under the (stationary) mouse cursor, which fires synthetic `mouseenter`
 * events on those rows. Without a modality guard, those mouseenters trigger
 * hover-to-focus and yank focus on the real page away from whatever the
 * keyboard just selected — a flickering race the user notices immediately.
 *
 * The standard fix: only treat hover as intentional after a real
 * `mousemove`. Synthetic mouseenters from layout-shift have no preceding
 * mousemove, so the flag stays at `"keyboard"` and hover handlers no-op.
 *
 * Implementation: input modality is process-global (the user only has one
 * active input device at a time), so we keep state in module scope. The
 * `mousemove` listener is installed once on first call and never torn down.
 * This deliberately avoids depending on `useEffect` timing — fixtures that
 * dispatch events synchronously inside a test's act() can otherwise see
 * stale state because Preact schedules effects after commit.
 *
 * Usage:
 *
 *     const { isMouseModality, markKeyboard } = useInputModality();
 *
 *     onMouseEnter={() => { if (isMouseModality()) handleHover(id); }}
 *     onKeyDown={(e) => { markKeyboard(); handleKeyDown(e); }}
 */

let modality: InputModality = "mouse";
let listenerInstalled = false;

function ensureListener(): void {
  if (listenerInstalled) return;
  if (typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener(
    "mousemove",
    () => {
      modality = "mouse";
    },
    { passive: true },
  );
}

export function useInputModality(): {
  isMouseModality: () => boolean;
  markKeyboard: () => void;
} {
  ensureListener();
  return {
    isMouseModality: () => modality === "mouse",
    markKeyboard: () => {
      modality = "keyboard";
    },
  };
}

/**
 * Test-only: reset the module state so individual tests start from the
 * default `"mouse"` modality. Not exported from the package's public entry —
 * tests import directly from this file.
 */
export function __resetInputModalityForTesting(): void {
  modality = "mouse";
}
