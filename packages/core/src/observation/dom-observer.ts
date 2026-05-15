/** Observed attribute changes that affect the tree */
const OBSERVED_ATTRIBUTES = [
  "role",
  "aria-label",
  "aria-labelledby",
  "aria-hidden",
  "aria-expanded",
  "aria-checked",
  "aria-disabled",
  "aria-pressed",
  "aria-selected",
  "aria-describedby",
  "aria-live",
  "aria-modal",
  "class",
  "id",
  "disabled",
  "checked",
  "href",
  "src",
  "type",
  "alt",
  "title",
  "hidden",
  "inert",
  "tabindex",
  "contenteditable",
  "open", // <details open>
  "style", // CSS visibility/display changes (e.g., captcha showing/hiding content)
];

/**
 * Element ids whose mutations we cause ourselves and must NOT trigger a tree
 * re-extraction. Without this filter, drawing the focus-highlight overlay on
 * every Tab keystroke (or showing/hiding the screen curtain) would itself be
 * a DOM mutation observed by this observer — feeding back into another
 * re-extract → re-render → re-highlight loop.
 *
 * Add new sentinel ids here when introducing new own-injected elements
 * (e.g., a future inline tooltip overlay, a debug ruler, etc.).
 */
const DEFAULT_INTERNAL_IDS: ReadonlySet<string> = new Set([
  "__sn-highlight",
  "__sn-curtain",
]);

/**
 * True if `node` is an Element with one of the sentinel ids — meaning
 * mutations involving it are our own and should be ignored.
 */
function isInternalNode(node: Node, internalIds: ReadonlySet<string>): boolean {
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return false;
  const el = node as Element;
  return internalIds.has(el.id);
}

/**
 * Walk up from `node` looking for an internal-sentinel ancestor. Catches
 * characterData / nested mutations on text content inside the sentinel
 * (e.g. the curtain's "Screen Curtain" text).
 */
function hasInternalAncestor(
  node: Node,
  internalIds: ReadonlySet<string>,
): boolean {
  let n: Node | null = node;
  while (n) {
    if (isInternalNode(n, internalIds)) return true;
    n = n.parentNode;
  }
  return false;
}

/** True if a single MutationRecord involves only internal-sentinel nodes. */
function isInternalMutation(
  m: MutationRecord,
  internalIds: ReadonlySet<string>,
): boolean {
  if (m.type === "attributes") {
    return isInternalNode(m.target, internalIds);
  }
  if (m.type === "childList") {
    const total = m.addedNodes.length + m.removedNodes.length;
    if (total === 0) return false;
    for (const n of m.addedNodes) {
      if (!isInternalNode(n, internalIds)) return false;
    }
    for (const n of m.removedNodes) {
      if (!isInternalNode(n, internalIds)) return false;
    }
    return true;
  }
  if (m.type === "characterData") {
    return hasInternalAncestor(m.target, internalIds);
  }
  return false;
}

/**
 * Watches for DOM mutations and triggers a re-extraction callback.
 * Uses debouncing to batch rapid mutations (e.g., SPA transitions, streaming).
 *
 * Observes:
 * - childList + subtree — element insertions/removals
 * - attributes — role, aria-*, class, style, etc.
 * - characterData — text node updates (streaming AI responses, live regions)
 *
 * Ignores mutations that only involve our own injected elements (the focus
 * highlight overlay and the screen curtain) so the inspector doesn't observe
 * its own side effects and trigger spurious re-extractions.
 */
export class DomObserver {
  private observer: MutationObserver | null = null;
  private portalObserver: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inputListener: ((e: Event) => void) | null = null;

  constructor(
    private root: Element,
    private onTreeChange: () => void,
    private debounceMs = 300,
    private internalIds: ReadonlySet<string> = DEFAULT_INTERNAL_IDS,
  ) {}

  start(): void {
    this.observer = new MutationObserver((mutations) => {
      // If every mutation in this batch came from our own overlay/curtain,
      // skip the re-extract entirely. Mixed batches (one user mutation +
      // overlay updates) still pass through normally.
      const allInternal = mutations.every((m) =>
        isInternalMutation(m, this.internalIds),
      );
      if (allInternal) return;

      this.scheduleChange();
    });

    this.observer.observe(this.root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
      characterData: true, // catches text node updates (streaming content)
      characterDataOldValue: false,
    });

    // Form-control values live in the .value property, not in DOM attributes
    // or child nodes, so MutationObserver cannot see typing. Listen for
    // input/change events (capture phase, in case a handler stops propagation)
    // so the tree stays in sync with what users type into <input>, <textarea>,
    // <select>, and contenteditable nodes.
    this.inputListener = () => this.scheduleChange();
    this.root.addEventListener("input", this.inputListener, true);
    this.root.addEventListener("change", this.inputListener, true);

    // Modal dialogs from React Portal, Vue Teleport, etc. mount into
    // `document.body` — *outside* `this.root`, so the primary observer
    // above doesn't see them. Same for non-modal overlays: dropdown
    // menus, listboxes (Select / Combobox), tooltips, and toasts
    // (role="status" / role="alert" live regions).
    //
    // The extractor's `findActiveModal()` and `findPortalOverlay()`
    // both scan the whole document and pivot the effective root
    // accordingly — but only when extraction *runs*. Nothing
    // triggers a run unless mutations are observed.
    //
    // This secondary observer watches `document.body` at top level
    // only (no `subtree: true`) for childList changes, then filters
    // for portal mounts whose subtree contains an overlay-shaped
    // element. Bounded surface — fires when Radix / Headless UI /
    // Vue Teleport mounts a portal, not on every internal DOM tweak.
    const body = this.root.ownerDocument?.body;
    if (body && body !== this.root && !this.root.contains(body)) {
      this.portalObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of [...m.addedNodes, ...m.removedNodes]) {
            if (isPortalOverlayContainer(node, this.internalIds)) {
              this.scheduleChange();
              return;
            }
          }
        }
      });
      this.portalObserver.observe(body, { childList: true });
    }
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.portalObserver) {
      this.portalObserver.disconnect();
      this.portalObserver = null;
    }
    if (this.inputListener) {
      this.root.removeEventListener("input", this.inputListener, true);
      this.root.removeEventListener("change", this.inputListener, true);
      this.inputListener = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private scheduleChange(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onTreeChange();
    }, this.debounceMs);
  }
}

// Selectors for portal-mounted *overlay* content the extractor cares
// about. Covers every common React-Portal / Vue-Teleport pattern in
// production design systems:
//
//   - Modals: `[aria-modal="true"]`, native `<dialog>`, `[role="dialog"]`,
//     `[role="alertdialog"]`
//   - Dropdown menus: `[role="menu"]`, `[role="menubar"]`
//   - Listboxes (Select / Combobox popovers): `[role="listbox"]`
//   - Tooltips: `[role="tooltip"]`
//   - Live regions: `[role="status"]`, `[role="alert"]`, `[role="log"]`,
//     `[aria-live]`
//
// Plain analytics divs / script-injected widgets don't carry these
// roles, so they don't trigger spurious re-extracts.
const PORTAL_OVERLAY_SELECTOR =
  '[aria-modal="true"], dialog, [role="dialog"], [role="alertdialog"], ' +
  '[role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], ' +
  '[role="status"], [role="alert"], [role="log"], [aria-live]';

/**
 * True if `node` looks like a portal-mounted overlay container — that
 * is, an element added/removed at the top level of `<body>` whose
 * subtree carries one of the role/attribute signals the extractor
 * uses to scope onto portal content. Skips our own injected overlay
 * sentinels.
 */
function isPortalOverlayContainer(
  node: Node,
  internalIds: ReadonlySet<string>,
): boolean {
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return false;
  const el = node as Element;
  if (internalIds.has(el.id)) return false;
  if (el.matches?.(PORTAL_OVERLAY_SELECTOR)) return true;
  return !!el.querySelector?.(PORTAL_OVERLAY_SELECTOR);
}
