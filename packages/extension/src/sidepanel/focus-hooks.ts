/**
 * Focus management for the panel's dialogs (the input panel) and popups (the
 * Copy menu, Settings).
 */

import type { RefObject } from "preact";
import { useEffect, useLayoutEffect } from "preact/hooks";

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
 * the interaction started from. Only while the dialog (`ref`) still has focus,
 * or nothing does: focus the user has moved elsewhere while it was open (to
 * Settings, say) stays there when something else closes it.
 *
 * Must be called before any hook that moves focus into the dialog, so that it
 * captures the opener rather than the dialog's own initial focus target.
 */
export function useRestoreFocusOnClose(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      const active = document.activeElement;
      const dialogHasFocus =
        active === null ||
        active === document.body ||
        ref.current?.contains(active) === true;
      // The opener can be gone by the time the panel closes — a re-extraction
      // replaces tree rows — and a detached element cannot take focus.
      if (dialogHasFocus && opener?.isConnected) opener.focus();
    };
  }, [ref]);
}

/**
 * Close a popup (the Copy menu, Settings, each marked `data-sn-popup`) on a
 * press outside it, with any button, or on Escape. Escape pressed inside it
 * also returns focus to the button that opens it, as a menu button's or a
 * disclosure's does. A press outside leaves focus where the press puts it:
 * the popup closes before the browser moves focus, so focus on its controls
 * goes to the body first, and the panel's own focus repair leaves focus a
 * popup took with it alone (see `App`). A click a screen reader makes is the
 * exception: it brings a mousedown with no pointerdown before it, and moves
 * focus nowhere if what it clicks can't take focus, so focus still inside
 * the popup then goes to its button, as on Escape. A press that starts
 * inside it never closes it, and nor does an Escape something else has
 * already answered (a native pick's cancel). A popup whose button has gone
 * (the toolbar, while the panel waits for a page) closes too, rather than
 * coming back open. Only one popup is open at a time, which `App` keeps to
 * by opening each in place of the other.
 */
export function useDismissible(
  open: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement>,
  buttonRef: RefObject<HTMLElement>,
) {
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      containerRef.current?.contains(target as Node) === true;
    const onPress = (e: Event) => {
      if (!containerRef.current || inside(e.target)) return;
      // A real press closed it on its pointerdown, and focus went with it,
      // before its mousedown: only a press without one finds focus here.
      const stranded = e.type === "mousedown" && inside(document.activeElement);
      close();
      if (stranded) buttonRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const hadFocus = inside(document.activeElement);
      close();
      if (hadFocus) buttonRef.current?.focus();
    };
    // Both press events, in capture, so a control that stops them from
    // bubbling doesn't hide them: `pointerdown` comes for a disabled control
    // too, and `mousedown` for a click a screen reader makes, which brings no
    // pointer events. Closing twice is closing once.
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("mousedown", onPress, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("mousedown", onPress, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, containerRef, buttonRef]);
  useLayoutEffect(() => {
    if (open && !containerRef.current) close();
  });
}
