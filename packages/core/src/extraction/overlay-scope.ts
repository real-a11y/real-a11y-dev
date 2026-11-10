import {
  safeContains,
  safeGetAttribute,
  safeMatches,
  safeOwnerDocument,
  safeParentElement,
  safeQuerySelectorAll,
  safeTextContent,
} from "./clobber-safe.js";
import { isOutOfReach } from "./overlay-reach.js";
import {
  getCachedComputedStyle,
  getExplicitRole,
  isSubtreeHidden,
  type StyleCache,
} from "./role-map.js";

/**
 * Check if an element is actually visible on screen, considering all ancestors.
 *
 * `isSubtreeHidden()` only checks the element itself — `display:none` is NOT
 * CSS-inherited, so a parent's display:none is invisible to a child's
 * getComputedStyle(). This function walks the full ancestor chain.
 *
 * Uses `checkVisibility()` (Chrome 105+) when available; falls back to walking
 * ancestors manually.
 */
function isActuallyVisible(
  element: Element,
  styleCache?: StyleCache | null,
): boolean {
  // checkVisibility() considers the full ancestor chain for display, visibility,
  // and content-visibility — exactly what we need here.
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({
      checkOpacity: false, // opacity:0 is not an AT-hiding mechanism
      checkVisibilityCSS: true, // catches display:none and visibility:hidden on any ancestor
    });
  }
  // Fallback: walk the ancestor chain and apply our own isSubtreeHidden check
  let el: Element | null = element;
  while (el) {
    if (isSubtreeHidden(el, getCachedComputedStyle(el, styleCache)))
      return false;
    el = safeParentElement(el);
  }
  return true;
}

/**
 * True if `element` is a MODAL dialog — one the BROWSER has made modal, so the
 * content behind it is inert and extraction scopes exclusively to it.
 *
 * That is only a `<dialog>` opened with showModal() (the `:modal`
 * pseudo-class), which is exactly the rule Chromium's own accessibility tree
 * applies: it drops the page behind a `:modal` dialog and keeps it behind
 * everything else.
 *
 * `aria-modal="true"` is deliberately NOT a signal. It is a claim the author
 * makes to assistive tech, not a state the browser enforces, and Chromium does
 * not prune for it. Honoring it here made the DOM producer disagree with the
 * native one on two shapes seen in the wild:
 *   - a CLOSED drawer left mounted with `aria-modal="true" aria-hidden="true"`
 *     and translated off-screen. It passes a CSS visibility check, so it won
 *     the scope and the whole page extracted as an empty tree.
 *   - a non-blocking cookie bar marked `aria-modal="true"`, which collapsed an
 *     interactive page down to the banner's four buttons.
 *
 * Libraries that really are modal still come out right without it: Radix and
 * MUI `aria-hidden` the siblings, Headless UI makes them `inert`, and the walk
 * already drops both — the same way Chromium does. An `aria-modal` dialog is an
 * ordinary overlay here, joining the tree through `findPortalOverlay`.
 *
 * Exported so `DomObserver` watches inside exactly the dialogs this pivots to.
 *
 * Reads `element.matches` directly rather than through `safeMatches`, which
 * captures the method when the module loads: jsdom has no `:modal`, so tests
 * fake it by spying on `Element.prototype.matches`, and would silently stop
 * faking it. It is only ever asked about a `<dialog>`, which no control can
 * shadow a member of.
 */
export function isModal(element: Element): boolean {
  try {
    return element.matches(":modal");
  } catch {
    // :modal pseudo-class not supported in this environment
    return false;
  }
}

/**
 * Find the active modal dialog, if any — see {@link isModal} for what counts.
 */
function findActiveModal(doc: Document): Element | null {
  // Per element rather than `querySelectorAll("dialog:modal")`, so an
  // environment that cannot parse `:modal` degrades to "no modal" in one place.
  // Last-to-first so the top-most of a stack of modals wins.
  const dialogs = safeQuerySelectorAll(doc, "dialog");
  for (let i = dialogs.length - 1; i >= 0; i--) {
    if (isModal(dialogs[i])) return dialogs[i];
  }
  return null;
}

/**
 * "This overlay is displaying something" — a natively focusable control (an
 * icon-only menu item carries no text but the menu is unmistakably up) or a
 * graphic.
 *
 * Deliberately NOT `[tabindex]`: an empty toast viewport is routinely given
 * `tabindex="-1"` for focus management (Radix Toast and Sonner both render
 * `<ol tabindex="-1">` while holding zero toasts), so counting it would let
 * exactly the empty shells this guard exists to catch back through. Custom
 * widgets that are genuinely showing still qualify — an icon-only one through
 * its `img`/`svg`, a labelled one through its text.
 */
const OVERLAY_CONTENT_SELECTOR = "a, button, input, select, textarea, img, svg";

/**
 * True if a portal-mounted overlay actually has something in it — collapsed
 * text, a focusable descendant, or a graphic.
 *
 * Component kits mount a PERMANENT, empty live-region announcer or toast
 * viewport at body level on first render (Sonner, react-hot-toast, Radix
 * Toast, MUI Snackbar). Those shells are display-visible, so a
 * visibility-only test reads them as a showing overlay — and because they are
 * never removed, the body pivot they trigger is never released either. A
 * caller's `root` would be dead for the rest of the session rather than just
 * while a toast is up. Requiring content ties the pivot to an overlay that is
 * genuinely showing something, which is the state the pivot exists to serve.
 *
 * Emptiness is deliberately NOT "no text": an icon-only menu or a toast whose
 * only content is an image is showing just as much as one with a sentence.
 */
function hasOverlayContent(element: Element): boolean {
  // Selector first: it is native, stops at the first hit, and a real overlay
  // (dialog, menu, listbox) almost always holds a control — so the common
  // case returns without walking the subtree for text.
  if (element.querySelector(OVERLAY_CONTENT_SELECTOR) !== null) return true;
  return safeTextContent(element).trim() !== "";
}

/**
 * Find portal-mounted *overlay* content sitting outside the configured
 * root. Returns `document.body` (the natural superset of root +
 * portals) when any non-modal overlay role exists outside root — i.e.
 * a dropdown menu, a listbox popover, a tooltip, or a live-region
 * toast that mounted via React Portal / Vue Teleport.
 *
 * Modal dialogs are handled separately by `findActiveModal()`: when a
 * modal is open, AT scoping is exclusive to the modal, not "root +
 * modal" — so the modal path takes precedence over this one.
 *
 * Returns `null` when there's nothing portal-mounted outside `root`
 * — extraction stays scoped to `root` as before.
 */
function findPortalOverlay(doc: Document, root: Element): Element | null {
  const body = doc.body;
  if (!body || body === root || safeContains(root, body)) return null;

  // Portal-mounted overlay roles. MODAL dialogs are handled exclusively by
  // findActiveModal() (which takes precedence). A NON-modal role="dialog"
  // (cookie banner, Radix Popover) is additive like any other overlay — it is
  // included here so it pivots to body and joins the tree, rather than
  // hijacking the scope the way findActiveModal used to.
  const overlays = safeQuerySelectorAll(doc, OVERLAY_CANDIDATE_SELECTOR);
  for (const el of overlays) {
    // A candidate is read through members its own controls can shadow — a
    // `<form role="search">` holding `<input name="getAttribute">` is a
    // candidate like any `[role]` element. One that cannot answer is skipped,
    // as the walk skips an element it cannot read, rather than aborting every
    // extraction on the page.
    try {
      // Outside the root means ELSEWHERE, not "above". An ancestor is not a
      // portal by any definition, and treating it as one made every component
      // root on an SPA pivot permanently: the route announcers Next.js, Remix
      // and React Router ship are typically an `aria-live` wrapper around the
      // whole app, so it matched on every extraction rather than only while a
      // toast was up.
      if (safeContains(root, el) || safeContains(el, root)) continue;
      if (!countsAsOverlay(el)) continue;
      // An overlay AT cannot reach adds nothing to the tree, so it is no
      // reason to widen: a closed drawer left mounted as `aria-hidden` (and
      // translated off-screen, so the CSS check passes) turned every component
      // root on the page into a whole-page snapshot. Nor is a panel's own
      // live region, where it says what changed: a panel mounted in the
      // light DOM would widen every tree once it spoke.
      if (isOutOfReach(el)) continue;
      if (isActuallyVisible(el) && hasOverlayContent(el)) return body;
    } catch {
      // Unreadable: not an overlay this scan can pivot to.
    }
  }
  return null;
}

/**
 * Candidate elements for the overlay scan.
 *
 * Deliberately broad: `countsAsOverlay` makes the real decision in JS, so the
 * selector only has to be a superset. Enumerating the ten role clauses made
 * the engine re-read `role` on every element in the document — measured 5.4×
 * slower on a 3,104-element page than this — and it is the shape that drifted,
 * since the same list existed in three files and only one of them was updated.
 * Exported so the observers share it rather than keeping their own copy.
 */
export const OVERLAY_CANDIDATE_SELECTOR = "[role], [aria-live]";

/** Overlay roles that are containers, not announcements. */
const OVERLAY_ROLES = new Set([
  "menu",
  "menubar",
  "listbox",
  "tooltip",
  "dialog",
  "alertdialog",
]);

/** Roles that are live regions by default (implicit `aria-live`). */
const IMPLICIT_LIVE_ROLES = new Set(["status", "alert", "log"]);

/**
 * Does this element actually behave as an overlay or live region?
 *
 * `aria-live` is an ALLOWLIST, not `!== "off"`. A denylist admitted the common
 * hand-written spellings of "switched off" — `none`, `false`, `0`, and typos
 * like `polit` — pivoting the whole extraction for elements whose author meant
 * the opposite. An absent, empty or invalid value falls through to the role's
 * implicit politeness, which is what ARIA specifies and what makes
 * `<div aria-live>` and `<div aria-live="">` behave like the roleless divs
 * they are.
 *
 * The role is read with `getExplicitRole`, the parse `getImplicitRole` uses —
 * the first token Chromium recognises, ASCII-case-folded — so the pivot and
 * the extracted tree always agree about what an element is:
 * `role="toast status"` is a status, `role="MENU"` a menu. Never fold or skip
 * tokens here on its own: a pivot that folded while the tree didn't once made
 * `<div role="MENU" aria-live="off">` an overlay that the tree said was no
 * menu, so the element's scoping hung on an unrelated attribute.
 */
export function countsAsOverlay(el: Element): boolean {
  const role = getExplicitRole(el);
  if (role && OVERLAY_ROLES.has(role)) return true;

  // `aria-live` values ARE case-insensitive tokens, unlike `role` above.
  const live = safeGetAttribute(el, "aria-live")?.trim().toLowerCase();
  if (live === "polite" || live === "assertive") return true;
  if (live === "off") return false;
  return role ? IMPLICIT_LIVE_ROLES.has(role) : false;
}

/**
 * The observers' candidate selector — the overlay set plus the two modal
 * signals, which extraction handles separately in `findActiveModal` but which
 * a mutation observer still has to wake for.
 */
const OVERLAY_SIGNAL_SELECTOR = `${OVERLAY_CANDIDATE_SELECTOR}, [aria-modal="true"], dialog`;

/**
 * An element that is itself an overlay signal. Any mounted element is asked,
 * so `matches` goes through the prototype: `<input name="matches">` shadows it
 * on a <form>, and an observer that cannot ask has to guess "overlay". The
 * panel's change marks ask it too, of the rows a read widened to the whole
 * page brings.
 *
 * @internal Shared by the extractor, the observers and the panel's change
 * marks; not a stability promise.
 */
export function isOverlaySignal(el: Element): boolean {
  return safeMatches(el, '[aria-modal="true"], dialog') || countsAsOverlay(el);
}

/**
 * Does this node, or anything in its subtree, carry an overlay signal worth a
 * full re-extract?
 *
 * Shared with the observers so the rule lives in ONE place. It previously
 * existed as a hand-copied selector string in three files, and a fix applied
 * to one of them silently did nothing on the other two: a `role="status
 * announcer"` toast pivoted a one-shot `treeSnapshot` while never waking the
 * inspector, the extension, or a live MCP session — the same DOM producing two
 * different trees depending on which path ran.
 *
 * The candidate selector is broad, so the `countsAsOverlay` filter is what
 * keeps the observers' original property intact: a plain `<div role="region">`
 * analytics widget mounting at body level still triggers nothing.
 */
export function containsOverlaySignal(el: Element): boolean {
  if (isOverlaySignal(el)) return true;
  const candidates = el.querySelectorAll?.(OVERLAY_SIGNAL_SELECTOR);
  if (!candidates) return false;
  for (const candidate of candidates) {
    if (isOverlaySignal(candidate)) return true;
  }
  return false;
}

/**
 * The element extraction is actually scoped to, in priority order:
 *   1. Active modal — content behind a modal is inert to AT, so the tree
 *      scopes EXCLUSIVELY to the modal.
 *   2. Portal overlay outside `root` — a non-modal overlay (menu, tooltip,
 *      toast, listbox) mounted into body by React Portal / Vue Teleport.
 *      Pivot to body so the portal content joins the tree.
 *   3. The configured root — the default.
 *
 * Exported so {@link LiveTreeExtractor} can ask "did the scope move?" on an
 * incremental refresh without duplicating — and drifting from — the selector
 * lists above. Scope is a property of the whole document (overlay shape AND
 * the full ancestor visibility chain), so it cannot be inferred from a single
 * mutated element; the incremental path has to re-derive it.
 */
export function resolveEffectiveRoot(root: Element): Element {
  const doc = safeOwnerDocument(root);
  if (!doc) return root;

  // A pivot may only ever WIDEN. Both targets — an open modal, or `body` —
  // are elements in the document with no necessary relationship to `root`, so
  // an unrelated one produces a disjoint tree: the caller's own subtree
  // disappears and the audit describes markup they never passed.
  // `collectFindings` then returns *no findings* for a component with real
  // ones, because it audited somebody else's DOM.
  //
  // Expressed as containment rather than `isConnected`, which was only a proxy
  // for it and missed two shapes of the same loss:
  //
  //   - a root inside a SHADOW root. `isConnected` is shadow-including but the
  //     walk used to read light-DOM `children` only, so a web
  //     component audited at its shadow subtree lost all of its content to any
  //     light-DOM toast — while reading as "connected", so the guard was a
  //     no-op for it.
  //   - an ANCESTOR live region, handled in `findPortalOverlay`: "outside the
  //     root" was reading as "portal-mounted elsewhere" and quietly accepting
  //     anything above it too.
  //
  // A modal keeps precedence and keeps scoping EXCLUSIVELY, including over a
  // root that is merely its sibling: content behind a modal is inert to AT, so
  // "the page is showing a dialog" is the honest answer for anything on that
  // page. That is deliberate and covered by dom-extractor.test.ts.
  //
  // It cannot apply to a root the DOCUMENT does not contain, though. There is
  // no "behind" relationship to model — the root is not on the page at all —
  // so the result would simply share nothing with what the caller passed.
  // `doc.contains` is not shadow-including, which is what makes it cover the
  // shadow case as well as the detached one.
  const activeModal = findActiveModal(doc);
  if (activeModal && safeContains(doc, root)) return activeModal;

  const overlayScope = findPortalOverlay(doc, root);
  return overlayScope?.contains(root) ? overlayScope : root;
}
