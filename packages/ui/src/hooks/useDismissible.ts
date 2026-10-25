import type { RefObject } from "preact";
import { useEffect, useLayoutEffect } from "preact/hooks";

/**
 * Everything inside a panel that Tab can reach. Its controls are only ever
 * enabled or disabled — never hidden — so matching on the selector alone is
 * enough; there is nothing here that needs a visibility check.
 *
 * Exported so the extension's focus trap, and the tests that walk it, use the
 * same set this does, rather than keeping a copy that silently drifts if this
 * is ever narrowed.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Close a popup (the panel's Settings, the extension's Copy menu: each marked
 * `data-sn-popup`) on a press outside it, with any button, or on Escape.
 * Escape pressed inside it also returns focus to the button that opens it, as
 * a menu button's or a disclosure's does. A press outside leaves focus where
 * the press puts it: the popup closes before the browser moves focus, so focus
 * on its controls goes to the body first, and the extension's own focus
 * repair leaves focus a popup took with it alone (see its `App`). A click a
 * screen reader makes is the exception: it brings a mousedown with no
 * pointerdown before it, and moves focus nowhere if what it clicks can't take
 * focus, so focus still on the popup's controls then goes where a real press
 * would have put it. A press that starts inside it never closes it, and nor
 * does an Escape something else has already answered (a native pick's cancel).
 * A popup whose button has gone (the extension's toolbar, while the panel
 * waits for a page) closes too, rather than coming back open.
 *
 * Works inside a shadow root as well as a document, since the inspector
 * mounts its panel in one. Its listeners are on the document, where an event
 * from inside a shadow root arrives retargeted to the root's host, so what
 * was pressed is read off the event's composed path, and what has focus off
 * the popup's own root.
 */
export function useDismissible(
  open: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement>,
  buttonRef: RefObject<HTMLElement>,
) {
  useEffect(() => {
    if (!open) return;
    const doc = containerRef.current?.ownerDocument ?? document;
    const inside = (e: Event) => {
      const container = containerRef.current;
      return container != null && e.composedPath().includes(container);
    };
    // Close it, and if focus was on its controls (not its button), which go
    // with it, put focus on `to` instead.
    const closeKeepingFocus = (to: HTMLElement | null | undefined) => {
      const container = containerRef.current;
      const root = container?.getRootNode() as
        Document | ShadowRoot | undefined;
      const active = root?.activeElement ?? null;
      const strands =
        active != null &&
        container?.contains(active) === true &&
        active.closest("[data-sn-popup]") != null;
      close();
      if (strands) to?.focus();
    };
    const onPress = (e: Event) => {
      if (!containerRef.current || inside(e)) return;
      if (e.type !== "mousedown") {
        close();
        return;
      }
      // A real press closed it on its pointerdown, taking focus with it,
      // before its mousedown. Focus still on its controls at a mousedown
      // means a click a screen reader made, which moves none: focus goes
      // where a real press would put it, the nearest thing around what was
      // clicked that takes focus, or else the popup's button.
      const target = e.composedPath()[0];
      const around =
        target instanceof Element
          ? target.closest<HTMLElement>(FOCUSABLE_SELECTOR)
          : null;
      closeKeepingFocus(around ?? buttonRef.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      closeKeepingFocus(buttonRef.current);
    };
    // Both press events, in capture, so a control that stops them from
    // bubbling doesn't hide them: `pointerdown` comes for a disabled control
    // too, and `mousedown` for a click a screen reader makes, which brings no
    // pointer events. Closing twice is closing once.
    doc.addEventListener("pointerdown", onPress, true);
    doc.addEventListener("mousedown", onPress, true);
    doc.addEventListener("keydown", onKey);
    return () => {
      doc.removeEventListener("pointerdown", onPress, true);
      doc.removeEventListener("mousedown", onPress, true);
      doc.removeEventListener("keydown", onKey);
    };
  }, [open, close, containerRef, buttonRef]);
  useLayoutEffect(() => {
    if (open && !containerRef.current) close();
  });
}
