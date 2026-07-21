import type { SemanticNode, ExtractionResult, ActionType } from "../types.js";
import { ElementRefMap } from "../utils/element-ref.js";
import { getNodeId } from "../utils/id-generator.js";

import {
  safeChildren,
  safeChildNodes,
  safeTextContent,
  safeHidden,
} from "./clobber-safe.js";
import {
  getImplicitRole,
  isHiddenFromAT,
  getHeadingLevel,
} from "./role-map.js";

/** Tags to skip entirely during extraction */
// track/source are media/picture metadata: HTML-AAM gives them no role and
// no browser emits accessibility nodes for them. Their a11y-relevant signal
// (does this video ship captions?) is hoisted onto the media element itself
// as the `captions` property instead.
const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "head",
  "track",
  "source",
]);

/**
 * Media elements. Their light-DOM children are fallback content that modern
 * browsers never render (and <track>/<source> metadata), so the walk does
 * not descend into them — mirroring Chromium's tree, where a media element's
 * only children are its user-agent shadow-DOM controls, which live in a
 * closed shadow root no light-DOM extractor can reach.
 */
const MEDIA_TAGS = new Set(["video", "audio"]);

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
  // Media with native controls — the element itself is a tab stop (the
  // play/seek/volume UI lives in a closed UA shadow root we can't reach).
  // Only "focus" is honest here: a synthetic click doesn't count as a user
  // gesture for playback, so a CLICK badge would no-op.
  else if (MEDIA_TAGS.has(tag) && element.hasAttribute("controls")) {
    actions.push("focus");
  }
  // ARIA role-based actions
  else if (role === "button" || element.hasAttribute("onclick")) {
    actions.push("click");
  } else if (role === "checkbox" || role === "switch") {
    actions.push("click");
  } else if (role === "radio") {
    actions.push("click");
  } else if (role === "combobox") {
    // An ARIA combobox is either EDITABLE (a text field you type into, e.g.
    // Slack's search — the ARIA 1.2 editable-combobox pattern) or SELECT-ONLY
    // (a popup button with no text entry). A non-native combobox is editable
    // exactly when it's a contenteditable host; a native <input role="combobox">
    // is already handled by the tag === "input" branch above. (aria-autocomplete
    // describes autocomplete *behavior*, not editability — a non-editable div
    // can't be typed into regardless, so it isn't the signal here.)
    const ce = element.getAttribute("contenteditable");
    const editable = ce === "" || ce === "true" || ce === "plaintext-only";
    if (editable) {
      // Treat like a textbox so the panel opens its inline input. Deliberately
      // NOT "click": click outranks type in getPrimaryAction, so a co-present
      // click would re-hijack the primary action and re-break text entry.
      actions.push("focus", "type");
    } else {
      // Select-only combobox — dispatch click to open the popup natively.
      actions.push("click");
    }
  } else if (role === "listbox") {
    // Custom listbox widget — dispatch click to open/interact natively.
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
  // Clobber-immune read: a `<form>` with `<input name="hidden">` makes
  // `htmlEl.hidden` return that input (truthy), which would drop the whole
  // form subtree. safeHidden() reads the real state via the prototype getter.
  if (safeHidden(element)) return true;

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
        return target
          ? getAccessibleTextContent(target, new Set()).trim()
          : undefined;
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
 *   - Embedded form controls: slider, spinbutton, textbox, searchbox.
 *     (accname §2C says these contribute their *value* when embedded in a
 *     label — e.g. `<label>Delete <input value="3"> files</label>` names
 *     "Delete 3 files". Not implemented yet; skipping is the safer
 *     approximation until the value rule lands.)
 *   - Display widgets / live regions: dialog, alertdialog, tabpanel,
 *     alert, status, log, tooltip, progressbar, meter. A tooltip or
 *     dialog nested inside a widget is its own surface, not part of the
 *     host's label.
 *
 * Intentionally NOT included (walked into so their text contributes):
 *   - generic, presentation, none — transparent.
 *   - Inline formatting roles: strong, emphasis, code, mark, deletion,
 *     insertion, subscript, superscript, term, definition, paragraph,
 *     blockquote, caption, figcaption, time, separator, img.
 *   - heading — kept walkable so a button/tab whose label is a heading
 *     still picks up the heading's text (e.g. `<button><h3>X</h3>`).
 *   - Named widgets (link, button, checkbox, radio, switch) — handled by
 *     {@link NAMED_WIDGET_ROLES} below: they contribute their *computed
 *     accessible name*, not raw text.
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
  // Embedded form controls (see §2C note in the docstring)
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

/** Tags whose text content is used as an accessible name per accname-1.2. */
const NAMES_FROM_CONTENT_TAGS = new Set<string>([
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

/** Roles whose own text content is used as an accessible name. */
const NAMES_FROM_CONTENT_ROLES = new Set<string>([
  "button",
  "link",
  "heading",
  "option",
  "treeitem",
  "tab",
  "menuitem",
  "cell",
]);

/**
 * True if `element` is a host whose accessible name can come from its
 * descendant text content. Used by the incremental extractor to decide
 * whether a text mutation must invalidate an ancestor's name.
 */
export function isNameFromContentHost(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (NAMES_FROM_CONTENT_TAGS.has(tag)) return true;
  const explicitRole = element.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicitRole && NAMES_FROM_CONTENT_ROLES.has(explicitRole)) return true;
  return false;
}

/**
 * True if `role` acts as a name-from-content barrier — text inside an element
 * with this role does not bubble up to name an ancestor.
 */
export function isNameBarrierRole(role: string): boolean {
  return NAME_BARRIER_ROLES.has(role);
}

/**
 * Named widgets encountered as descendants during name-from-content
 * contribute their *computed accessible name* — not their raw subtree text,
 * and not the empty string.
 *
 * Per accname-1.2 §2F.iii the walk recurses with the full name algorithm,
 * so `<h3><a aria-label="API docs">config.ts</a></h3>` names the heading
 * "API docs", and `<h3><a><code>config.ts</code></a></h3>` names it
 * "config.ts" — matching what Chrome and Firefox expose. Skipping these
 * entirely (as we briefly did) left link-wrapped headings nameless.
 *
 * Deliberately narrow: item widgets like treeitem/menuitem/option stay in
 * {@link NAME_BARRIER_ROLES} — a nested tree row is a sibling with its own
 * announceable name, not part of its parent's label (PR #84).
 */
const NAMED_WIDGET_ROLES = new Set<string>([
  "link",
  "button",
  "checkbox",
  "radio",
  "switch",
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
function getAccessibleTextContent(
  element: Element,
  visited: Set<Element>,
): string {
  let text = "";
  for (const child of safeChildNodes(element)) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (childEl.getAttribute("aria-hidden") === "true") continue;
      if (isSubtreeHidden(childEl)) continue;
      const role = getImplicitRole(childEl);
      // Named widgets contribute their computed name (accname §2F.iii) —
      // padded with spaces so adjacent text doesn't glue; the final
      // whitespace normalization collapses any doubles.
      if (NAMED_WIDGET_ROLES.has(role)) {
        text += ` ${computeAccessibleName(childEl, visited)} `;
        continue;
      }
      if (NAME_BARRIER_ROLES.has(role)) continue;
      text += getAccessibleTextContent(childEl, visited);
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
function computeAccessibleName(
  element: Element,
  visited: Set<Element> = new Set(),
): string {
  return computeRawAccessibleName(element, visited).replace(/\s+/g, " ").trim();
}

function computeRawAccessibleName(
  element: Element,
  visited: Set<Element>,
): string {
  // accname visit-once guard (§4.3.2): an element already on the current
  // name-computation path contributes the empty string when reached again.
  // Without this, an aria-labelledby that points at an ancestor containing the
  // element cycles between labelledby resolution and name-from-content until
  // the stack overflows (seen on real pages, e.g. the mercadolibre signup).
  if (visited.has(element)) return "";
  visited.add(element);

  // 1. aria-labelledby is resolved before aria-label (accname-1.2 §2B
  //    precedes §2D): concatenate the accessible names of every referenced
  //    IDREF, in order. The visit-once guard above breaks reference cycles.
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = element.ownerDocument;
    const names = labelledBy
      .split(/\s+/)
      .map((id) => {
        const target = doc.getElementById(id);
        return target ? getAccessibleTextContent(target, visited).trim() : "";
      })
      .filter(Boolean);
    if (names.length) return names.join(" ");
  }

  // 2. aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();

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
      if (label) return getAccessibleTextContent(label, visited).trim();
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
          const text = getAccessibleTextContent(childEl, visited).trim();
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
    if (legend) return getAccessibleTextContent(legend, visited).trim();
  }

  // 4b. Details — accessible name comes from its direct <summary> child
  if (tag === "details") {
    const summary = element.querySelector(":scope > summary");
    if (summary) return getAccessibleTextContent(summary, visited).trim();
  }

  // 5. Button-like inputs (submit/reset/button) take their name from the
  //    `value` attribute (HTML-AAM). For any other input the value is the
  //    user's DATA, not a name — an unlabeled text field must read as unnamed
  //    rather than echo what was typed, and an unlabeled checkbox must not
  //    inherit its default value "on". That matches what assistive tech
  //    announces and stops @real-a11y-dev/testing from passing genuinely
  //    unlabeled controls. (The sensitive-value guard is kept for defense in
  //    depth; a password field is never button-like, so it no longer reaches
  //    this branch at all.)
  if (tag === "input") {
    const input = element as HTMLInputElement;
    const type = input.type;
    if (
      (type === "submit" || type === "reset" || type === "button") &&
      input.value &&
      !isSensitiveField(input)
    ) {
      return input.value;
    }
  }

  // 6. title attribute (HTML-AAM orders title before placeholder)
  const title = element.getAttribute("title");
  if (title) return title;

  // 7. placeholder — a text input's last-resort name, after title.
  if (tag === "input") {
    const placeholder = (element as HTMLInputElement).placeholder;
    if (placeholder) return placeholder;
  }

  // Media elements never name from content: their light-DOM children are
  // unrendered fallback ("Sorry, your browser doesn't support…") plus
  // <track>/<source> metadata. Without this guard the fallback text leaked
  // in as the accessible name via the direct-text step below. Chromium
  // exposes an unlabeled <video> with an empty name — mirror that.
  if (MEDIA_TAGS.has(tag)) return "";

  // 8. Recursive text content — ONLY for elements whose ARIA role supports
  //    "name from content" (headings, links, buttons, table cells, options).
  //    NOT for generic containers (div, span, p) which would grab huge text blobs.
  const explicitRole = element.getAttribute("role")?.trim().split(/\s+/)[0];
  const namesFromContentRole =
    !!explicitRole && NAMES_FROM_CONTENT_ROLES.has(explicitRole);

  if (NAMES_FROM_CONTENT_TAGS.has(tag) || namesFromContentRole) {
    const fullText = getAccessibleTextContent(element, visited).trim();
    if (fullText) return fullText;
  }

  // 9. Fallback: direct text content only (for generic/container elements)
  const directText = getDirectTextContent(element);
  if (directText) return directText;

  return "";
}

/** Get direct text content of an element, excluding child element text */
function getDirectTextContent(element: Element): string {
  let text = "";
  for (const child of safeChildNodes(element)) {
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
export function getDescendantText(element: Element): string {
  const raw = safeTextContent(element);
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= DESCENDANT_TEXT_MAX) return collapsed;
  return collapsed.slice(0, DESCENDANT_TEXT_MAX - 1) + "…";
}

/**
 * Autocomplete field names (WHATWG autofill tokens) that identify a control
 * holding a secret. Matched against each space-separated token of an
 * element's `autocomplete` value.
 */
const SENSITIVE_AUTOCOMPLETE_TOKENS: ReadonlySet<string> = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
]);

/** Substituted for a sensitive field's live value in the extracted tree. */
const REDACTED_VALUE = "[redacted]";

/**
 * True if `element` is a form field whose live value must never be captured
 * into the semantic tree — a password `<input>`, or any input/textarea/select
 * whose `autocomplete` names a credential or payment field.
 *
 * The extracted tree flows into serializer snapshots (committed to git and
 * CI), the testing package's assertions, and the Chrome extension's message
 * channel. A secret typed into such a field must not ride along, so callers
 * that read `.value` — {@link extractDomTree} via `getKeyAttributes`, the
 * accessible-name fallback, and downstream consumers like the extension's
 * field-state read — gate on this predicate.
 */
export function isSensitiveField(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    return false;
  }
  if (tag === "input" && (element as HTMLInputElement).type === "password") {
    return true;
  }
  const autocomplete = element.getAttribute("autocomplete");
  if (autocomplete) {
    for (const token of autocomplete.toLowerCase().split(/\s+/)) {
      if (SENSITIVE_AUTOCOMPLETE_TOKENS.has(token)) return true;
    }
  }
  return false;
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
    // Media a11y signals (boolean attributes render as "")
    "controls",
    "autoplay",
    "muted",
    "loop",
    "poster",
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
      attrs["value"] = isSensitiveField(element)
        ? REDACTED_VALUE
        : currentValue;
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
 * Resolve the element that actually holds focus in `doc`, or `null` when
 * nothing meaningful does.
 *
 * Two normalizations matter:
 *  - Focus resting on `<body>`/`<html>` (or `null`) is the *absence* of focus,
 *    not "the body is focused" — treat it as none, so a fresh page produces no
 *    marker and committed snapshots don't churn.
 *  - `document.activeElement` reports the shadow *host* when focus is inside a
 *    shadow tree; descend through nested roots to the real target.
 */
export function resolveFocusedElement(doc: Document | null): Element | null {
  if (!doc) return null;
  let active: Element | null = doc.activeElement;
  if (!active || active === doc.body || active === doc.documentElement) {
    return null;
  }
  while (active.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/**
 * The id of the focused element, kept only if that element was captured as a
 * node in `nodes` (i.e. it's inside the extracted subtree). `findId` is a pure
 * reverse lookup — an element never walked in this extraction has no id here,
 * and a stale id from a prior extraction fails the `nodes.has` membership check.
 */
function focusedNodeId(
  root: Element,
  nodes: Map<string, SemanticNode>,
): string | undefined {
  const el = resolveFocusedElement(root.ownerDocument);
  if (!el) return undefined;
  const id = elementRefs.findId(el);
  return id && nodes.has(id) ? id : undefined;
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
 * True if `element` is a MODAL dialog — content behind a modal is inert to
 * assistive tech, so extraction scopes exclusively to it.
 *
 * Modality is identified by a POSITIVE signal, never by role="dialog" alone:
 *   - `aria-modal="true"` — set by every mainstream modal library (Radix
 *     Dialog, Headless UI, MUI) and by the APG dialog pattern itself.
 *   - the native `:modal` pseudo-class — a `<dialog>` opened via showModal().
 *
 * A role="dialog" WITHOUT one of these is NOT modal: cookie-consent banners,
 * Radix `Popover.Content`, and non-modal drawers all render role="dialog"
 * yet leave the page interactive. Treating those as modal collapsed the whole
 * page down to just the banner in the inspector. (We deliberately do NOT
 * infer modality from "siblings are aria-hidden" — that heuristic carries the
 * same false-positive hijack risk, and mainstream libraries all set
 * aria-modal regardless.)
 */
function isModal(element: Element): boolean {
  if (element.getAttribute("aria-modal") === "true") return true;
  try {
    if (element.matches(":modal")) return true;
  } catch {
    // :modal pseudo-class not supported in this environment (e.g. jsdom)
  }
  return false;
}

/**
 * Find the active modal dialog, if any.
 * When a modal is active, content behind it is inert — screen readers
 * scope navigation exclusively to the modal content.
 */
function findActiveModal(doc: Document): Element | null {
  // Candidate dialogs, gated by isModal(): a visible role="dialog" alone does
  // not imply modality, so a non-modal dialog (cookie banner, Radix Popover)
  // must not hijack the scope. Iterate last-to-first so the top-most stacked
  // dialog wins; isActuallyVisible filters closed/unmounted ones.
  const dialogs = doc.querySelectorAll(
    '[aria-modal="true"], [role="dialog"], [role="alertdialog"]',
  );
  for (let i = dialogs.length - 1; i >= 0; i--) {
    if (isActuallyVisible(dialogs[i]) && isModal(dialogs[i])) {
      return dialogs[i];
    }
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

  // Portal-mounted overlay roles. MODAL dialogs are handled exclusively by
  // findActiveModal() (which takes precedence). A NON-modal role="dialog"
  // (cookie banner, Radix Popover) is additive like any other overlay — it is
  // included here so it pivots to body and joins the tree, rather than
  // hijacking the scope the way findActiveModal used to.
  const overlays = doc.querySelectorAll(
    '[role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], ' +
      '[role="status"], [role="alert"], [role="log"], [aria-live], ' +
      '[role="dialog"], [role="alertdialog"]',
  );
  for (const el of overlays) {
    if (!root.contains(el) && isActuallyVisible(el)) {
      return body;
    }
  }
  return null;
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
  const doc = root.ownerDocument;
  if (!doc) return root;
  const activeModal = findActiveModal(doc);
  if (activeModal) return activeModal;
  return findPortalOverlay(doc, root) ?? root;
}

/**
 * Report — outside production — that an element was skipped mid-extraction.
 *
 * The walk wraps each element so a single pathological node (usually DOM
 * clobbering that slipped past the targeted guards) degrades to "skip this
 * node" instead of aborting the whole tree. That silent recovery is the right
 * runtime behavior, but the gap should stay debuggable, so we surface the
 * element and the error for inspection. Gated off in production to avoid
 * console noise; this package has no `@types/node`, so `process` is reached
 * through a `globalThis` cast.
 */
function warnSkippedElement(element: Element, error: unknown): void {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process;
  if (proc?.env?.NODE_ENV === "production") return;
  if (typeof console !== "undefined") {
    console.warn(
      "[real-a11y] Skipped an element during extraction to keep the rest of the tree intact:",
      element,
      error,
    );
  }
}

/**
 * Options for {@link extractDomTree}. Primarily for internal incremental
 * extraction; the public single-argument form is unchanged.
 */
export interface ExtractDomTreeOptions {
  /** Existing nodes map to update in-place. When provided, extraction is partial. */
  nodes?: Map<string, SemanticNode>;
  /** Parent id for the root of this partial extraction. */
  parentId?: string | null;
  /** Depth offset for the root of this partial extraction. */
  baseDepth?: number;
  /** Precomputed description-target id set. Required for partial extraction. */
  descriptionTargetIds?: ReadonlySet<string>;
  /** Whether to compute the focused element id. Default true for full extractions. */
  includeFocused?: boolean;
}

/**
 * Build the semantic node for `element`, or return `null` to skip it (and,
 * by extension, its subtree).
 *
 * The whole body runs inside a try/catch so that a single pathological
 * element cannot abort the ENTIRE extraction. The reported crash was DOM
 * clobbering: on a `<form>` (the one element with `[LegacyOverrideBuiltIns]`)
 * a child named `tagName` — `<input name="tagName">` — shadows
 * `element.tagName`, so `.toLowerCase()` threw, and with no per-element
 * boundary the walk unwound completely and the panel hung on "Connecting to
 * page…" forever. The targeted guards (`getAttribute("id")`, the `safe*`
 * reads) defuse the plausible cases; this boundary is the catch-all for the
 * rest — including future unknown clobbering — degrading to "skip this node"
 * instead of losing the whole tree.
 *
 * Nothing here mutates `nodes` / `elementRefs`; the caller commits the node
 * only on success, so a caught element never leaves a half-built node behind.
 */
function buildNode(
  element: Element,
  parentId: string | null,
  depth: number,
  descriptionTargetIds: ReadonlySet<string>,
): { id: string; node: SemanticNode } | null {
  try {
    const tag = element.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;

    // Skip Semantic Navigator internal elements (highlight overlay, curtain, etc.)
    // Read the id via getAttribute, not the `.id` property: on a <form> (or the
    // legacy named-property elements) a child named `id` clobbers `element.id`
    // to return that element, so `.id.startsWith(...)` would throw a TypeError
    // and crash the whole extraction. getAttribute always yields a string|null.
    if (element.getAttribute("id")?.startsWith("__sn-")) return null;

    // Skip entire subtrees of display:none / hidden elements
    if (isSubtreeHidden(element)) return null;

    // Skip elements that serve solely as aria-describedby text providers.
    // Their content is shown inline on the referencing element as a description.
    const ownId = element.getAttribute("id");
    if (ownId && descriptionTargetIds.has(ownId)) return null;

    const id = getNodeId(element);
    const role = getImplicitRole(element);
    const actions = getActions(element);
    const isMedia = MEDIA_TAGS.has(tag);
    const isFocusable =
      NATIVELY_FOCUSABLE.has(tag) ||
      element.getAttribute("tabindex") !== null ||
      // <video controls> / <audio controls> are tab stops — Chromium
      // exposes them focusable even though the actual buttons/sliders
      // live in a closed UA shadow root.
      (isMedia && element.hasAttribute("controls"));

    const node: SemanticNode = {
      id,
      parentId,
      childIds: [],
      depth,
      dom: {
        tagName: tag,
        attributes: getKeyAttributes(element),
        // Media children are unrendered fallback + <track>/<source>
        // metadata — surfacing "Sorry, your browser doesn't support…"
        // as the node's text preview misrepresents what AT renders.
        textContent: isMedia ? "" : getDirectTextContent(element),
        descendantText: isMedia ? "" : getDescendantText(element),
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
          // The walk doesn't descend into media children, so the one
          // a11y-critical signal that lives there — does this media ship
          // a captions/subtitles track? (WCAG 1.2.2) — is hoisted onto
          // the media node itself.
          ...(isMedia
            ? {
                captions: element.querySelector(
                  'track[kind="captions"], track[kind="subtitles"]',
                )
                  ? "true"
                  : "false",
              }
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

    return { id, node };
  } catch (error) {
    // One bad element must not take down the walk. Skip it and its subtree;
    // siblings and ancestors still extract.
    warnSkippedElement(element, error);
    return null;
  }
}

function walk(
  element: Element,
  parentId: string | null,
  depth: number,
  nodes: Map<string, SemanticNode>,
  descriptionTargetIds: ReadonlySet<string>,
): string | null {
  const built = buildNode(element, parentId, depth, descriptionTargetIds);
  if (!built) return null;
  const { id, node } = built;

  // Commit the finished node. Neither map write can throw, so a node that was
  // built successfully is never orphaned by a later failure.
  elementRefs.set(id, element);
  nodes.set(id, node);

  // Media elements are leaves: their light-DOM children are unrendered
  // fallback content plus <track>/<source> metadata, none of which appear
  // in a real browser tree (Chromium's Video/Audio children are closed
  // UA-shadow controls we cannot reach). The captions signal from <track>
  // is hoisted onto the media node's `captions` property in buildNode.
  if (MEDIA_TAGS.has(node.dom.tagName)) return id;

  // Walk children. Each child is isolated by buildNode's own boundary, so a
  // single pathological descendant can't take out its siblings or ancestors.
  for (const child of safeChildren(element)) {
    const childId = walk(child, id, depth + 1, nodes, descriptionTargetIds);
    if (childId) {
      node.childIds.push(childId);
    }
  }

  return id;
}

/** Extract a complete DOM tree from a root element */
export function extractDomTree(
  root: Element,
  options: ExtractDomTreeOptions = {},
): ExtractionResult {
  const nodes = options.nodes ?? new Map<string, SemanticNode>();
  const parentId = options.parentId ?? null;
  const baseDepth = options.baseDepth ?? 0;
  const isPartial = options.nodes != null;

  let effectiveRoot: Element;
  let descriptionTargetIds: ReadonlySet<string> =
    options.descriptionTargetIds ?? new Set<string>();

  if (!isPartial || !options.descriptionTargetIds) {
    effectiveRoot = resolveEffectiveRoot(root);

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
    const freshDescriptionTargetIds = new Set<string>();
    for (const el of effectiveRoot.querySelectorAll("[aria-describedby]")) {
      for (const id of (el.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter(Boolean)) {
        if (!labelTargetIds.has(id)) {
          freshDescriptionTargetIds.add(id);
        }
      }
    }
    descriptionTargetIds = freshDescriptionTargetIds;
  } else {
    effectiveRoot = root;
  }

  const startRoot = isPartial ? root : effectiveRoot;
  const rootId = walk(
    startRoot,
    parentId,
    baseDepth,
    nodes,
    descriptionTargetIds,
  );

  const includeFocused = options.includeFocused ?? !isPartial;
  const focusedId = includeFocused
    ? focusedNodeId(effectiveRoot, nodes)
    : undefined;
  return { nodes, rootId: rootId || "", ...(focusedId ? { focusedId } : {}) };
}
