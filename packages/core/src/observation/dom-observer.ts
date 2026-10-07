import {
  safeContains,
  safeGetAttribute,
  safeMatches,
  safeNodeType,
  safeParentNode,
  safeQuerySelectorAll,
  safeRootNode,
} from "../extraction/clobber-safe.js";
import {
  ARIA_STATE_ATTRIBUTES,
  containsOverlaySignal,
  isModal,
  KEY_ATTRIBUTES,
} from "../extraction/dom-extractor.js";
import { GLOBAL_ARIA_ATTRIBUTES } from "../extraction/role-map.js";
import type { TreeChange } from "../types.js";

/**
 * Attributes that affect the tree WITHOUT landing on a node as
 * `dom.attributes` / `state` — they steer name and role computation,
 * visibility, or extraction scope.
 *
 * Deliberately restates the handful that ALSO appear in `KEY_ATTRIBUTES`
 * (`role`, `class`, `id`, `for`). Those are the ones `LiveTreeExtractor`'s
 * `SCOPE_ATTRS` / `REFERENCE_ATTRS` pivot on, and `KEY_ATTRIBUTES` is a
 * *display* list — someone trimming it for cosmetic reasons must not silently
 * turn off the rescope or the reference-change fallback. The union makes the
 * duplication free.
 */
const EXTRA_OBSERVED_ATTRIBUTES = [
  // Load-bearing for scope/reference handling; see the note above.
  "role",
  "class", // also CSS visibility, which findActiveModal/findPortalOverlay gate on
  "id",
  // `for` re-points a <label> at a different control, changing the accessible
  // name of BOTH the old and the new target. LiveTreeExtractor treats it as a
  // reference attribute and falls back to a full extraction — but only if the
  // change is observed in the first place.
  "for",

  "aria-labelledby",
  "aria-describedby",
  "aria-description", // inline description, ARIA 1.3+ (getDescription)
  "aria-level", // explicit heading / treeitem level (role-map)
  "aria-live",
  "aria-modal",
  "scope", // <th scope> selects the columnheader/rowheader role (role-map)
  "list", // <input list> naming a <datalist> makes it a combobox (role-map)
  "autocomplete", // names credential/payment fields, whose value gets redacted
  // Inputs to a field's announced value (ADR-0001) that nothing else watches:
  // a range widget's spoken text, an <option>'s label (its <select>'s value),
  // and a <progress>/<meter>'s value, which is reflected as this attribute.
  "aria-valuetext",
  "label",
  "value",
  "disabled",
  "checked",
  "hidden",
  "inert",
  "contenteditable",
  "open", // <details open>
  "style", // CSS visibility/display changes (e.g., captcha showing/hiding content)
  "kind", // <track kind> drives the media node's hoisted captions property
  "usemap", // <img usemap> decides whether its map's <area>s are rendered
  // What a control invokes, which decides its expanded state: what it names,
  // whether that is a popover (which also hides it), and a form it would
  // submit instead.
  "popovertarget",
  "commandfor",
  "command",
  "popover",
  "form",

  // Every ARIA global state/property voids role="presentation", so adding or
  // clearing one on a presentational element changes its ROLE — the element
  // appears in or vanishes from the tree. Spread from role-map's own list
  // rather than restated, so a name added there is observed automatically
  // instead of leaving a silently stale tree. Duplicates are fine: the Set
  // below folds them.
  ...GLOBAL_ARIA_ATTRIBUTES,
];

/**
 * Observed attribute changes that affect the tree.
 *
 * Unioned with the extractor's own lists rather than restating them, because
 * the two drifting apart is invisible at runtime: an attribute the extractor
 * reads but this filter omits (`aria-current` on an SPA route change,
 * `aria-busy` around a fetch) simply never re-extracts, and the panel keeps
 * showing the old state with nothing to indicate it is stale.
 *
 * That covers what a node RECORDS. Attributes consumed further along the
 * pipeline — name/description/role computation, the sensitive-value redaction
 * — are not in those lists and still have to be added above by hand.
 */
const OBSERVED_ATTRIBUTES = [
  ...new Set([
    ...KEY_ATTRIBUTES,
    ...ARIA_STATE_ATTRIBUTES,
    ...EXTRA_OBSERVED_ATTRIBUTES,
  ]),
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
  if (safeNodeType(node) !== 1 /* ELEMENT_NODE */) return false;
  const el = node as Element;
  // Read via getAttribute, not `.id`: on a clobbered <form> the `.id` property
  // is a child element, not a string (see dom-extractor's clobbering guards).
  // And through the prototype's getAttribute, since a control named
  // `getAttribute` shadows that too — and a throw here loses the whole batch.
  return internalIds.has(safeGetAttribute(el, "id") ?? "");
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
    n = safeParentNode(n);
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

/** `DomObserver`'s default trailing-edge debounce: a burst of changes is
 *  reported once the page has been quiet this long.
 *  @internal Shared with the extension's native auto-refresh. */
export const DOM_OBSERVER_DEBOUNCE_MS = 300;

/** `DomObserver`'s default ceiling: a stream that never goes quiet is still
 *  reported at least this often.
 *  @internal Shared with the extension's native auto-refresh. */
export const DOM_OBSERVER_MAX_WAIT_MS = 1000;

/**
 * Watches for DOM mutations and triggers a re-extraction callback.
 * Uses a trailing-edge debounce to batch rapid mutations (e.g. SPA
 * transitions), with a max-wait ceiling so a mutation stream that never goes
 * quiet — streaming AI responses, progress bars, animated `style` updates —
 * still flushes at least every `maxWaitMs` instead of being deferred forever.
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
  // One deep observer per currently-open portal overlay that mounts OUTSIDE
  // `root` (Radix/Headless-UI/Teleport modals, menus, listboxes). The primary
  // observer only covers `root`'s subtree, so without these a portal's
  // open/close re-extracts but changes INSIDE it (typing, aria-* flips,
  // submenu/content swaps) never do — the panel goes stale.
  private portalContentObservers = new Map<Element, MutationObserver>();
  /**
   * For each modal `<dialog>` outside `root` that `syncDialogWatch` watches, an
   * observer of its parent's children, so it leaving while still open is
   * heard: removal changes no attribute, and its parent is often a container
   * (`#modal-root`) rather than `<body>`, which the portal observer watches.
   * Its keys are also the record of which watches the dialog path made, as
   * opposed to the portal path, and only those does a dialog closing end.
   */
  private dialogParentObservers = new Map<Element, MutationObserver>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Non-resetting ceiling timer: armed on the first change of a burst and NOT
  // cleared by later changes, so a continuous stream still flushes every
  // maxWaitMs instead of being starved forever by the resetting debounce.
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private inputListener: ((e: Event) => void) | null = null;
  private toggleListener: ((e: Event) => void) | null = null;
  /** The tree `toggleListener` listens on: the document or shadow root holding `root`. */
  private toggleScope: Node | null = null;
  /** Watches `popover` attributes across `toggleScope`, for those outside `root`. */
  private popoverObserver: MutationObserver | null = null;
  /** Watches `open` attributes across `toggleScope`, for a `<dialog>` outside `root`. */
  private dialogObserver: MutationObserver | null = null;
  /** Accumulated MutationRecords across the current debounce window. */
  private pendingMutations: MutationRecord[] = [];
  /** Synthetic dirty roots (e.g. form-control input events). */
  private pendingDirtyRoots: Element[] = [];
  /**
   * Set when a change can't be handled incrementally and the consumer must do
   * a full re-extraction — e.g. a portal/overlay mounting or unmounting
   * OUTSIDE `root`, which the portal observer detects without any
   * MutationRecord that maps into the observed subtree.
   */
  private pendingFull = false;
  /** Upper bound on how long a mutation stream may defer a flush. */
  private readonly maxWaitMs: number;
  /** Sentinel ids to filter: always the built-ins, plus any caller additions. */
  private readonly internalIds: ReadonlySet<string>;

  constructor(
    private root: Element,
    private onTreeChange: (change?: TreeChange) => void,
    private debounceMs = DOM_OBSERVER_DEBOUNCE_MS,
    internalIds: ReadonlySet<string> = DEFAULT_INTERNAL_IDS,
    maxWaitMs = DOM_OBSERVER_MAX_WAIT_MS,
  ) {
    // The ceiling can't be shorter than one debounce interval, or it would
    // pre-empt normal debouncing and fire on the leading edge of every burst.
    this.maxWaitMs = Math.max(maxWaitMs, debounceMs);
    // Union, never replace: a caller adding its own overlay sentinel must not
    // silently drop the built-ins and re-arm the overlay feedback loop.
    this.internalIds = new Set([...DEFAULT_INTERNAL_IDS, ...internalIds]);
  }

  start(): void {
    // Idempotent: every field below is assigned unconditionally, so a second
    // `start()` on an already-armed observer would strand the first set of
    // observers and listeners with nothing left holding them. They would stay
    // connected, recording into the same `pendingMutations` buffer, so one
    // mutation arrives as duplicate entries in `change.mutations` (one
    // callback per batch, not several — the sets share one debounce timer and
    // each reset it). Worse, `stop()` could only ever disconnect the set from
    // the LAST `start()`, so the earlier ones went on firing `onTreeChange`
    // after the consumer tore the observer down, for the life of the
    // document.
    //
    // A no-op rather than a `this.stop()` restart, deliberately. There is
    // nothing for a restart to pick up — `root` is fixed at construction —
    // and tearing down first would drop the deep observers for overlays that
    // are already open: `portalObserver` only ever adopts a portal on the
    // `childList` record that mounts it, so an open one would never be
    // re-adopted, and clearing `portalContentObservers` also loses the
    // identity-keyed teardown that an emptied wrapper depends on (see
    // `portalObserver`'s removal branch below). Re-arming after a real
    // `stop()` is unaffected, which is how every consumer drives this.
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      // If every mutation in this batch came from our own overlay/curtain,
      // skip the re-extract entirely. Mixed batches (one user mutation +
      // overlay updates) still pass through normally.
      const allInternal = mutations.every((m) =>
        isInternalMutation(m, this.internalIds),
      );
      if (allInternal) return;

      this.recordMutations(mutations);
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
    this.inputListener = (e: Event) => {
      if (e.target instanceof Element) {
        this.pendingDirtyRoots.push(e.target);
      }
      this.scheduleChange();
    };
    this.root.addEventListener("input", this.inputListener, true);
    this.root.addEventListener("change", this.inputListener, true);

    // A popover shows and hides without an attribute changing, on it or on the
    // controls that invoke it, so no MutationRecord ever reports either. Its
    // `toggle` event is the only signal. That doesn't bubble, hence the capture
    // phase, and it is heard across `root`'s whole tree: a popover mounted
    // outside `root` still expands an invoker inside it. The event isn't
    // composed either, so a popover inside a shadow root below that tree is
    // not heard: its next refresh comes from whatever else changes. A
    // `<details>` or `<dialog>` fires one too, but changes its `open`
    // attribute as well, which the primary observer reports inside `root` and
    // `dialogObserver` below reports for a `<dialog>` outside it.
    this.toggleListener = (e: Event) => {
      if (
        e.target instanceof Element &&
        safeGetAttribute(e.target, "popover") !== null
      ) {
        this.pendingDirtyRoots.push(e.target);
        this.scheduleChange();
      }
    };
    this.toggleScope = safeRootNode(this.root);
    this.toggleScope.addEventListener("toggle", this.toggleListener, true);

    // Gaining or losing `popover` hides or shows an element, and changes what
    // an invoker naming it reads. Losing it fires `toggle` only on a showing
    // popover, and only once the attribute is gone. Inside `root` the primary
    // observer reports the change; outside it, only this does. That is rare,
    // so it asks for a full re-extraction, which also re-derives the scope.
    // A target outside `root` removed or renamed is still not heard, short of
    // watching the whole document's tree: its invoker catches up on the next
    // refresh anything else causes.
    this.popoverObserver = new MutationObserver((mutations) => {
      if (mutations.some((m) => !safeContains(this.root, m.target))) {
        this.scheduleFull();
      }
    });
    this.popoverObserver.observe(this.toggleScope, {
      subtree: true,
      attributes: true,
      attributeFilter: ["popover"],
    });

    // A `<dialog>` is commonly mounted once, outside `root` — at body level,
    // beside the app — and opened with showModal(). Extraction then pivots
    // onto it wherever it sits, since content behind a modal is inert. But
    // showModal() and close() mount nothing: they change the dialog's `open`
    // attribute, which the primary observer reports only inside `root`, so the
    // tree stayed on the page under an open modal and on the dialog after it
    // closed. Only a `<dialog>` outside `root` counts here. It asks for a full
    // re-extraction, which re-derives the scope, and while the dialog is open
    // as a modal it is watched inside like a portal overlay, since it is then
    // the whole tree. One opened with show() is not: it is never the whole
    // tree, and while it isn't in it at all, each change inside it would cost
    // a full re-extraction. Its `toggle` event is newer than the attribute,
    // and not every browser this runs in fires it.
    //
    // Only when `root` is in the document's own tree: a modal never takes the
    // scope from a root inside a shadow tree or a detached one (see
    // resolveEffectiveRoot), so a dialog opening there changes nothing. A
    // modal removed while still open is heard leaving its parent, or with a
    // child of `<body>`. One that leaves with any other ancestor is not: its
    // next refresh comes from whatever else changes, and its watch, with its
    // `input`/`change` listeners, stays on the detached dialog until stop().
    if (safeNodeType(this.toggleScope) === 9 /* DOCUMENT_NODE */) {
      const doc = this.toggleScope as Document;
      this.dialogObserver = new MutationObserver((mutations) => {
        let toggled = false;
        for (const m of mutations) {
          const el = m.target as Element;
          if (!this.isDialogOutsideRoot(el)) continue;
          this.syncDialogWatch(el);
          toggled = true;
        }
        if (toggled) this.scheduleFull();
      });
      this.dialogObserver.observe(doc, {
        subtree: true,
        attributes: true,
        attributeFilter: ["open"],
      });
      // One already open reports no change, but is watched the same.
      for (const dialog of safeQuerySelectorAll(doc, "dialog[open]")) {
        if (this.isDialogOutsideRoot(dialog)) this.syncDialogWatch(dialog);
      }
    }

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
    //
    // The root is the caller's, and may be a <form> whose control shadows
    // `contains`, so both questions about it go through the prototype.
    const body = this.root.ownerDocument?.body;
    if (body && body !== this.root && !safeContains(this.root, body)) {
      this.portalObserver = new MutationObserver((mutations) => {
        let sawPortal = false;
        for (const m of mutations) {
          // Removals before additions: a node reported in BOTH (a reparent
          // among body's children) then ends up observed, not torn down.
          for (const node of m.removedNodes) {
            // Key teardown on IDENTITY, not overlay shape. A wrapper can be
            // emptied first — its role-bearing child removed by a Radix/
            // Headless-UI exit animation — before it detaches, so
            // isPortalOverlayContainer would no longer match it. But it is
            // still the Map key we tracked on mount; re-checking the shape
            // here would leak its observer + listeners. Within it, too: an
            // open <dialog> is watched on its own, and can leave inside a
            // wrapper.
            const torn = this.unobservePortalContentWithin(node);
            if (torn.length > 0) {
              sawPortal = true;
              // A dialog among them can be moved rather than removed, and
              // shown as a modal again in the same task: its `open` flips
              // were handled before this, while it still looked watched, so
              // look at it afresh where it is now.
              for (const el of torn) {
                if (this.dialogObserver && this.isDialogOutsideRoot(el)) {
                  this.syncDialogWatch(el);
                }
              }
            } else if (isPortalOverlayContainer(node, this.internalIds)) {
              // A portal-shaped node we weren't tracking closed (e.g. one that
              // was already open before start()) — still worth a re-extract.
              sawPortal = true;
            }
          }
          for (const node of m.addedNodes) {
            if (isPortalOverlayContainer(node, this.internalIds)) {
              // Watch INSIDE the newly-opened overlay too, so its internal
              // changes keep the tree fresh — not just its open/close.
              this.observePortalContent(node as Element);
              sawPortal = true;
            }
          }
        }
        if (sawPortal) {
          // Portal mounts/unmounts happen outside `root`, so they produce no
          // MutationRecord the incremental path can splice. Flag a full
          // re-extraction so the extractor re-evaluates portal/modal scope.
          this.scheduleFull();
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
    // Tear down every open-portal observer + its input listeners. Runs before
    // `inputListener` is nulled below, since removeEventListener needs it.
    for (const [portal, observer] of this.portalContentObservers) {
      observer.disconnect();
      if (this.inputListener) {
        portal.removeEventListener("input", this.inputListener, true);
        portal.removeEventListener("change", this.inputListener, true);
      }
    }
    this.portalContentObservers.clear();
    for (const observer of this.dialogParentObservers.values()) {
      observer.disconnect();
    }
    this.dialogParentObservers.clear();
    if (this.inputListener) {
      this.root.removeEventListener("input", this.inputListener, true);
      this.root.removeEventListener("change", this.inputListener, true);
      this.inputListener = null;
    }
    if (this.popoverObserver) {
      this.popoverObserver.disconnect();
      this.popoverObserver = null;
    }
    if (this.dialogObserver) {
      this.dialogObserver.disconnect();
      this.dialogObserver = null;
    }
    if (this.toggleListener && this.toggleScope) {
      this.toggleScope.removeEventListener("toggle", this.toggleListener, true);
      this.toggleListener = null;
      this.toggleScope = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    this.pendingMutations = [];
    this.pendingDirtyRoots = [];
    this.pendingFull = false;
  }

  /**
   * Watch the contents of a portal-mounted overlay that lives OUTSIDE `root`
   * (Radix/Headless-UI/Teleport modals, menus, listboxes). The extractor
   * pivots onto the overlay via findActiveModal/findPortalOverlay, but the
   * primary observer only covers `root`'s subtree — so without this the
   * overlay's open/close re-extracts while changes INSIDE it (typing, aria-*
   * flips, submenu/content swaps) never do, and the panel goes stale.
   *
   * Idempotent; skips overlays already inside `root` (the primary observer
   * covers those) and ones already being watched.
   */
  private observePortalContent(portal: Element): void {
    if (safeContains(this.root, portal)) return;
    if (this.portalContentObservers.has(portal)) return;

    const observer = new MutationObserver((mutations) => {
      const allInternal = mutations.every((m) =>
        isInternalMutation(m, this.internalIds),
      );
      if (allInternal) return;
      this.recordMutations(mutations);
      this.scheduleChange();
    });
    observer.observe(portal, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
      characterData: true,
      characterDataOldValue: false,
    });
    this.portalContentObservers.set(portal, observer);

    // Typing inside the portal — like the primary root, `input`/`change`
    // events aren't visible to a MutationObserver.
    if (this.inputListener) {
      portal.addEventListener("input", this.inputListener, true);
      portal.addEventListener("change", this.inputListener, true);
    }
  }

  /** Tear down the observer + input listeners for a portal that unmounted. */
  private unobservePortalContent(portal: Element): void {
    const observer = this.portalContentObservers.get(portal);
    if (!observer) return;
    observer.disconnect();
    this.portalContentObservers.delete(portal);
    if (this.inputListener) {
      portal.removeEventListener("input", this.inputListener, true);
      portal.removeEventListener("change", this.inputListener, true);
    }
  }

  /** Tear down every watched overlay that is `node` or inside it, and return them. */
  private unobservePortalContentWithin(node: Node): Element[] {
    const torn: Element[] = [];
    for (const watched of [...this.portalContentObservers.keys()]) {
      if (!safeContains(node, watched)) continue;
      this.untrackDialog(watched);
      this.unobservePortalContent(watched);
      torn.push(watched);
    }
    return torn;
  }

  /** A `<dialog>` outside `root`, whose opening or closing can move the scope. */
  private isDialogOutsideRoot(el: Element): boolean {
    return safeMatches(el, "dialog") && !safeContains(this.root, el);
  }

  /**
   * Watch inside a `<dialog>` outside `root` while it is a modal, as a portal
   * overlay is watched, and stop once it isn't. Only a watch made here is
   * stopped: one the portal path made when the dialog mounted into `<body>`
   * stays, since a `show()` dialog with an overlay role is still in the tree.
   */
  private syncDialogWatch(dialog: Element): void {
    if (!isModal(dialog)) {
      this.untrackDialog(dialog);
      return;
    }
    // Watched already, itself or through the overlay it sits in.
    for (const watched of this.portalContentObservers.keys()) {
      if (safeContains(watched, dialog)) return;
    }
    // One holding `root` is the tree, but watching all of it would report
    // every change inside `root` twice. Its opening and closing still
    // refresh in full; a change inside it but outside `root` waits for the
    // next refresh something else causes.
    if (safeContains(dialog, this.root)) return;
    const parent = safeParentNode(dialog);
    if (!parent) return;
    this.observePortalContent(dialog);
    // Leaving its parent ends its modality, or moves it out of what this
    // watched, so either way the watch ends and the scope is re-derived.
    const observer = new MutationObserver((mutations) => {
      if (!mutations.some((m) => [...m.removedNodes].includes(dialog))) return;
      this.untrackDialog(dialog);
      // Moved, then closed and shown as a modal again in the same task: the
      // `open` flips were handled before this, while it still looked watched,
      // so look at it afresh where it is now.
      if (this.isDialogOutsideRoot(dialog)) this.syncDialogWatch(dialog);
      this.scheduleFull();
    });
    observer.observe(parent, { childList: true });
    this.dialogParentObservers.set(dialog, observer);
  }

  /** End a watch `syncDialogWatch` made: on its parent, then inside it. */
  private untrackDialog(dialog: Element): void {
    const observer = this.dialogParentObservers.get(dialog);
    if (!observer) return;
    observer.disconnect();
    this.dialogParentObservers.delete(dialog);
    this.unobservePortalContent(dialog);
  }

  /** Ask for a full re-extraction, for a change that can move the scope. */
  private scheduleFull(): void {
    this.pendingFull = true;
    this.scheduleChange();
  }

  private scheduleChange(): void {
    // Trailing-edge debounce: reset the quiet-period timer on each change.
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushChange(), this.debounceMs);

    // Max-wait ceiling: arm once at the start of a burst and do NOT reset it,
    // so a stream that never goes quiet (streaming responses, progress bars,
    // animated style updates) still flushes every maxWaitMs rather than
    // deferring onTreeChange indefinitely.
    if (this.maxWaitTimer === null) {
      this.maxWaitTimer = setTimeout(() => this.flushChange(), this.maxWaitMs);
    }
  }

  /**
   * Store non-internal mutations so they can be delivered to the callback
   * when the debounce fires. Internal-sentinel mutations are filtered out
   * because the callback should not react to the inspector's own overlays.
   */
  private recordMutations(mutations: MutationRecord[]): void {
    for (const m of mutations) {
      if (!isInternalMutation(m, this.internalIds)) {
        this.pendingMutations.push(m);
      }
    }
  }

  /** Fire the change callback and clear both the debounce and ceiling timers. */
  private flushChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }

    const change: TreeChange = {
      mutations: this.pendingMutations.length
        ? this.pendingMutations
        : undefined,
      dirtyRoots: this.pendingDirtyRoots.length
        ? this.pendingDirtyRoots
        : undefined,
      ...(this.pendingFull ? { full: true } : {}),
    };
    this.pendingMutations = [];
    this.pendingDirtyRoots = [];
    this.pendingFull = false;
    this.onTreeChange(change);
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
// The rule itself lives in `containsOverlaySignal` (extraction/dom-extractor).
// It used to be a hand-copied selector string here, in live-tree-extractor and
// in the extractor — three copies, and a fix applied to one silently did
// nothing on the other two.

/**
 * True if `node` looks like a portal-mounted overlay container — that
 * is, an element added/removed at the top level of `<body>` whose
 * subtree carries one of the role/attribute signals the extractor
 * uses to scope onto portal content. Skips our own injected overlay
 * sentinels.
 *
 * A node that cannot be asked — a `<form>` whose control shadows `matches` or
 * `getAttribute`, say — counts as one. Guessing "portal" costs a full
 * re-extraction; guessing "not" misses an overlay, and letting the throw out
 * loses every other node in the batch.
 */
function isPortalOverlayContainer(
  node: Node,
  internalIds: ReadonlySet<string>,
): boolean {
  // Clobber-safe: a `<form>` whose control is named `nodeType` reads as no
  // element at all, and a form mounted as the portal would go unnoticed.
  if (safeNodeType(node) !== 1 /* ELEMENT_NODE */) return false;
  const el = node as Element;
  if (internalIds.has(safeGetAttribute(el, "id") ?? "")) return false;
  try {
    return containsOverlaySignal(el);
  } catch {
    return true;
  }
}
