/**
 * Focus management for the panel's dialogs (the input panel) and popups (the
 * Copy menu, Settings).
 */

import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

/**
 * Everything inside the panel that Tab can reach. Its controls are only ever
 * enabled or disabled — never hidden — so matching on the selector alone is
 * enough; there is nothing here that needs a visibility check.
 *
 * Exported so the tests walk the same set the trap does, rather than keeping a
 * copy that silently drifts if this is ever narrowed.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * `aria-modal` tells assistive tech that everything behind the dialog is
 * inert, so Tab has to actually honour that. Without this, focus walks out
 * into the toolbar rendered behind the panel while the screen reader still
 * believes it is inside a modal.
 *
 * Bound as a DOM listener rather than as a JSX `onKeyDown`: the wrapper is a
 * plain `role="dialog"` container, and hanging key handlers on it is what
 * `jsx-a11y/no-noninteractive-element-interactions` exists to catch.
 *
 * It listens on the *document*, not on the dialog root, because focus can sit
 * outside the dialog while it is open: clicking the hint line or the panel's
 * own padding — neither of which is focusable — blurs to `<body>` in Chrome,
 * and a root listener never sees the Tab that follows. From there the old
 * binding let focus land on the toolbar behind a panel still claiming to be
 * modal. Anything outside the dialog is pulled back to its first control.
 */
export function useFocusTrap(ref: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const doc = root.ownerDocument;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = doc.activeElement;

      if (!active || !root.contains(active)) {
        // Focus has fallen out of the dialog entirely — bring it back rather
        // than letting Tab resume from wherever it landed.
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}

/**
 * The panel unmounts on submit and on cancel while it still contains focus,
 * which drops DOM focus to `<body>` and leaves a keyboard user Tabbing back
 * from the top of the panel. Return focus to whatever opened it instead — the
 * tree container, the filtered list or the tab sequence, depending on the view
 * the interaction started from.
 *
 * Must be called before any hook that moves focus into the dialog, so that it
 * captures the opener rather than the dialog's own initial focus target.
 */
export function useRestoreFocusOnClose() {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      // The opener can be gone by the time the panel closes — a re-extraction
      // replaces tree rows — and a detached element cannot take focus.
      if (opener?.isConnected) opener.focus();
    };
  }, []);
}

/**
 * Close a popup (the Copy menu, Settings) on a mousedown outside it or on
 * Escape. Escape pressed inside it also returns focus to the button that
 * opens it, as a menu button's or a disclosure's does, rather than leaving
 * focus on what closing it took away.
 */
export function useDismissible(
  open: boolean,
  setOpen: (open: boolean) => void,
  containerRef: RefObject<HTMLElement>,
  buttonRef: RefObject<HTMLElement>,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = containerRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, containerRef, buttonRef]);
}
