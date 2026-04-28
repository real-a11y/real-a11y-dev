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
  } else if (role === "slider" || role === "spinbutton") {
    actions.push("focus", "type");
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
    if ((computed as any).contentVisibility === "hidden") return true;
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
      .map((id) => doc.getElementById(id)?.textContent?.trim())
      .filter((t): t is string => !!t);
    if (texts.length) return texts.join(" ");
  }
  // 2. aria-description — inline string (ARIA 1.3+)
  return element.getAttribute("aria-description") || "";
}

/** Compute the accessible name for an element (simplified) */
function computeAccessibleName(element: Element): string {
  // 1. aria-label takes priority
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

  // 2. aria-labelledby (simplified: resolve first ID)
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = element.ownerDocument;
    const names = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.trim())
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
      if (label) return label.textContent?.trim() || "";
    }
    // Wrapping label pattern: <label>Full name<input /></label>
    // Walk the label's child nodes and collect text from everything that is
    // NOT the form control itself (skips input/textarea/select siblings too).
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) {
      const FORM_CONTROL_TAGS = new Set(["input", "select", "textarea"]);
      const parts: string[] = [];
      for (const child of wrappingLabel.childNodes) {
        if ((child as Element) === element) continue;
        const childTag = (child as Element).tagName?.toLowerCase();
        if (childTag && FORM_CONTROL_TAGS.has(childTag)) continue;
        const text = child.textContent?.trim();
        if (text) parts.push(text);
      }
      const labelText = parts.join(" ");
      if (labelText) return labelText;
    }
  }

  // 4a. Fieldset — accessible name comes from its direct <legend> child
  if (tag === "fieldset") {
    const legend = element.querySelector(":scope > legend");
    if (legend) return legend.textContent?.trim() || "";
  }

  // 4b. Details — accessible name comes from its direct <summary> child
  if (tag === "details") {
    const summary = element.querySelector(":scope > summary");
    if (summary) return summary.textContent?.trim() || "";
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
    const fullText = (element.textContent || "").trim();
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
  if (typeof (element as any).checkVisibility === "function") {
    return (element as any).checkVisibility({
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
  // Custom modal dialogs: aria-modal="true" (most common pattern)
  const ariaModals = doc.querySelectorAll('[aria-modal="true"]');
  for (let i = ariaModals.length - 1; i >= 0; i--) {
    // Must check full ancestor chain — parent may have display:none even if
    // the dialog element itself has no hiding style (isSubtreeHidden only
    // checks the element itself, not ancestors).
    if (isActuallyVisible(ariaModals[i])) return ariaModals[i];
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

/** Extract a complete DOM tree from a root element */
export function extractDomTree(root: Element): ExtractionResult {
  const nodes = new Map<string, SemanticNode>();

  // If a modal dialog is active, scope extraction to within it
  const activeModal = findActiveModal(root.ownerDocument);
  const effectiveRoot = activeModal || root;

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
