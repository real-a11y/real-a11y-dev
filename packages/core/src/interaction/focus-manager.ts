import { ElementRefMap } from "../utils/element-ref.js";

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

    let overlay = doc.getElementById("__sn-highlight");
    if (!overlay) {
      overlay = doc.createElement("div");
      overlay.id = "__sn-highlight";
      overlay.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        border: 2px solid hsl(221 83% 53%);
        background: hsl(221 83% 53% / 0.1);
        transition: all 0.15s ease;
        border-radius: 2px;
      `;
      doc.documentElement.appendChild(overlay);
    }

    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.display = "block";
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
    document.getElementById("__sn-highlight")?.remove();
  }

  destroy(): void {
    this.listeners = [];
    this.clearHighlight();
  }
}
