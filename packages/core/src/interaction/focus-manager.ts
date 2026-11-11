import { ElementRefMap } from "../utils/element-ref.js";

const OVERLAY_ID = "__sn-highlight";

/**
 * The overlay's inline style. It is a popover where the browser has them
 * (see `highlightElement`), so the UA's `[popover]` rules reach it, which
 * center it, and so does every `[popover]` rule of the page's. So it resets
 * every property first and sets each one it needs, all `!important`, as the
 * extension's screen curtain does. `border-box`, so the frame sits on the
 * element's own rect. A plain literal, not built with a call: a bundle that
 * never draws the overlay can only drop what is plainly unused.
 */
const OVERLAY_STYLE =
  "all: initial !important; display: block !important;" +
  " position: fixed !important; box-sizing: border-box !important;" +
  " pointer-events: none !important; z-index: 2147483647 !important;" +
  " border: 2px solid hsl(221 83% 53%) !important;" +
  " background: hsl(221 83% 53% / 0.1) !important;" +
  " transition: all 0.15s ease !important; border-radius: 2px !important;";

/**
 * Tracks and syncs focus between the tree UI and the real DOM.
 */
export class FocusManager {
  private currentNodeId: string | null = null;
  private listeners: Array<(nodeId: string | null) => void> = [];

  constructor(private elementRefs: ElementRefMap) {}

  /** Get the currently focused node ID */
  getCurrentNodeId(): string | null {
    return this.currentNodeId;
  }

  /** Set focus to a node, optionally focusing the real DOM element */
  setFocus(nodeId: string | null, focusRealElement = false): void {
    this.currentNodeId = nodeId;

    if (focusRealElement && nodeId) {
      const element = this.elementRefs.get(nodeId);
      if (element) {
        (element as HTMLElement).focus?.();
      }
    }

    for (const listener of this.listeners) {
      listener(nodeId);
    }
  }

  /** Subscribe to focus changes */
  onFocusChange(listener: (nodeId: string | null) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Highlight the real DOM element corresponding to a node.
   *
   * By default the element is scrolled into view and an overlay is drawn.
   * Callers that must not disturb the host app (embedded tree view, test
   * harnesses) can pass `{ scroll: false }` to suppress the scroll and/or
   * `{ overlay: false }` to suppress the visual overlay.
   */
  highlightElement(
    nodeId: string,
    options: { scroll?: boolean; overlay?: boolean } = {},
  ): void {
    const { scroll = true, overlay: showOverlay = true } = options;
    const element = this.elementRefs.get(nodeId);
    if (!element) return;

    if (scroll) {
      // Center vertically so the focused element sits in the middle of the
      // viewport (or scrollable ancestor), not jammed against the edge that
      // `block: "nearest"` would leave it at. Horizontal stays "nearest" —
      // centering wide forms or table rows would be more disorienting than
      // helpful. Instant scroll (no `behavior`) so the rect read below
      // reflects the post-scroll position and the overlay lands on top.
      element.scrollIntoView({ block: "center", inline: "nearest" });
    }

    if (!showOverlay) return;

    const doc = element.ownerDocument;
    const rect = element.getBoundingClientRect();
    const popovers =
      typeof (doc.documentElement as Partial<HTMLElement>).showPopover ===
      "function";

    let overlay = doc.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = doc.createElement("div");
      overlay.id = OVERLAY_ID;
      doc.documentElement.appendChild(overlay);
    }
    // Once, on an overlay an older copy of this code made too.
    if (popovers && !overlay.hasAttribute("popover")) {
      // A popover shown is a `group` in Chrome's tree; the overlay is no
      // part of the page's.
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("popover", "manual");
      // In the top layer the overlay has a `::backdrop`, which a page's own
      // `::backdrop` rule would draw over the whole page.
      const backdrop = doc.createElement("style");
      backdrop.textContent = `#${OVERLAY_ID}::backdrop { display: none !important; }`;
      overlay.appendChild(backdrop);
    }

    // Again on every draw: another copy of this code may have drawn it
    // last, with its own style.
    const { style } = overlay;
    style.cssText = OVERLAY_STYLE;
    style.setProperty("top", `${rect.top}px`, "important");
    style.setProperty("left", `${rect.left}px`, "important");
    style.setProperty("width", `${rect.width}px`, "important");
    style.setProperty("height", `${rect.height}px`, "important");

    // No z-index paints over the top layer, so an element inside a page's
    // open popover or modal dialog (a site's menu, say) would have its
    // outline drawn under it, out of sight. In the top layer what entered
    // last is on top, so the overlay, a manual popover (which closes none
    // of the page's), enters it again on every draw.
    if (!popovers) return;
    try {
      if (overlay.matches(":popover-open")) overlay.hidePopover();
      overlay.showPopover();
    } catch {
      // No top layer to enter (a document that is no longer fully active,
      // say): it still has the highest z-index there is.
    }
  }

  /**
   * Remove the highlight overlay from the document.
   *
   * Removes the element rather than hiding it — a stale `display: none`
   * `<div id="__sn-highlight">` gets re-activated by the next call to
   * `highlightElement()` (the positioning code sets `display: block` on
   * whatever is already there). Multi-frame cleanup is the orchestration
   * layer's concern: each frame's FocusManager only clears its own document.
   */
  clearHighlight(): void {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  destroy(): void {
    this.listeners = [];
    this.clearHighlight();
  }
}
