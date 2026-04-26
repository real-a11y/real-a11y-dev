import { useCallback, useEffect, useRef } from "preact/hooks";

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
 * Usage:
 *
 *     const { isMouseModality, markKeyboard } = useInputModality();
 *
 *     onMouseEnter={() => { if (isMouseModality()) handleHover(id); }}
 *     onKeyDown={(e) => { markKeyboard(); handleKeyDown(e); }}
 *
 * The `mousemove` listener is attached on `window` for the lifetime of the
 * component. It's `passive` and amounts to a single ref write per event.
 */
export function useInputModality(): {
  isMouseModality: () => boolean;
  markKeyboard: () => void;
} {
  const modality = useRef<InputModality>("mouse");

  useEffect(() => {
    const onMove = () => {
      modality.current = "mouse";
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const markKeyboard = useCallback(() => {
    modality.current = "keyboard";
  }, []);

  const isMouseModality = useCallback(() => modality.current === "mouse", []);

  return { isMouseModality, markKeyboard };
}
