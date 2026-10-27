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
 * `data-sn-popup`) on a press outside it, with any button, on Escape, or when
 * focus moves to something outside it, which it could otherwise cover.
 * `containerRef` holds the popup together with the button that opens it.
 *
 * Escape pressed inside it also returns focus to the button that opens it, as
 * a menu button's or a disclosure's does. A press outside leaves focus where
 * the press puts it: the popup closes before the browser moves focus, so focus
 * on its controls goes to the body first, and the extension's own focus
 * repair leaves focus a popup took with it alone (see its `App`). A click a
 * screen reader makes is the exception: it brings a mousedown with no
 * pointerdown before it, and moves focus nowhere if what it clicks can't take
 * focus, so focus still on the popup's controls then goes where a real press
 * would have put it. A press that starts inside it never closes it, and nor
 * does an Escape something else has already answered (a native pick's cancel),
 * or focus going nowhere in particular (to the body). A popup whose button has
 * gone (the extension's toolbar, while the panel waits for a page) closes too,
 * rather than coming back open.
 *
 * Works inside a shadow root, open or closed, as well as in a document: the
 * inspector mounts its panel in one, inside whatever its host page puts it in.
 * A listener sees a press's real target only within its own root, since an
 * open shadow root retargets its nodes to its host for anyone outside and a
 * closed one hides them. So presses are listened for on the popup's own root
 * and on each root around it, out to the document, and each decides only for
 * presses that didn't happen inside the next root in.
 */
export function useDismissible(
  open: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement>,
  buttonRef: RefObject<HTMLElement>,
) {
  useEffect(() => {
    const start = containerRef.current;
    if (!open || !start) return;
    const doc = start.ownerDocument;
    // Read when it's needed rather than now: the extension re-renders its
    // Settings into another header as the panel connects, and a popup that
    // stays open across that moves with it.
    const container = () => containerRef.current;
    // Close it, and if focus was on its controls (not its button), which go
    // with it, put focus on `to` instead.
    const closeKeepingFocus = (to: HTMLElement | null | undefined) => {
      const current = container();
      const root = current?.getRootNode() as Document | ShadowRoot | undefined;
      const active = root?.activeElement ?? null;
      const strands =
        active != null &&
        current?.contains(active) === true &&
        active.closest("[data-sn-popup]") != null;
      close();
      if (strands) to?.focus();
    };
    const onPress = (e: Event, path: EventTarget[]) => {
      const current = container();
      if (!current || path.includes(current)) return;
      if (e.type !== "mousedown") {
        close();
        return;
      }
      // A real press closed it on its pointerdown, taking focus with it,
      // before its mousedown. Focus still on its controls at a mousedown
      // means a click a screen reader made, which moves none: focus goes
      // where a real press would put it, the nearest thing around what was
      // clicked that takes focus, or else the popup's button.
      const target = path[0];
      const around =
        target instanceof Element
          ? target.closest<HTMLElement>(FOCUSABLE_SELECTOR)
          : null;
      closeKeepingFocus(around ?? buttonRef.current);
    };
    // The popup's own root, then each root around the host of the one
    // before, out to the document. A press inside `inner`, the next root's
    // host in, is that root's listener's to decide.
    const levels: Array<{ root: Node; inner: Element | null }> = [];
    let root = start.getRootNode();
    let inner: Element | null = null;
    for (;;) {
      levels.push({ root, inner });
      // A shadow root, by shape: `instanceof` fails across frames.
      if (root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE || !("host" in root)) {
        break;
      }
      inner = (root as ShadowRoot).host;
      root = inner.getRootNode();
    }
    const listeners = levels.map(({ root: at, inner: within }) => {
      const listener = (e: Event) => {
        const path = e.composedPath();
        if (within === null || !path.includes(within)) onPress(e, path);
      };
      // Both press events, in capture, so a control that stops them from
      // bubbling doesn't hide them: `pointerdown` comes for a disabled
      // control too, and `mousedown` for a click a screen reader makes,
      // which brings no pointer events. Closing twice is closing once.
      at.addEventListener("pointerdown", listener, true);
      at.addEventListener("mousedown", listener, true);
      return { at, listener };
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      closeKeepingFocus(buttonRef.current);
    };
    // Focus moving out of it, as Tab does, to something it might cover. Not
    // to nowhere: a press on its own text sends focus to the body.
    const onFocusOut = (e: Event) => {
      const current = container();
      const to = (e as FocusEvent).relatedTarget as Node | null;
      if (
        current?.contains(e.target as Node) &&
        to != null &&
        !current.contains(to)
      ) {
        close();
      }
    };
    doc.addEventListener("keydown", onKey);
    levels[0].root.addEventListener("focusout", onFocusOut);
    return () => {
      for (const { at, listener } of listeners) {
        at.removeEventListener("pointerdown", listener, true);
        at.removeEventListener("mousedown", listener, true);
      }
      doc.removeEventListener("keydown", onKey);
      levels[0].root.removeEventListener("focusout", onFocusOut);
    };
  }, [open, close, containerRef, buttonRef]);
  useLayoutEffect(() => {
    if (open && !containerRef.current) close();
  });
}
