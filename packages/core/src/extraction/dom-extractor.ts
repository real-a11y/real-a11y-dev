import type { SemanticNode, ExtractionResult, ActionType } from "../types.js";
import { ElementRefMap } from "../utils/element-ref.js";
import { getNodeId } from "../utils/id-generator.js";

import {
  getImplicitRole,
  isHiddenFromAT,
  getHeadingLevel,
} from "./role-map.js";

/** Tags to skip entirely during extraction */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head"]);

/** Tags/roles that are focusable by default */
const NATIVELY_FOCUSABLE = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
]);

/** Input types that accept text entry */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "email",
  "password",
  "tel",
  "url",
  "search",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
  "color",
]);

/** Input types that toggle on click (no text entry) */
const TOGGLE_INPUT_TYPES = new Set(["checkbox", "radio"]);

/** Determine what actions an element supports */
function getActions(element: Element): ActionType[] {
  const tag = element.tagName.toLowerCase();
  const actions: ActionType[] = [];
  const role = element.getAttribute("role");

  // Links
  if (tag === "a" && element.hasAttribute("href")) {
    actions.push("click", "navigate");
  }
  // Buttons (native + input type=button/submit/reset/image)
  else if (
    tag === "button" ||
    (tag === "input" &&
      ["button", "submit", "reset", "image"].includes(
        (element as HTMLInputElement).type,
      ))
  ) {
    actions.push("click");
    if ((element as HTMLInputElement).type === "submit") {
      actions.push("submit");
    }
  }
  // Input elements — differentiate by type
  else if (tag === "input") {
    const type = (element as HTMLInputElement).type || "text";
    if (TOGGLE_INPUT_TYPES.has(type)) {
      actions.push("click");
    } else if (type === "file") {
      actions.push("focus");
    } else if (type === "range") {
      // Sliders aren't typeable — they listen for ArrowLeft/ArrowRight
      // (or use the .stepUp/.stepDown API). Pair the increment/decrement
      // actions so the panel can drive value changes under the Screen
      // Curtain too.
      actions.push("focus", "increment", "decrement");
    } else if (type === "number") {
      // Number inputs accept typed values *and* arrow-key stepping —
      // expose both so the panel can either set a value or nudge it.
      actions.push("focus", "type", "increment", "decrement");
    } else if (type !== "hidden") {
      actions.push("focus", "type");
    }
  }
  // Textarea — text entry
  else if (tag === "textarea") {
    actions.push("focus", "type");
  }
  // Select — option picker
  else if (tag === "select") {
    actions.push("focus", "select");
  }
  // Details / Summary — toggle
  else if (tag === "details" || tag === "summary") {
    actions.push("toggle");
  }
  // ARIA role-based actions
  else if (role === "button" || element.hasAttribute("onclick")) {
    actions.push("click");
  } else if (role === "checkbox" || role === "switch") {
    actions.push("click");
  } else if (role === "radio") {
    actions.push("click");
  } else if (role === "combobox" || role === "listbox") {
    // Custom combobox/listbox widget — dispatch click to open it natively.
    // We can't enumerate options from a custom control via GET_FIELD_STATE.
    // Native <select> elements are handled above by the tag === "select" branch.
    actions.push("click");
  } else if (role === "option") {
    // Listbox / combobox option — click to select it.
    // The parent widget handles selection state; we just dispatch the click.
    actions.push("click");
  } else if (
    role === "menuitem" ||
    role === "menuitemcheckbox" ||
    role === "menuitemradio"
  ) {
    actions.push("click");
  } else if (role === "tab") {
    actions.push("click");
  } else if (role === "treeitem") {
    actions.push("click");
  } else if (role === "gridcell") {
    actions.push("click");
  } else if (role === "row") {
    actions.push("click");
  } else if (role === "textbox" || role === "searchbox") {
    actions.push("focus", "type");
  } else if (role === "slider") {
    // ARIA slider: a custom widget (Radix `<span role="slider">`,
    // Headless UI, etc.) that listens for ArrowLeft/ArrowRight on the
    // element. "type" would set a `.value` property the widget never
    // reads — drop it. The dispatcher's increment/decrement focus the
    // element and dispatch real keydown events, which works equally
    // well under the Screen Curtain.
    actions.push("focus", "increment", "decrement");
  } else if (role === "spinbutton") {
    // Spinbuttons (date pickers, custom number steppers) accept both
    // typed values and arrow-key stepping. Surface both.
    actions.push("focus", "type", "increment", "decrement");
  }

  if (element.getAttribute("tabindex") !== null && actions.length === 0) {
    actions.push("click");
  }

  return actions;
}

/** Check if an element's subtree is completely hidden (display:none, hidden attr, content-visibility:hidden, inert) */
function isSubtreeHidden(element: Element): boolean {
  const htmlEl = element as HTMLElement;
  if (htmlEl.hidden) return true;

  // The HTML `inert` attribute hides the element AND its entire subtree
  // from both AT and keyboard navigation.
  if (htmlEl.hasAttribute("inert")) return true;

  if (typeof window !== "undefined" && window.getComputedStyle) {
    const computed = window.getComputedStyle(htmlEl);
    if (computed.display === "none") return true;
    // content-visibility:hidden skips rendering AND hides from AT
    // (used by frameworks like Yahoo Atomizer as Cntv(h))
    if (computed.contentVisibility === "hidden") return true;
  } else if (htmlEl.style?.display === "none") {
    return true;
  }

  return false;
}

/** Tags that are natively interactive — never treated as visually hidden */
const INTERACTIVE_TAGS = new Set([
  "input",
  "button",
  "select",
  "textarea",
  "a",
  "details",
  "summary",
]);

/**
 * Detect the sr-only / visually-hidden CSS pattern:
 * position:absolute + tiny dimensions + clip or clip-path.
 * These elements ARE intentionally accessible to AT, but not visible.
 *
 * Interactive elements (inputs, buttons, links) are EXCLUDED — they commonly use
 * opacity:0 / position:absolute behind custom-styled visuals and remain fully usable.
 */
function isSrOnly(element: Element): boolean {
  if (typeof window === "undefined" || !window.getComputedStyle) return false;

  // Custom form controls hide the native input behind a visual — not sr-only
  const tag = element.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return false;
  if (element.hasAttribute("tabindex")) return false;

  const computed = window.getComputedStyle(element as HTMLElement);
  if (computed.position !== "absolute" && computed.position !== "fixed")
    return false;

  // Classic clip: rect(0,0,0,0) or rect(1px,1px,1px,1px)
  const clip = computed.clip;
  if (clip && clip !== "auto") {
    const w = parseFloat(computed.width);
    const h = parseFloat(computed.height);
    if ((w <= 1 || isNaN(w)) && (h <= 1 || isNaN(h))) return true;
  }

  // Modern: clip-path: inset(50%) or inset(100%)
  const clipPath = computed.clipPath;
  if (
    clipPath &&
    (clipPath.startsWith("inset(5") || clipPath.startsWith("inset(1"))
  ) {
    return true;
  }

  return false;
}

/** Check if an element is visually hidden (computed styles) */
function isVisuallyHidden(element: Element): boolean {
  if (isSubtreeHidden(element)) return true;

  if (typeof window !== "undefined" && window.getComputedStyle) {
    const computed = window.getComputedStyle(element as HTMLElement);
    if (computed.visibility === "hidden") return true;
    // NOTE: opacity:0 is intentionally NOT checked here.
    // Custom form controls (radio, checkbox, file inputs) routinely use
    // opacity:0 to hide the native widget behind a custom visual while
    // keeping it interactive. opacity:0 is also not a WAI-ARIA hiding
    // mechanism — AT still reads opacity-0 elements.
  } else if ((element as HTMLElement).style?.visibility === "hidden") {
    return true;
  }

  // sr-only pattern: visually hidden but intentionally accessible to AT
  if (isSrOnly(element)) return true;

  return false;
}

/**
 * Compute the accessible description for an element.
 * Resolves aria-describedby IDs to text and falls back to aria-description.
 */
function computeAccessibleDescription(element: Element): string {
  // 1. aria-describedby — resolve referenced element text
  const describedBy = element.getAttribute("aria-describedby");
  if (describedBy) {
    const doc = element.ownerDocument;
    const texts = describedBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const target = doc.getElementById(id);
        return target ? getAccessibleTextContent(target).trim() : undefined;
      })
      .filter((t): t is string => !!t);
    if (texts.length) return texts.join(" ");
  }
  // 2. aria-description — inline string (ARIA 1.3+)
  return element.getAttribute("aria-description") || "";
}

/**
 * Roles that act as a name-from-content "barrier" — when encountered as a
 * descendant during name computation, their subtree contributes the empty
 * string instead of being concatenated into the ancestor's name.
 *
 * Why this exists: a `<li role="treeitem">Reports<ul role="group"><li
 * role="treeitem">report-1</li>...</ul></li>` has, by ARIA name-from-
 * content, a recursive text content of "Reports report-1 report-2 ...".
 * Real assistive tech reads only "Reports" for that row — each nested
 * treeitem is a sibling row with its own announceable name, not part of
 * its parent's name. Without this filter the inspector showed the
 * polluted concatenation (surfaced on PR #80's APG Tree View example).
 *
 * The set covers:
 *   - Containers / structural groups: group, list, menu, tree, listbox,
 *     tablist, toolbar, treegrid, grid, table, rowgroup, combobox.
 *   - Row / item widgets that carry their own name: treeitem, menuitem*,
 *     option, tab, listitem, row, cell, gridcell, columnheader,
 *     rowheader.
 *   - Interactive widgets that own their accessible name: button, link,
 *     checkbox, radio, switch, slider, spinbutton, textbox, searchbox.
 *   - Display widgets / live regions: dialog, alertdialog, tabpanel,
 *     alert, status, log, tooltip, progressbar, meter.
 *
 * Intentionally NOT included (walked into so their text contributes):
 *   - generic, presentation, none — transparent.
 *   - Inline formatting roles: strong, emphasis, code, mark, deletion,
 *     insertion, subscript, superscript, term, definition, paragraph,
 *     blockquote, caption, figcaption, time, separator, img.
 *   - heading — kept walkable so a button/tab whose label is a heading
 *     still picks up the heading's text (e.g. `<button><h3>X</h3>`).
 */
const NAME_BARRIER_ROLES = new Set<string>([
  // Containers / structural groups
  "group",
  "list",
  "menu",
  "menubar",
  "tree",
  "listbox",
  "tablist",
  "toolbar",
  "treegrid",
  "grid",
  "table",
  "rowgroup",
  "combobox",
  // Row / item widgets with their own name
  "treeitem",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "listitem",
  "row",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  // Interactive widgets that own their accessible name
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "textbox",
  "searchbox",
  // Display widgets / live regions
  "dialog",
  "alertdialog",
  "tabpanel",
  "alert",
  "status",
  "log",
  "tooltip",
  "progressbar",
  "meter",
]);

/**
 * Recursive text-content walker for accessible name/description computation.
 *
 * Per WAI-ARIA accname-1.2 §4.3.2 step 2A, hidden subtrees contribute the
 * empty string. Skip element descendants that are aria-hidden, hidden,
 * inert, or display/visibility/content-visibility-hidden.
 *
 * Also skips descendants whose computed role is in `NAME_BARRIER_ROLES` —
 * see the set's docstring for the reasoning (treeitem-in-group, nested
 * widgets, etc.).
 *
 * The root element itself is NOT checked — callers reach this with an
 * element that is either already exposed to AT (name-from-content) or
 * directly referenced by aria-labelledby / a host-language label (the
 * spec's "directly referenced" carve-out).
 */
function getAccessibleTextContent(element: Element): string {
  let text = "";
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (childEl.getAttribute("aria-hidden") === "true") continue;
      if (isSubtreeHidden(childEl)) continue;
      if (NAME_BARRIER_ROLES.has(getImplicitRole(childEl))) continue;
      text += getAccessibleTextContent(childEl);
    }
  }
  return text;
}

/** Compute the accessible name for an element (simplified) */
/**
 * Accessible name, whitespace-normalized per accname-1.2 §4.3.2 step 4:
 * collapse runs of whitespace — including the stray newlines/indentation some
 * pages leave inside their markup — to a single space, and trim. Normalizing
 * at this single source means every surface (panel, search, serializer,
 * snapshots) sees the same clean name.
 */
function computeAccessibleName(element: Element): string {
  return computeRawAccessibleName(element).replace(/\s+/g, " ").trim();
}

function computeRawAccessibleName(element: Element): string {
  // 1. aria-label takes priority
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  // 2. aria-labelledby (simplified: resolve first ID)
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = element.ownerDocument;
    const names = labelledBy
      .split(/\s+/)
      .map((id) => {
        const target = doc.getElementById(id);
        return target ? getAccessibleTextContent(target).trim() : "";
      })
      .filter(Boolean);
    if (names.length) return names.join(" ");
  }

  const tag = element.tagName.toLowerCase();

  // 3. alt attribute for images
  if (tag === "img" || tag === "area") {
    const alt = element.getAttribute("alt");
    if (alt !== null) return alt;
  }

  // 4. Label element for form controls
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const id = element.getAttribute("id");
    if (id) {
      const label = element.ownerDocument.querySelector(`label[for="${id}"]`);
      if (label) return getAccessibleTextContent(label).trim();
    }
    // Wrapping label pattern: <label>Full name<input /></label>
    // Walk the label's child nodes and collect text from everything that is
    // NOT the form control itself (skips input/textarea/select siblings too).
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) {
      const FORM_CONTROL_TAGS = new Set(["input", "select", "textarea"]);
      const parts: string[] = [];
      for (const child of wrappingLabel.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent?.trim();
          if (text) parts.push(text);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const childEl = child as Element;
          if (childEl === element) continue;
          const childTag = childEl.tagName.toLowerCase();
          if (FORM_CONTROL_TAGS.has(childTag)) continue;
          if (childEl.getAttribute("aria-hidden") === "true") continue;
          if (isSubtreeHidden(childEl)) continue;
          const text = getAccessibleTextContent(childEl).trim();
          if (text) parts.push(text);
        }
      }
      const labelText = parts.join(" ");
      if (labelText) return labelText;
    }
  }

  // 4a. Fieldset — accessible name comes from its direct <legend> child
  if (tag === "fieldset") {
    const legend = element.querySelector(":scope > legend");
    if (legend) return getAccessibleTextContent(legend).trim();
  }

  // 4b. Details — accessible name comes from its direct <summary> child
  if (tag === "details") {
    const summary = element.querySelector(":scope > summary");
    if (summary) return getAccessibleTextContent(summary).trim();
  }

  // 5. Value/placeholder for inputs
  if (tag === "input") {
    const input = element as HTMLInputElement;
    if (input.value) return input.value;
    if (input.placeholder) return input.placeholder;
  }

  // 6. title attribute
  const title = element.getAttribute("title");
  if (title) return title;

  // 7. Recursive text content — ONLY for elements whose ARIA role supports
  //    "name from content" (headings, links, buttons, table cells, options).
  //    NOT for generic containers (div, span, p) which would grab huge text blobs.
  const NAMES_FROM_CONTENT_TAGS = new Set([
    "a",
    "button",
    "summary",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "label",
    "legend",
    "caption",
    "figcaption",
    "option",
    "td",
    "th",
  ]);
  const explicitRole = element.getAttribute("role");
  const namesFromContentRole =
    explicitRole === "button" ||
    explicitRole === "link" ||
    explicitRole === "heading" ||
    explicitRole === "option" ||
    explicitRole === "treeitem" ||
    explicitRole === "tab" ||
    explicitRole === "menuitem" ||
    explicitRole === "cell";

  if (NAMES_FROM_CONTENT_TAGS.has(tag) || namesFromContentRole) {
    const fullText = getAccessibleTextContent(element).trim();
    if (fullText) return fullText;
  }

  // 8. Fallback: direct text content only (for generic/container elements)
  const directText = getDirectTextContent(element);
  if (directText) return directText;

  return "";
}

/** Get direct text content of an element, excluding child element text */
function getDirectTextContent(element: Element): string {
  let text = "";
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || "";
    }
  }
  return text.trim();
}

/** Hard cap so we don't store huge text blobs on every node. */
const DESCENDANT_TEXT_MAX = 240;

/**
 * Recursive text content with whitespace collapsed and a hard length cap.
 * Used as a panel preview for elements whose accessible name is empty per
 * spec but which carry meaningful descendant text (`<code>`, `<pre>`,
 * `<svg>` with `<text>`, decorative wrappers around copy, etc.).
 */
function getDescendantText(element: Element): string {
  const raw = element.textContent ?? "";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= DESCENDANT_TEXT_MAX) return collapsed;
  return collapsed.slice(0, DESCENDANT_TEXT_MAX - 1) + "…";
}

/** Get key attributes for display */
function getKeyAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrNames = [
    "id",
    "class",
    "href",
    "src",
    "type",
    "name",
    "role",
    "aria-label",
    "aria-expanded",
    "aria-hidden",
    "aria-checked",
    "aria-disabled",
    "aria-required",
    "aria-controls",
    "aria-haspopup",
    "alt",
    "title",
    "for",
    "action",
    "method",
    "placeholder",
    "tabindex",
  ];

  for (const name of attrNames) {
    const val = element.getAttribute(name);
    if (val !== null) {
      attrs[name] = val;
    }
  }

  // Read current value from DOM property (not HTML attribute) for form controls
  // getAttribute("value") returns the initial value; .value reflects user input
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const currentValue = (element as HTMLInputElement).value;
    if (currentValue) {
      attrs["value"] = currentValue;
    }
  }

  return attrs;
}

/** Get ARIA states from an element */
function getAriaStates(element: Element): Record<string, string | boolean> {
  const states: Record<string, string | boolean> = {};
  const tag = element.tagName.toLowerCase();

  // Boolean ARIA states
  const booleanAttrs = [
    "aria-expanded",
    "aria-checked",
    "aria-disabled",
    "aria-hidden",
    "aria-pressed",
    "aria-selected",
    "aria-required",
    "aria-readonly",
    "aria-busy",
    "aria-current",
  ];

  for (const attr of booleanAttrs) {
    const val = element.getAttribute(attr);
    if (val !== null) {
      const key = attr.replace("aria-", "");
      states[key] = val === "true" ? true : val === "false" ? false : val;
    }
  }

  // Native HTML states
  const htmlEl = element as HTMLInputElement;
  if (
    tag === "input" ||
    tag === "button" ||
    tag === "select" ||
    tag === "textarea"
  ) {
    if (htmlEl.disabled) states["disabled"] = true;
    if ("checked" in htmlEl && htmlEl.checked) states["checked"] = true;
    if ("required" in htmlEl && htmlEl.required) states["required"] = true;
  }

  if (tag === "details") {
    states["expanded"] = (element as HTMLDetailsElement).open;
  }

  return states;
}

/** The element reference map — shared across extractions */
const elementRefs = new ElementRefMap();

/** Get the shared element reference map */
export function getElementRefs(): ElementRefMap {
  return elementRefs;
}

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
function isActuallyVisible(element: Element): boolean {
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
    if (isSubtreeHidden(el)) return false;
    el = el.parentElement;
  }
  return true;
}

/**
 * Find the active modal dialog, if any.
 * When a modal is active, content behind it is inert — screen readers
 * scope navigation exclusively to the modal content.
 */
function findActiveModal(doc: Document): Element | null {
  // Visible dialog elements:
  //   - [aria-modal="true"]: explicit modal hint.
  //   - [role="dialog"] / [role="alertdialog"]: any rendered dialog.
  //     Radix Dialog ≥1.1 and several modern libs no longer set
  //     aria-modal — they rely on sibling-aria-hidden + focus trap
  //     instead. AT still scopes to a visible role="dialog", so we do
  //     too. Visibility check filters out closed/unmounted dialogs.
  const dialogs = doc.querySelectorAll(
    '[aria-modal="true"], [role="dialog"], [role="alertdialog"]',
  );
  for (let i = dialogs.length - 1; i >= 0; i--) {
    // Must check full ancestor chain — parent may have display:none even if
    // the dialog element itself has no hiding style (isSubtreeHidden only
    // checks the element itself, not ancestors).
    if (isActuallyVisible(dialogs[i])) return dialogs[i];
  }

  // Native <dialog> opened with showModal() — matches :modal pseudo-class
  try {
    const nativeModals = doc.querySelectorAll("dialog:modal");
    if (nativeModals.length > 0) {
      return nativeModals[nativeModals.length - 1];
    }
  } catch {
    // :modal pseudo-class not supported in this environment
  }

  return null;
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
  if (!body || body === root || root.contains(body)) return null;

  // Non-modal portal roles. Modals are handled by findActiveModal().
  const overlays = doc.querySelectorAll(
    '[role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], ' +
      '[role="status"], [role="alert"], [role="log"], [aria-live]',
  );
  for (const el of overlays) {
    if (!root.contains(el) && isActuallyVisible(el)) {
      return body;
    }
  }
  return null;
}

/** Extract a complete DOM tree from a root element */
export function extractDomTree(root: Element): ExtractionResult {
  const nodes = new Map<string, SemanticNode>();

  // Scope selection, in priority order:
  //   1. Active modal — scopes exclusively to the modal (content
  //      behind a modal is inert to AT).
  //   2. Portal overlay outside root — non-modal overlay (menu,
  //      tooltip, toast, listbox) mounted into body by React Portal
  //      etc. Pivot to body so the portal content joins the tree.
  //   3. Configured root — the default.
  const activeModal = findActiveModal(root.ownerDocument);
  const portalRoot = activeModal
    ? null
    : findPortalOverlay(root.ownerDocument, root);
  const effectiveRoot = activeModal || portalRoot || root;

  // Pre-collect aria-labelledby targets so we don't accidentally hide them.
  // (Elements that are labelledby targets are visible content — they label something.)
  const labelTargetIds = new Set<string>();
  for (const el of effectiveRoot.querySelectorAll("[aria-labelledby]")) {
    for (const id of (el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean)) {
      labelTargetIds.add(id);
    }
  }

  // Pre-collect aria-describedby targets.
  // These elements' text is shown inline on the referencing element as a description.
  // Hide them from the tree to avoid redundancy — unless they're also labelledby targets.
  const descriptionTargetIds = new Set<string>();
  for (const el of effectiveRoot.querySelectorAll("[aria-describedby]")) {
    for (const id of (el.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter(Boolean)) {
      if (!labelTargetIds.has(id)) {
        descriptionTargetIds.add(id);
      }
    }
  }

  function walk(
    element: Element,
    parentId: string | null,
    depth: number,
  ): string | null {
    const tag = element.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;

    // Skip Semantic Navigator internal elements (highlight overlay, curtain, etc.)
    if (element.id?.startsWith("__sn-")) return null;

    // Skip entire subtrees of display:none / hidden elements
    if (isSubtreeHidden(element)) return null;

    // Skip elements that serve solely as aria-describedby text providers.
    // Their content is shown inline on the referencing element as a description.
    const ownId = element.getAttribute("id");
    if (ownId && descriptionTargetIds.has(ownId)) return null;

    const id = getNodeId(element);
    elementRefs.set(id, element);

    const role = getImplicitRole(element);
    const actions = getActions(element);
    const isFocusable =
      NATIVELY_FOCUSABLE.has(tag) || element.getAttribute("tabindex") !== null;

    const node: SemanticNode = {
      id,
      parentId,
      childIds: [],
      depth,
      dom: {
        tagName: tag,
        attributes: getKeyAttributes(element),
        textContent: getDirectTextContent(element),
        descendantText: getDescendantText(element),
        isHidden: isVisuallyHidden(element),
      },
      a11y: {
        role,
        name: computeAccessibleName(element),
        description: computeAccessibleDescription(element),
        states: getAriaStates(element),
        properties: {
          ...(getHeadingLevel(element) !== null
            ? { level: String(getHeadingLevel(element)) }
            : {}),
        },
        isExposedToAT: !isHiddenFromAT(element),
      },
      interaction: {
        isInteractive: actions.length > 0,
        actions,
        isFocusable,
        isEditable:
          (tag === "input" &&
            TEXT_INPUT_TYPES.has(
              (element as HTMLInputElement).type || "text",
            )) ||
          tag === "textarea" ||
          element.getAttribute("contenteditable") === "true",
      },
      ui: {
        expanded: depth < 2,
        highlighted: false,
        matchesFilter: true,
        selected: false,
      },
    };

    nodes.set(id, node);

    // Walk children
    for (const child of element.children) {
      const childId = walk(child, id, depth + 1);
      if (childId) {
        node.childIds.push(childId);
      }
    }

    return id;
  }

  const rootId = walk(effectiveRoot, null, 0);

  return { nodes, rootId: rootId || "" };
}
