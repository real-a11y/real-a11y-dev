import type { SemanticNode, ExtractionResult, ActionType } from "../types.js";
import { collapseAscii, trimAscii } from "../utils/ascii-whitespace.js";
import { ElementRefMap, ELEMENT_REF_MAP_SHAPE } from "../utils/element-ref.js";
import { getNodeId } from "../utils/id-generator.js";
import { realmSingleton } from "../utils/realm-singleton.js";
import { treeSource } from "../utils/tree-source.js";

import { withAriaOwnerIndex } from "./aria-owner.js";
import { canExpand, roleTakesState } from "./aria-state-roles.js";
import {
  ariaBoolean,
  ariaCurrent,
  ariaTristate,
  isAriaHiddenValue,
} from "./aria-tokens.js";
import { AUTHOR_NAMED_ROLES } from "./author-named-roles.js";
import {
  safeContains,
  safeGetAttribute,
  safeGetAttributeNames,
  safeGetElementById,
  safeNodeType,
  safeOwnerDocument,
  safeParentElement,
  safeRootNode,
  safeTagName,
} from "./clobber-safe.js";
import { isEditable, isEditingHost } from "./editing.js";
import { addFieldStates, optionStates } from "./field-states.js";
import {
  EMBEDDED_VALUE_ROLES,
  embeddedValue,
  getAnnouncedValue,
  getDescendantText,
  lendsValueOnly,
  MEDIA_TAGS,
  PAGE_STATE_VALUE_ROLES,
} from "./field-text.js";
import {
  flatChildNodes,
  flatChildren,
  flatParent,
  idScope,
} from "./flat-tree.js";
import {
  isActuallyDisabled,
  isFocusable,
  parseTabindex,
} from "./focusability.js";
import * as host from "./host-names.js";
import { getKeyAttributes } from "./key-attributes.js";
import { associatedLabels, wrappingLabelText } from "./label-text.js";
import { hasCaptionsTrack } from "./media-tracks.js";
export { isTextVisible } from "./name-spacing.js";
import {
  childTextWalk,
  hiddenChildText,
  isImplicitDetailsGroup,
  NAME_BARRIER_ROLES,
  NAMED_WIDGET_ROLES,
  needsSpaceAround,
  rootTextVisible,
  isAriaHiddenChild,
  referenceWalk,
  type TextVisibility,
} from "./name-spacing.js";
import { PANEL_HOST_ATTRIBUTE } from "./overlay-reach.js";
import { resolveEffectiveRoot } from "./overlay-scope.js";
import { scopeReferenceIndex } from "./reference-index.js";
import {
  getCachedComputedStyle,
  getExplicitRole,
  getImplicitRole,
  getHeadingLevel,
  isDropDownSelect,
  isHiddenFromAT,
  isSubtreeHidden,
  type StyleCache,
} from "./role-map.js";
import { isSensitiveField, REDACTED_VALUE } from "./sensitivity.js";
import { warnSkippedElement } from "./skipped-element.js";
import { isSrOnly } from "./sr-only.js";
import {
  nameText,
  newNameRun,
  withhold,
  withholdStates,
  type NameRun,
  type RedactInputOption,
} from "./strict-mode.js";
import { isOwnVisibilityHidden } from "./visibility.js";

export { KEY_ATTRIBUTES } from "./key-attributes.js";
export {
  OVERLAY_CANDIDATE_SELECTOR,
  containsOverlaySignal,
  countsAsOverlay,
  isModal,
  isOverlaySignal,
  resolveEffectiveRoot,
} from "./overlay-scope.js";

export { PANEL_HOST_ATTRIBUTE } from "./overlay-reach.js";
export type { RedactInputOption } from "./strict-mode.js";

// A field's text and value reads live in field-text.ts; these stay importable
// from here, where every caller already finds them.
export {
  fieldValueOwner,
  finishAnnouncedValue,
  getAnnouncedValue,
  getDescendantText,
  ignoresChildText,
  PAGE_STATE_VALUE_ROLES,
  RANGE_VALUE_ROLES,
  STATE_ONLY_ROLES,
} from "./field-text.js";

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

/** Determine what actions an element supports. */
function getActions(element: Element): ActionType[] {
  const tag = safeTagName(element);
  const actions: ActionType[] = [];
  // The role the tree shows, so the actions offered agree with it: a
  // `role="foo button"` clicks, an option the browser discarded doesn't.
  const role = getExplicitRole(element);

  // Links — live ones. A link inside editable content is not: Chromium
  // won't follow it, not even on a scripted click(), or focus it, so it has
  // no action to offer. (One that is itself an editing host gets focus/type
  // below.)
  if (tag === "a" && element.hasAttribute("href") && !isEditable(element)) {
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
  // ARIA role-based actions. Any element reaches the `onclick` read, so it
  // goes through the prototype: a <form> can shadow `hasAttribute`.
  else if (role === "button" || safeGetAttribute(element, "onclick") !== null) {
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
    if (isEditingHost(element)) {
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

  // An editing host is a text field whatever its role: Chromium focuses it
  // and takes typing, and the dispatcher's `type` writes into it. The role
  // branches above cover a textbox, a searchbox and an editable combobox;
  // this catches the role-less `<div contenteditable>` composer, which
  // otherwise read as inert and folded out of the a11y view — and so out of
  // every tab sequence built on it. It precedes the tabindex catch-all,
  // whose `click` would outrank `type` in getPrimaryAction.
  if (actions.length === 0 && isEditingHost(element)) {
    actions.push("focus", "type");
  }

  if (safeGetAttribute(element, "tabindex") !== null && actions.length === 0) {
    actions.push("click");
  }

  return actions;
}

/** Check if an element is visually hidden (computed styles) */
function isVisuallyHidden(
  element: Element,
  style?: CSSStyleDeclaration | null,
): boolean {
  const computed =
    style !== undefined ? style : getCachedComputedStyle(element);

  if (isSubtreeHidden(element, computed)) return true;
  // An area is drawn by its image, whose visibility isSubtreeHidden read.
  if (element.localName === "area") return false;

  // NOTE: opacity:0 is intentionally NOT checked here. Custom form controls
  // routinely use it to hide the native widget behind a custom visual while
  // keeping it interactive, and AT still reads opacity-0 elements.
  if (isOwnVisibilityHidden(element, computed)) return true;

  // sr-only pattern: visually hidden but intentionally accessible to AT
  if (isSrOnly(element, computed)) return true;

  return false;
}

/**
 * Compute the accessible description for an element.
 * Resolves aria-describedby IDs to text and falls back to aria-description.
 *
 * A description that read anything it may not show is dropped whole, with
 * no fallback to `aria-description` or `title`, as the native producer drops
 * one: see {@link NameRun.withheld}.
 */
function computeAccessibleDescription(
  element: Element,
  styleCache: StyleCache,
  redactInput: boolean,
): string {
  // 1. aria-describedby — resolve referenced element text
  const describedBy = safeGetAttribute(element, "aria-describedby");
  if (describedBy) {
    const doc = idScope(element);
    let withheld = false;
    const texts = describedBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const target = safeGetElementById(doc, id);
        if (!target) return undefined;
        // The same borrowing as aria-labelledby: Chromium describes
        // `<button aria-describedby="d">` over `<span id="d"><img alt="Warning">
        // irreversible</span>` as "Warning irreversible".
        const run = newNameRun(redactInput);
        const text = referenceText(target, run, styleCache);
        if (run.withheld) withheld = true;
        return text;
      })
      .filter((t): t is string => !!t);
    if (withheld) return "";
    // Whitespace-normalized like a name: ASCII whitespace only, so a U+00A0
    // survives as Chromium and the WPT text-node cases keep it. The walk pads
    // any child with a box of its own so its text never glues to a neighbour;
    // without this a description read "X  S" where Chromium reads "X S".
    if (texts.length) return collapseAscii(texts.join(" "));
  }
  // 2. aria-description — inline string (ARIA 1.3+)
  const inline = safeGetAttribute(element, "aria-description");
  if (inline) return inline;
  // 3. title — HTML-AAM §4.2's last source, "if it was not used as the
  //    accessible name": `<button aria-label="AL" title="Ti">` is "AL"
  //    described by "Ti", as in Chromium.
  const title = safeGetAttribute(element, "title");
  const source: NameSource = {};
  if (title)
    computeAccessibleName(
      element,
      newNameRun(redactInput),
      styleCache,
      false,
      source,
    );
  return title && !source.fromTitle ? collapseAscii(title) : "";
}

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

/**
 * Roles whose own text content is used as an accessible name — the ARIA 1.2
 * `nameFromContent` set, minus the abstract `sectionhead`.
 *
 * Being here says nothing about what an element contributes to an *ancestor's*
 * name: most of these are also in {@link NAME_BARRIER_ROLES}, which is the
 * other direction of the same relationship. A `gridcell` names itself from its
 * content and still contributes nothing to the row that contains it.
 */
const NAMES_FROM_CONTENT_ROLES = new Set<string>([
  "button",
  "link",
  "heading",
  "option",
  "treeitem",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "row",
  "checkbox",
  "radio",
  "switch",
  "tooltip",
]);

/**
 * True if `element` is a host whose accessible name can come from its
 * descendant text content. Used by the incremental extractor to decide
 * whether a text mutation must invalidate an ancestor's name. The same test
 * gates step 8 of the name computation, so the two cannot disagree.
 *
 * An authored role outranks the tag: `<button role="combobox">Apple</button>`
 * (the Radix Select trigger) is a combobox, named by its author only, and
 * Chromium leaves it unnamed — its text is the selected VALUE.
 *
 * An editing host outranks both: what is typed into an editor is its content,
 * never its label. Chromium names one only by `aria-label`,
 * `aria-labelledby` or `title` — a `<button contenteditable>` or an editable
 * `<h3>` is unnamed there, whatever it holds.
 */
export function isNameFromContentHost(element: Element): boolean {
  if (isEditingHost(element)) return false;
  const explicitRole = getExplicitRole(element);
  if (explicitRole && AUTHOR_NAMED_ROLES.has(explicitRole)) return false;
  if (NAMES_FROM_CONTENT_TAGS.has(safeTagName(element))) return true;
  return !!explicitRole && NAMES_FROM_CONTENT_ROLES.has(explicitRole);
}

/**
 * HTML-AAM owner → name-source child. These owners are not name-from-content
 * hosts, so a mutation inside the child would otherwise stop at the child
 * (often a name-barrier role) and never re-extract the owner.
 *
 * `legend`/`summary`/`caption` map to `fieldset`/`details`/`table`. A caption
 * only names the table when it is `HTMLTableElement.caption` (the first
 * caption, direct child).
 */
const NAME_SOURCE_CHILD_TO_OWNER: Readonly<Record<string, string>> = {
  legend: "fieldset",
  summary: "details",
  caption: "table",
};

/** The element whose accessible name is computed from `element`, if any. */
export function htmlAamNameOwner(element: Element): Element | null {
  const tag = safeTagName(element);
  const ownerTag = NAME_SOURCE_CHILD_TO_OWNER[tag];
  if (!ownerTag) return null;
  // eslint-disable-next-line no-restricted-properties -- one read, and a <legend>, <summary> or <caption> is never a form
  const parent = element.parentElement;
  if (!parent || safeTagName(parent) !== ownerTag) return null;
  if (tag === "caption") {
    return (parent as HTMLTableElement).caption === element ? parent : null;
  }
  return parent;
}

/**
 * True if `element` is a name-from-content barrier — its text does not bubble
 * up to name an ancestor. Its role decides, except that a native `<details>`
 * with its implicit `group` role is walked into (see
 * {@link isImplicitDetailsGroup}). The one check both the name walk and the
 * live extractor's host climb use, so they can't disagree about where a
 * name stops.
 */
export function isNameBarrierElement(element: Element): boolean {
  return (
    NAME_BARRIER_ROLES.has(getImplicitRole(element)) &&
    !isImplicitDetailsGroup(element)
  );
}

/** How a name-from-content walk was reached. */
interface NameWalk extends TextVisibility {
  /**
   * Inside an aria-labelledby or aria-describedby traversal, where a
   * descendant's own aria-labelledby is ignored (accname §2B: "not already part
   * of an aria-labelledby traversal"). Chromium reads `<span id="a">A <span
   * aria-labelledby="b">x</span></span>`, referenced as a label or a
   * description, as "A x". `"hidden"` when the target itself is hidden: its
   * whole subtree is read, hidden descendants included (accname §2B).
   */
  readonly inReference?: boolean | "hidden";
  /**
   * Text only: no descendant lends an alternative of its own. A `<select>`'s
   * option is named by its text alone in Chromium — `<option><img alt="Flag">
   * France</option>` is option "France".
   */
  readonly textOnly?: boolean;
}

/** Where a computed name came from, for the caller that needs to know. */
interface NameSource {
  /** The name is the element's own text, not an attribute or a reference. */
  fromContent?: boolean;
  /** The name is the `title` attribute, so it is not also the description. */
  fromTitle?: boolean;
}

/**
 * What a descendant lends an ancestor's name ahead of its content, or `null`
 * when it has nothing of its own and its content is walked instead. Accname
 * §2F.iii computes each child's text alternative "beginning with step 2", and
 * Chromium does: `<a href="/"><img alt="Home"></a>` is link "Home",
 * `<button><span aria-label="Close">×</span></button>` is button "Close".
 *
 * - An image lends its name and never its content: its aria-labelledby or
 *   aria-label, its alt, an SVG's `<title>`, or its title; a nameless one lends
 *   "". Chromium reads `<button><span role="img">★</span> Favourite</button>`
 *   as "Favourite" and `<button><svg><text>Go</text></svg></button>` as an
 *   unnamed button. A presentational image (`<img alt="">`, `role="none"`) is
 *   not an image here, and has no content either.
 * - Anything else lends its aria-labelledby, outside a reference traversal,
 *   when that names anything, else its aria-label when it isn't blank. Its
 *   title is ignored: `<a href="/"><span title="Home"></span></a>` is an
 *   unnamed link in Chromium.
 *
 * Each element is read once, under the visit-once rule in
 * computeRawAccessibleName: outside a reference traversal, one this
 * computation has already read lends "". So `<a href="/"><svg
 * aria-labelledby="t"></svg><span id="t">Docs</span></a>` is "Docs" in
 * Chromium, not "Docs Docs": the svg's reference read the span first.
 */
function textAlternative(
  element: Element,
  role: string,
  run: NameRun,
  styleCache: StyleCache | null | undefined,
  walk: NameWalk,
): string | null {
  if (role === "img") {
    return computeAccessibleName(element, run, styleCache, walk.inReference);
  }
  if (run.visited.has(element) && !walk.inReference) return "";
  run.visited.add(element);
  if (!walk.inReference) {
    const labelledBy = labelledByText(element, run, styleCache);
    if (labelledBy) return labelledBy;
  }
  return trimAscii(safeGetAttribute(element, "aria-label") ?? "") || null;
}

/**
 * Where a name walk reads a control, for {@link embeddedControlText}: inside a
 * reference, its own aria-labelledby is ignored.
 */
interface ControlRead extends NameWalk {
  readonly styleCache: StyleCache | null | undefined;
}

/**
 * What a control the user adjusts lends a name or description it sits in
 * (AccName 1.2 step 2C), or `null` when `element` isn't one
 * ({@link EMBEDDED_VALUE_ROLES}): its value as {@link readFieldValue} reads it,
 * or an ARIA listbox's chosen options, ahead of its `aria-label` and never a
 * combobox's or listbox's other options. Chromium names `<label><input
 * type="checkbox"> Flash the screen <input value="3" aria-label="n"> times
 * </label>` "Flash the screen 3 times".
 *
 * A control holding no value lends its own name instead, as Chromium does:
 * `<h2>Save <input placeholder="Draft"> now</h2>` is "Save Draft now", and a
 * `<button aria-labelledby>` over `<label for="e">Email</label><input id="e">`
 * is "Email". Not one that lends only its value ({@link lendsValueOnly}).
 *
 * A sensitive field's value, and in strict mode any value, is withheld: the
 * whole name reads `[redacted]` (see {@link NameRun.withheld}), as the native
 * producer reads a name built around such a field. A name is markup, which
 * neither withholds.
 */
function embeddedControlText(
  element: Element,
  role: string,
  run: NameRun,
  at: ControlRead,
): string | null {
  if (!EMBEDDED_VALUE_ROLES.has(role)) return null;
  const text = collapseAscii(
    embeddedValue(
      element,
      role,
      (option) => computeAccessibleName(option, run, at.styleCache),
      at.styleCache ?? undefined,
    ),
  );
  if (!text) {
    return lendsValueOnly(element, role)
      ? ""
      : computeAccessibleName(element, run, at.styleCache, at.inReference);
  }
  const entered = !PAGE_STATE_VALUE_ROLES.has(role);
  return (run.redactInput && entered) || isSensitiveField(element)
    ? withhold(run)
    : text;
}

/**
 * What a name-from-content barrier lends the walk it sits in
 * ({@link isNameBarrierElement}, with the role in hand): a control the user
 * adjusts its value or name ({@link embeddedControlText}), unless it is the
 * control being named (see `NameRun.named`), and any other barrier nothing.
 * `null` when `element` is no barrier.
 */
function barrierText(
  element: Element,
  role: string,
  run: NameRun,
  at: ControlRead,
): string | null {
  const embedded =
    element === run.named ? null : embeddedControlText(element, role, run, at);
  if (embedded !== null) return embedded;
  return NAME_BARRIER_ROLES.has(role) && !isImplicitDetailsGroup(element)
    ? ""
    : null;
}

/**
 * The text an aria-labelledby (or aria-describedby) reference borrows from its
 * target: the target's own alternative where it has one, else its content.
 * Chromium reads `<button aria-labelledby="i">` over `<img id="i" alt="Direct">`
 * as "Direct", and over `<span id="s" aria-label="Lab">content</span>` as "Lab".
 * The target itself is read even when hidden — accname's "directly referenced"
 * carve-out — and then so is everything inside it, hidden or not: Chromium
 * reads `<span id="l" hidden>foo <span hidden>bar</span></span>` as "foo bar".
 * Inside a visible target, hidden content still contributes nothing.
 *
 * Unlike a descendant, a target with no name lends its content even when it
 * is an image, since accname §2F reads the content of any element a reference
 * names: Chromium reads `<span id="t" role="img">Revenue up</span>` as
 * "Revenue up", as a label or a description.
 *
 * The rest of the target's own name comes with it, as Chromium computes it:
 * a control the user adjusts lends its value, else its name
 * ({@link embeddedControlText}), and anything else its `<label>`s, a button
 * input's value, its content and last its `title` (AccName 2I), so a button
 * over `<label for="c">Agree</label><input type="checkbox" id="c">` is
 * "Agree", and over `<span id="t" title="Help"></span>` "Help".
 */
function referenceText(
  target: Element,
  run: NameRun,
  styleCache?: StyleCache | null,
): string {
  const walk: NameWalk = referenceWalk(target, styleCache);
  const role = getImplicitRole(target);
  const control = embeddedControlText(target, role, run, {
    ...walk,
    styleCache,
  });
  if (control !== null) return trimAscii(control);
  const tag = safeTagName(target);
  return trimAscii(
    textAlternative(target, role, run, styleCache, walk) ||
      labelsText(target, tag, run, styleCache) ||
      host.inputValueName(target, tag) ||
      getAccessibleTextContent(target, run, styleCache, walk) ||
      host.tooltipText(target, tag),
  );
}

/** The names of every element `element`'s aria-labelledby resolves to. */
function labelledByText(
  element: Element,
  run: NameRun,
  styleCache?: StyleCache | null,
): string {
  const labelledBy = safeGetAttribute(element, "aria-labelledby");
  if (!labelledBy) return "";
  const doc = idScope(element);
  return labelledBy
    .split(/\s+/)
    .map((id) => {
      const target = safeGetElementById(doc, id);
      return target ? referenceText(target, run, styleCache) : "";
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * The text of an `<svg>`'s first `<title>` child, which names it (SVG-AAM).
 * Read with the same walk as any name, never `textContent`: a `<textarea>`'s
 * markup text inside the title is its default value, and no name may carry it
 * (see flat-tree's `isTextarea`).
 */
function svgTitle(
  element: Element,
  run: NameRun,
  styleCache: StyleCache | null | undefined,
  walk: NameWalk,
): string {
  for (const child of element.children) {
    if (safeTagName(child) === "title") {
      return trimAscii(getAccessibleTextContent(child, run, styleCache, walk));
    }
  }
  return "";
}

/**
 * Recursive text-content walker for accessible name/description computation.
 *
 * Per WAI-ARIA accname-1.2 §4.3.2 step 2A, hidden subtrees contribute the
 * empty string. Skip element descendants that are aria-hidden, hidden,
 * inert, or display/content-visibility-hidden. `visibility: hidden` and
 * `collapse` drop only an element's own text (see {@link TextVisibility}). A skipped descendant
 * that still RENDERS contributes a separator even so, because its box keeps the
 * text either side of it apart — see {@link needsSpaceAround}. (A skipped child
 * is not recursed into, so a `display: contents` one whose own children render
 * blocks contributes no separator; obscure, and left as is.)
 *
 * Also skips descendants whose computed role is in `NAME_BARRIER_ROLES` —
 * see the set's docstring for the reasoning (treeitem-in-group, nested
 * widgets, etc.).
 *
 * Every other child lends its own text alternative ahead of its content
 * (accname §2F.iii): its aria-labelledby, its aria-label, an image's alt — see
 * {@link textAlternative}. Only a child with none of those is walked for its
 * text.
 *
 * Walks `flatChildNodes`, which gives a closed `<details>` its summary alone.
 * Its body isn't hidden by any style on its own nodes (a UA slot does it), so
 * the per-child hidden check couldn't catch it: a bare text node there would
 * otherwise leak into the name.
 *
 * The root element itself is NOT checked — callers reach this with an
 * element that is either already exposed to AT (name-from-content) or
 * directly referenced by aria-labelledby / a host-language label (the
 * spec's "directly referenced" carve-out).
 */
function getAccessibleTextContent(
  element: Element,
  run: NameRun,
  styleCache?: StyleCache | null,
  walk: NameWalk = {},
): string {
  const textVisible = rootTextVisible(walk, element, styleCache);
  const read: ControlRead = { ...walk, styleCache };
  let text = "";
  for (const child of flatChildNodes(element)) {
    const type = safeNodeType(child);
    if (type === Node.TEXT_NODE) {
      if (textVisible !== false) text += nameText(child, run);
    } else if (type === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      // A child that cannot be read costs its own text, not the host's name.
      // The walk's per-element boundary skips an element that throws, but a
      // throw here lands on the HOST being named, so the heading, link or
      // button went with everything in it. A `<form>` whose controls shadow
      // what is read of it does that: `<input name="nodeType">` lets the walk
      // into the form, and a second control named `getAttribute` throws once
      // it is in. Skip that element, as the boundary would.
      try {
        const childStyle = getCachedComputedStyle(childEl, styleCache);
        // Checked before aria-hidden so that `display: none` and `[hidden]`,
        // which generate no box, contribute no separator either — Chromium reads
        // `<h1>Save<div style="display:none">x</div>now</h1>` as "Savenow".
        //
        // Known gap, left alone deliberately: `inert` and
        // `content-visibility: hidden` are hidden from AT but still RENDER, so
        // Chromium spaces across them ("Save now") where this returns "Savenow".
        // Closing it means teaching this check to tell the two kinds of hidden
        // apart — a different question from how a child's box spaces its
        // neighbours, and one that predates this rule, so it is its own change.
        // Chromium's tree puts an area under its image, never under the element
        // its map sits in, so it adds nothing to that element's name — and no
        // separator either: it renders no box of its own. Checked before
        // `isSubtreeHidden`, which for an `<area>` goes looking for the image
        // using its map; the answer cannot change the outcome here.
        if (childEl.localName === "area") continue;
        if (
          walk.inReference !== "hidden" &&
          isSubtreeHidden(childEl, childStyle)
        )
          continue;
        // A child that has a box of its own separates the text either side of it
        // whether or not it contributes any text — Chromium reads
        // `<h1>Save<div aria-hidden="true">x</div>now</h1>` as "Save now".
        const spaced = needsSpaceAround(childEl, childStyle);
        if (isAriaHiddenChild(childEl, walk)) {
          if (spaced) text += " ";
          continue;
        }
        const role = getImplicitRole(childEl);
        // `visibility: hidden` / `collapse` (accname §2A). Its box still keeps
        // its neighbours apart, and a descendant may be visible again, but it
        // lends no alternative of its own: no aria-label, no widget name.
        const childWalk = childTextWalk({ ...walk, textVisible }, childStyle);
        if (childWalk.textVisible === false) {
          text += hiddenChildText(childEl, spaced, () =>
            getAccessibleTextContent(childEl, run, styleCache, childWalk),
          );
          continue;
        }
        // Named widgets contribute their computed name (accname §2F.iii). One
        // named by its text is spaced by the same box rule as everything else:
        // Chromium reads `<h2>Signed in as <a href="/u">Ada</a>'s profile</h2>`
        // as "Signed in as Ada's profile", not "… Ada 's profile", and only
        // spaces the link when it renders as its own block. One named by an
        // attribute is always spaced, like any other attribute-borne text
        // (see textAlternative): `<h2>Go to<a href="/" aria-label="Home">H</a>now</h2>`
        // is "Go to Home now", the same link named by its text "Go toHomenow".
        if (NAMED_WIDGET_ROLES.has(role)) {
          const source: NameSource = {};
          const named = computeAccessibleName(
            childEl,
            run,
            styleCache,
            walk.inReference,
            source,
          );
          // An editing host takes no name from its own content, but Chromium
          // still reads that text into an ancestor's name:
          // `<h2>Before <button contenteditable>Save</button></h2>` is
          // heading "Before Save".
          const name =
            named ||
            (isEditingHost(childEl)
              ? getAccessibleTextContent(childEl, run, styleCache, walk)
              : "");
          text += spaced || (named && !source.fromContent) ? ` ${name} ` : name;
          continue;
        }
        // A barrier's box keeps its neighbours apart even when it lends no
        // text: Chromium reads `<h1>Save<input>now</h1>` as "Save now".
        const barrier = barrierText(childEl, role, run, read);
        if (barrier !== null) {
          text += spaced ? ` ${barrier} ` : barrier;
          continue;
        }
        const alternative = walk.textOnly
          ? null
          : textAlternative(childEl, role, run, styleCache, walk);
        if (alternative !== null) {
          // Spaced whatever the box: Chromium reads `<a><img alt="Help">center</a>`
          // as "Help center" and `<a><span aria-label="Docs">D</span>site</a>`
          // as "Docs site". A nameless image lends no text, only its box.
          text += alternative ? ` ${alternative} ` : spaced ? " " : "";
          continue;
        }
        const inner = getAccessibleTextContent(
          childEl,
          run,
          styleCache,
          childWalk,
        );
        // Padded per accname §2F, which appends each descendant's result "with a
        // space"; the final normalization collapses the doubles. A child that
        // flows inline is NOT padded, because that is what Chromium reads:
        // `<button><span>Sa</span><span>ve</span></button>` is one word "Save",
        // while `<button><div>Save</div><div>now</div></button>` is "Save now".
        // The pad does not depend on `inner`: an empty block still separates its
        // neighbours ("Save<div></div>now" is "Save now").
        text += spaced ? ` ${inner} ` : inner;
      } catch (error) {
        warnSkippedElement(childEl, error);
      }
    }
  }
  return text;
}

/** Compute the accessible name for an element (simplified) */
/**
 * Accessible name, whitespace-normalized as Chromium and the AccName WPT
 * text-node cases do: collapse runs of ASCII whitespace — including the stray
 * newlines/indentation some pages leave inside their markup — to a single
 * space, and trim ASCII whitespace only, so a U+00A0 is kept. Normalizing
 * at this single source means every surface (panel, search, serializer,
 * snapshots) sees the same clean name.
 */
function computeAccessibleName(
  element: Element,
  run: NameRun,
  styleCache?: StyleCache | null,
  inReference: boolean | "hidden" = false,
  source?: NameSource,
): string {
  return collapseAscii(
    computeRawAccessibleName(element, run, styleCache, inReference, source),
  );
}

/**
 * The name a node records: a run of its own, read as
 * {@link REDACTED_VALUE} whole when anything in it was withheld (see
 * {@link NameRun.withheld}).
 */
function accessibleName(
  element: Element,
  styleCache: StyleCache,
  redactInput: boolean,
): string {
  // A label's own name leaves its control's value out, as the control's does.
  const control =
    safeTagName(element) === "label"
      ? (element as HTMLLabelElement).control
      : null;
  const run = newNameRun(redactInput, control ?? element);
  const name = computeAccessibleName(element, run, styleCache);
  return run.withheld ? REDACTED_VALUE : name;
}

/**
 * The text a form control's `<label>`s give it (step 4 of a name): HTML-AAM
 * joins every associated label in DOM order with spaces. Each label is read
 * once per computation, like any element under the visit-once guard: a
 * heading that holds a checkbox and its label is "Agree" in Chromium, not
 * "Agree Agree". "" for an element no label can name.
 */
function labelsText(
  element: Element,
  tag: string,
  run: NameRun,
  styleCache: StyleCache | null | undefined,
): string {
  if (!host.LABELED_TAGS.has(tag)) return "";
  const id = safeGetAttribute(element, "id");
  // Every `<label for>` in the control's tree, from the per-extraction index
  // rather than a query that rescans from the top for every control.
  const { labels, wrappingLabel } = associatedLabels(
    element,
    (id &&
      scopeReferenceIndex(styleCache, idScope(element)).labelFor.get(id)) ||
      [],
  );
  const labelParts: string[] = [];
  for (const label of labels) {
    if (run.visited.has(label)) continue;
    run.visited.add(label);
    const text =
      label === wrappingLabel
        ? wrappingLabelText(label, element, styleCache, {
            readText: (node) => nameText(node, run),
            readEmbedded: (child) =>
              embeddedControlText(child, getImplicitRole(child), run, {
                styleCache,
              }),
            readChild: (child, textVisible) =>
              // Each child's own alternative first, as in any name walk:
              // Chromium names `<label><img alt="Email"> <input></label>`
              // "Email". A `visibility: hidden` child lends none.
              (textVisible === false
                ? null
                : textAlternative(
                    child,
                    getImplicitRole(child),
                    run,
                    styleCache,
                    {},
                  )) ??
              getAccessibleTextContent(child, run, styleCache, {
                textVisible,
              }),
            onUnreadable: warnSkippedElement,
          })
        : trimAscii(getAccessibleTextContent(label, run, styleCache));
    if (text) labelParts.push(text);
  }
  return labelParts.join(" ");
}

function computeRawAccessibleName(
  element: Element,
  run: NameRun,
  styleCache: StyleCache | null | undefined,
  inReference: boolean | "hidden",
  source: NameSource | undefined,
): string {
  // accname visit-once guard (§4.3.2): an element the current name computation
  // has already read contributes the empty string when reached again.
  // Without this, an aria-labelledby that points at an ancestor containing the
  // element cycles between labelledby resolution and name-from-content until
  // the stack overflows (seen on real pages, e.g. the mercadolibre signup).
  //
  // Not inside a reference traversal, where Chromium skips it too: an element
  // two IDREFs reach is read for each, so `aria-labelledby="a a"` over
  // `<span id="a">Pick <a href="/">Docs</a></span>` is "Pick Docs Pick Docs".
  // That cannot cycle. A traversal follows no aria-labelledby (step 1), and
  // the only way out of the subtree it walks is a control's <label> (step 4),
  // whose content is read with this guard on.
  if (run.visited.has(element) && !inReference) return "";
  run.visited.add(element);

  // 1. aria-labelledby is resolved before aria-label (accname-1.2 §2B
  //    precedes §2D): concatenate the accessible names of every referenced
  //    IDREF, in order. The visit-once guard above breaks reference cycles.
  //    Not inside another reference traversal, where it is ignored (§2B).
  if (!inReference) {
    const labelledBy = labelledByText(element, run, styleCache);
    if (labelledBy) return labelledBy;
  }

  // 2. aria-label, unless it is blank: accname skips one that is only
  //    whitespace, as Chromium does. `<button aria-label=" ">Save</button>` is
  //    "Save", `<img aria-label=" " alt="Home">` "Home".
  const ariaLabel = trimAscii(safeGetAttribute(element, "aria-label") ?? "");
  if (ariaLabel) return ariaLabel;

  const tag = safeTagName(element);

  // 3. alt attribute for images. An empty alt is an intentional "no name"
  //    and stops here — EXCEPT when a `title` is also present. HTML-AAM keeps
  //    such an image exposed (see the img entry in ROLE_MAP) and names it from
  //    the title, so returning "" here would leave an exposed, nameless image.
  //    Scoped to <img>, the element whose role the empty alt also changes;
  //    <area> keeps its existing behaviour.
  if (tag === "img" || tag === "area") {
    const alt = safeGetAttribute(element, "alt");
    const titleNamesEmptyAlt =
      tag === "img" &&
      alt === "" &&
      !!safeGetAttribute(element, "title")?.trim();
    if (alt !== null && !titleNamesEmptyAlt) return alt;
  }

  // 3a. An <svg> is named by its first <title> child (SVG-AAM), after
  //     aria-label: Chromium names `<svg><title>Close</title></svg>` "Close",
  //     and `<svg aria-label="Shut"><title>Close</title></svg>` "Shut".
  if (tag === "svg") {
    const title = svgTitle(element, run, styleCache, { inReference });
    if (title) return title;
  }

  // 4. Label elements for form controls (see labelsText), then 5. a button
  //    input's value or alt (see inputValueName). Steps 4a–4c name other
  //    elements than these, so this order is theirs too.
  const hostName =
    labelsText(element, tag, run, styleCache) ||
    host.inputValueName(element, tag);
  if (hostName) return hostName;

  // 4a. Fieldset and details — accessible name comes from the direct <legend>
  //     or <summary> child.
  const nameChild =
    tag === "fieldset" ? "legend" : tag === "details" ? "summary" : null;
  const nameEl = nameChild && element.querySelector(`:scope > ${nameChild}`);
  if (nameEl)
    return trimAscii(getAccessibleTextContent(nameEl, run, styleCache));

  // 4b. The `label` attribute names an <option> or <optgroup> (HTML-AAM).
  const attrName = host.labelAttributeName(element, tag);
  if (attrName) return attrName;

  // 4c. Table — HTML-AAM names it from `HTMLTableElement.caption`. Hidden
  // captions must not name it (accname §4.3.2 step 2A); an empty caption
  // must fall through so `title` can still win.
  if (tag === "table") {
    const caption = (element as HTMLTableElement).caption;
    if (caption) {
      const hidden =
        isAriaHiddenValue(safeGetAttribute(caption, "aria-hidden")) ||
        isSubtreeHidden(caption, getCachedComputedStyle(caption, styleCache));
      if (!hidden) {
        const t = trimAscii(getAccessibleTextContent(caption, run, styleCache));
        if (t) return t;
      }
    }
  }

  // 8. Recursive text content — ONLY for elements whose ARIA role supports
  //    "name from content" (headings, links, buttons, checkboxes, table cells,
  //    options — see NAMES_FROM_CONTENT_ROLES). NOT for generic containers
  //    (div, span, p) which would grab huge text blobs.
  if (!MEDIA_TAGS.has(tag) && isNameFromContentHost(element)) {
    const fullText = trimAscii(
      getAccessibleTextContent(element, run, styleCache, {
        inReference,
        textOnly: tag === "option",
      }),
    );
    if (fullText) {
      if (source) source.fromContent = true;
      return fullText;
    }
  }

  // Strict mode withheld what a step above read: the name reads `[redacted]`
  // whole, so `title` is no fallback. Left unread, it stays the description it
  // would be beside that name.
  if (run.withheld) return "";

  // 6, 6a, 7. title, an image input's default, placeholder (see tooltipText).
  const tooltip = host.tooltipText(element, tag, source);
  if (tooltip) return tooltip;

  // Media elements never name from content: their light-DOM children are
  // unrendered fallback ("Sorry, your browser doesn't support…") plus
  // <track>/<source> metadata. Without this guard the fallback text leaked
  // in as the accessible name via the direct-text step below. Chromium
  // exposes an unlabeled <video> with an empty name — mirror that.
  if (MEDIA_TAGS.has(tag)) return "";

  // 9. Fallback: the element's own text — for generics and prose, never for
  //    a role only an author can name (see AUTHOR_NAMED_ROLES). For a
  //    sectionheader/sectionfooter that also keeps a byline from making the
  //    header "named" and so kept in the a11y view, where the native producer
  //    drops it as bare. Nor for an editing host: its text is what the user
  //    typed — its VALUE (ADR-0001), which never doubles as its name. Chromium
  //    leaves an editing host of any role unnamed by its content (see
  //    isNameFromContentHost, which gates step 8 the same way).
  const role = getImplicitRole(element);
  if (AUTHOR_NAMED_ROLES.has(role) || isEditingHost(element)) return "";
  // In strict mode, text a user typed is this element's own text alone: the
  // native producer blanks such text runs, so a typed paragraph reads unnamed
  // there, and here. Read through a run of its own, so the element's name
  // isn't `[redacted]`: each text node is asked, which also catches editor
  // text slotted into a shadow tree, where the element itself isn't editable.
  const own = run.redactInput ? newNameRun(true) : null;
  const read = own ? (node: Node) => nameText(node, own) : textOf;
  const ownText = readsTextRuns(role)
    ? trimAscii(getOwnText(element, styleCache, read))
    : getDirectTextContent(element, read);
  if (own?.withheld) return "";
  if (ownText) {
    if (source) source.fromContent = true;
    return ownText;
  }

  return "";
}

/**
 * True if an element of `role` takes the text of its {@link isTextRun} children
 * as its own: every role the own-text step names except a `generic` (and a
 * presentational element, which no view keeps). A generic's name decides
 * whether the a11y view keeps it (`keepNode` in a11y-extractor.ts), so reading
 * through its wrappers would add a node for every `<div><span>…</span></div>`,
 * its text a copy of the span's below it. The words are not lost there: the
 * wrapper keeps its own node and name, as it does under a heading.
 */
function readsTextRuns(role: string): boolean {
  return role !== "generic" && role !== "presentation";
}

/**
 * The element's own text as Chromium lays it out: its text-node children, and
 * the text of each child that is only a {@link isTextRun}, in document order.
 * A `<br>` reads as a space, as the native producer reads Chromium's
 * `LineBreak`. Any other child owns its text — a link, a `<code>`, a hidden
 * span — and lends none here, nor a separator: the native producer
 * concatenates the runs Chromium hangs on the element exactly as they are.
 */
function getOwnText(
  element: Element,
  styleCache: StyleCache | null | undefined,
  readText: (node: Node) => string,
): string {
  let text = "";
  for (const child of flatChildNodes(element)) {
    const type = safeNodeType(child);
    if (type === Node.TEXT_NODE) {
      text += readText(child);
    } else if (type === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      // A child that cannot be read costs its own text, not the host's name —
      // as in getAccessibleTextContent.
      try {
        const style = getCachedComputedStyle(childEl, styleCache);
        // A hidden child adds nothing, not even a hidden `<br>`'s space:
        // Chromium hangs no `LineBreak` for it, so `A<br hidden>B` is "AB".
        if (isHiddenFromAT(childEl, style)) continue;
        if (safeTagName(childEl) === "br") {
          text += " ";
        } else if (isTextRun(childEl, style)) {
          text += getOwnText(childEl, styleCache, readText);
        }
      } catch (error) {
        warnSkippedElement(childEl, error);
      }
    }
  }
  return text;
}

/**
 * Tags that extract as `generic` but that Chromium still gives a node of its
 * own (`LabelText`, `Abbr`, `Ruby`, `Canvas`, `PluginObject`…), so their text
 * is theirs, not the line's. Measured over CDP: `<p>A <label>w</label> B</p>`
 * is paragraph "A B" there. A `<canvas>`' or `<object>`'s children are its
 * fallback, which a loaded `<object>` never even renders. An `<a>` with no
 * href is not here: Chromium reads it as a plain run.
 */
const OWN_NODE_GENERIC_TAGS = new Set([
  "abbr",
  "canvas",
  "label",
  "legend",
  "object",
  "q",
  "rp",
  "rt",
  "ruby",
  "summary",
]);

/**
 * True if `element` is only a run of its parent's text: a role-less inline
 * wrapper, which Chromium leaves out of its tree so that the text inside it
 * hangs straight off the element around it. A `<span>`, a `<b>`, a custom
 * element, an unknown tag (`<semanticnavigator>`, what v-html makes of a
 * literal `<SemanticNavigator />`), a `role="none"` — and the same with a
 * class, a style, a `data-*` or a `dir`.
 *
 * Measured against Chromium 153, a wrapper gets a node — and keeps its text —
 * when anything could name it (a `title`, any `aria-*`), focus it (`tabindex`,
 * an `onclick`, an editing host), point at it (`id`) or needs it (`lang`), when
 * its role is anything but generic or none (an explicit `role="generic"`
 * included; an empty or unknown token is no role), and when it has a box of
 * its own: `display: block`, `flex` or `inline-table`, or a float or an
 * absolutely positioned one, which CSS blockifies. Inline boxes — `inline`,
 * `inline-block`, `inline-flex`, `ruby` — and `display: contents` are runs. A
 * hidden one contributes nothing at all, which {@link getOwnText} decides
 * before it asks.
 *
 * The live extractor's climb asks {@link textRunHost} instead, which reads
 * only what an attribute change can't flip.
 */
function isTextRun(
  element: Element,
  style: CSSStyleDeclaration | null,
): boolean {
  if (!mayBeTextRun(element, getImplicitRole(element), style)) return false;
  if (getExplicitRole(element) === "generic") return false;
  // Clobber-safe: an inline `<form>` in a list item gets this far.
  for (const name of safeGetAttributeNames(element)) {
    if (
      name === "id" ||
      name === "lang" ||
      name === "tabindex" ||
      name === "onclick" ||
      name.startsWith("aria-") ||
      (name === "title" && safeGetAttribute(element, "title") !== "")
    ) {
      return false;
    }
  }
  return !isEditable(element);
}

/**
 * What {@link isTextRun} reads that no attribute of the element's own can
 * flip, short of a `role` or a restyle: a tag Chromium leaves out of its tree,
 * a role that is generic or none, and an inline box (or none at all, once it is
 * hidden).
 */
function mayBeTextRun(
  element: Element,
  role: string,
  style: CSSStyleDeclaration | null,
): boolean {
  if (OWN_NODE_GENERIC_TAGS.has(safeTagName(element))) return false;
  if (role !== "generic" && role !== "presentation") return false;
  // No computed style to read: a tag alone can't tell a `<span>` from a
  // `<div>`, so keep the element's text its own, as before.
  const display = style?.display;
  if (!display) return false;
  return (
    display === "contents" ||
    display === "none" ||
    display.startsWith("ruby") ||
    (display.startsWith("inline") && display !== "inline-table")
  );
}

/**
 * The element whose own text may hold `element`'s — its parent, when `element`
 * may be a {@link isTextRun} there and the own-text step names the parent from
 * its runs — for the live extractor's climb. A text change inside a `<span>`
 * changes the paragraph around it, and so can an attribute that makes the span
 * a node of its own (an `aria-label`, an `id`), which is why this reads only
 * what such an attribute leaves alone: it must hold before the change as well
 * as after. A parent the step never names (a landmark, an editor) is no host,
 * so a span loose in `<main>` doesn't re-extract the page.
 *
 * The one change it misses is a restyle that turns an inline run into a block:
 * the paragraph keeps the text until it is next re-extracted. Reading through
 * blocks too would close that, at the cost of re-extracting a list item, and
 * every list nested in it, each time a class changes on a row inside it.
 */
export function textRunHost(element: Element): Element | null {
  const parent = flatParent(element);
  if (!parent) return null;
  const parentRole = getImplicitRole(parent);
  if (
    !readsTextRuns(parentRole) ||
    AUTHOR_NAMED_ROLES.has(parentRole) ||
    isEditingHost(parent)
  ) {
    return null;
  }
  return mayBeTextRun(
    element,
    getImplicitRole(element),
    getCachedComputedStyle(element),
  )
    ? parent
    : null;
}

/** A text node's text, as the default mode reads it into a name. */
const textOf = (node: Node): string => node.textContent || "";

/** Get direct text content of an element, excluding child element text */
function getDirectTextContent(
  element: Element,
  readText: (node: Node) => string = textOf,
): string {
  let text = "";
  for (const child of flatChildNodes(element)) {
    if (safeNodeType(child) === Node.TEXT_NODE) {
      text += readText(child);
    }
  }
  return trimAscii(text);
}

/**
 * ARIA state attributes hoisted onto every node's `state`. Exported for the
 * same reason as `KEY_ATTRIBUTES` — these are exactly the attributes an app
 * flips in place (`aria-current` on an SPA route change, `aria-busy` around a
 * fetch), so the observer has to watch them or the state never refreshes.
 */
export const ARIA_STATE_ATTRIBUTES = [
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

/** Form controls whose `disabled` Chromium reports, and passes to their content. */
const DISABLEABLE_TAGS = new Set(["button", "input", "select", "textarea"]);

/**
 * True for a control HTML calls disabled, which Chromium reports disabled.
 *
 * Not a `<fieldset>`, although `:disabled` matches one: Chromium reports
 * neither the fieldset nor its non-control content disabled. Its effect
 * reaches the controls it disables, and through them their content.
 */
function isDisabledControl(element: Element): boolean {
  const tag = safeTagName(element);
  if (tag === "option") return isDisabledOption(element);
  // Not `.disabled`, which misses a control disabled by its fieldset.
  return DISABLEABLE_TAGS.has(tag) && isActuallyDisabled(element);
}

/**
 * An option HTML calls disabled: by its own `disabled`, or by its parent
 * `<optgroup disabled>`.
 *
 * Not `:disabled`, which Chromium 151 also matches for every option in a
 * disabled `<select>`. Its accessibility tree treats that option as
 * inheriting the state instead, which the option's own `aria-disabled="false"`
 * overrides, as does that of an optgroup in between.
 */
function isDisabledOption(option: Element): boolean {
  if (option.hasAttribute("disabled")) return true;
  // eslint-disable-next-line no-restricted-properties -- one read, and an <option> is never a form
  const parent = option.parentElement;
  return (
    !!parent &&
    safeTagName(parent) === "optgroup" &&
    parent.hasAttribute("disabled")
  );
}

/**
 * `aria-disabled` as Chromium reads it: `null` when absent, empty or
 * `undefined`, which leaves the element to inherit. See `ariaBoolean`.
 */
function explicitAriaDisabled(element: Element): boolean | null {
  return ariaBoolean(safeGetAttribute(element, "aria-disabled"));
}

/**
 * One ARIA state attribute's value as Chromium reads it, or `null` when that
 * leaves the state unset. `role` is the element's computed role, which
 * decides whether `aria-checked` can be mixed.
 */
function ariaStateValue(
  element: Element,
  attr: string,
  role: string,
): boolean | string | null {
  const value = safeGetAttribute(element, attr);
  switch (attr) {
    case "aria-checked":
      return ariaTristate(value, role);
    case "aria-pressed":
      return ariaTristate(value);
    case "aria-current":
      return ariaCurrent(value);
    default:
      return ariaBoolean(value);
  }
}

/**
 * True when an ancestor disables `element`, the way Chromium passes the state
 * down its accessibility tree: the nearest flat-tree ancestor that is a
 * disabled control, or that sets `aria-disabled` explicitly, decides.
 *
 * A disabled control decides `true` whatever its own `aria-disabled` says,
 * since that can't re-enable it. An explicit `aria-disabled="false"` in
 * between decides `false`. The walk goes past the extraction root on purpose:
 * the live extractor re-extracts one mutated subtree at a time, and an
 * ancestor above it still counts.
 */
function inheritsDisabled(element: Element): boolean {
  for (let el = flatParent(element); el; el = flatParent(el)) {
    if (isDisabledControl(el)) return true;
    const explicit = explicitAriaDisabled(el);
    if (explicit !== null) return explicit;
  }
  return false;
}

/**
 * True when Chromium's tree counts `element` as focusable, which is what lets
 * it inherit `disabled` (CORE-AAM). That is `isFocusable()`'s answer, adjusted
 * the three ways Chromium differs from it:
 *
 * - A native `<option>` counts, which is how every option in a disabled
 *   select comes out disabled.
 * - An editing host counts: Chromium focuses one with no `tabindex`, and
 *   `isFocusable()` doesn't count it yet.
 * - A link inside editable content doesn't, because editing takes its focus
 *   away, unless a `tabindex` gives it back.
 */
function takesInheritedDisabled(
  element: Element,
  tag: string,
  focusable: boolean,
): boolean {
  if (tag === "option" || isEditingHost(element)) return true;
  if (!focusable) return false;
  return !(
    tag === "a" &&
    parseTabindex(safeGetAttribute(element, "tabindex")) === null &&
    isEditable(element)
  );
}

/**
 * A native checkbox's or radio's checkedness, and `"mixed"` for an
 * indeterminate checkbox, which Chromium reads in place of `aria-checked` and
 * `aria-pressed`. `null` for any other element, including any other `<input>`
 * type, which reads `aria-checked` as usual.
 *
 * `indeterminate` is a property with no attribute, and script is the only
 * thing that sets it, so no mutation reports the change. `LiveTreeExtractor`
 * re-reads every checkbox and radio on refresh for that reason.
 */
function nativeChecked(element: Element): boolean | "mixed" | null {
  if (safeTagName(element) !== "input") return null;
  const input = element as HTMLInputElement;
  if (input.type === "checkbox")
    return input.indeterminate ? "mixed" : input.checked;
  return input.type === "radio" ? input.checked : null;
}

/**
 * Whether a drop-down `<select>`'s picker is open, which is its expanded
 * state in Chromium's tree. An engine without the `:open` pseudo-class throws
 * on it, and has no other way to tell.
 */
function isPickerOpen(select: Element): boolean {
  try {
    return select.matches(":open");
  } catch {
    return false;
  }
}

/**
 * Roles on which Chromium exposes a native checkbox's or radio's checkedness
 * as `checked`. Its own role is one of them.
 */
const CHECKEDNESS_ROLES = new Set([
  "checkbox",
  "radio",
  "switch",
  "menuitemcheckbox",
  "menuitemradio",
]);

/**
 * Roles under which a `<details>`' summary takes `expanded` from the details,
 * measured against Chromium 151 across every ARIA role. Its own role, which
 * the engine calls `generic`, is a disclosure too.
 */
const SUMMARY_EXPANDED_ROLES = new Set([
  "application",
  "button",
  "checkbox",
  "columnheader",
  "combobox",
  "form",
  "gridcell",
  "link",
  "listitem",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "region",
  "row",
  "rowheader",
  "switch",
  "tab",
  "treeitem",
]);

/** The `<input>` types that can invoke a popover through `popovertarget`. */
const POPOVER_INVOKER_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "image",
]);

/** The `command` values that show or hide a popover, in any case. */
const POPOVER_COMMANDS = new Set([
  "toggle-popover",
  "show-popover",
  "hide-popover",
]);

/**
 * The element an IDREF attribute names, the way its reflecting property
 * (`popoverTargetElement`, `commandForElement`) resolves it: the id in the
 * element's own tree, or an element script set. An engine without the
 * property, such as jsdom, gets the id lookup alone.
 */
function referencedElement(
  element: Element,
  attr: string,
  property: string,
): Element | null {
  if (property in element)
    return (element as unknown as Record<string, Element | null>)[property];
  const id = safeGetAttribute(element, attr);
  return id ? safeGetElementById(idScope(element), id) : null;
}

/**
 * True for a submit button: an `<input>` of type submit or image, or a
 * `<button>` of type submit. A `<button>` with a missing or invalid type is
 * one too, unless it has a `commandfor`, which makes it a plain button.
 * `type` is its `type` attribute, lowercased.
 */
function isSubmitButton(element: Element, tag: string, type: string): boolean {
  if (tag === "input") return type === "submit" || type === "image";
  if (type === "button" || type === "reset") return false;
  return type === "submit" || !element.hasAttribute("commandfor");
}

/**
 * The element a `<button>` or `<input>` shows and hides, as Chromium 151
 * resolves it for the expanded state, or `null`:
 *
 * - A `<button>`'s `commandfor` decides when it names an element and its
 *   `command` is a popover one, whether or not that element is a popover.
 * - Otherwise `popovertarget` does, when it names a popover. An `<input>`
 *   takes it only as a button, submit, reset or image.
 * - Neither, for a disabled control, or a submit button with a form: that
 *   one submits the form instead.
 */
function invokedElement(element: Element, tag: string): Element | null {
  const type = (safeGetAttribute(element, "type") ?? "").toLowerCase();
  if (tag === "input") {
    if (!POPOVER_INVOKER_INPUT_TYPES.has(type)) return null;
  } else if (tag !== "button") {
    return null;
  }
  if (isActuallyDisabled(element)) return null;
  if (isSubmitButton(element, tag, type) && (element as HTMLButtonElement).form)
    return null;
  if (tag === "button") {
    const command = (safeGetAttribute(element, "command") ?? "").toLowerCase();
    const target = POPOVER_COMMANDS.has(command)
      ? referencedElement(element, "commandfor", "commandForElement")
      : null;
    if (target) return target;
  }
  const popover = referencedElement(
    element,
    "popovertarget",
    "popoverTargetElement",
  );
  // Through the prototype: the target can be a <form>, which a field named
  // `hasAttribute` or `contains` shadows.
  return popover && safeGetAttribute(popover, "popover") !== null
    ? popover
    : null;
}

/**
 * True when `element` is inside `container`, crossing shadow roots, and is
 * not `container` itself.
 */
function isShadowIncludingDescendant(
  element: Element,
  container: Element,
): boolean {
  if (element === container) return false;
  for (let el: Element | undefined = element; el;) {
    if (safeContains(container, el)) return true;
    const root = safeRootNode(el);
    el = root.nodeType === 11 ? (root as ShadowRoot).host : undefined;
  }
  return false;
}

/**
 * A popover invoker's `expanded` state in Chromium's tree: whether the
 * element it shows and hides is a showing popover. See {@link invokedElement}
 * for which controls invoke which element.
 *
 * `null` where `aria-expanded` decides instead: for a control that invokes
 * nothing, or sits inside what it invokes, like a popover's close button.
 * Also for a role Chromium gives no expanded state, which it lacks whatever
 * sets one, and in an engine without popovers, which throws on
 * `:popover-open`.
 */
function popoverExpanded(
  element: Element,
  tag: string,
  role: string,
): boolean | null {
  if (!canExpand(element, role)) return null;
  const invoked = invokedElement(element, tag);
  if (!invoked || isShadowIncludingDescendant(element, invoked)) return null;
  try {
    return Element.prototype.matches.call(invoked, ":popover-open");
  } catch {
    return null;
  }
}

/**
 * The `expanded` state {@link getAriaStates} gives `element` in `role`.
 *
 * A popover shows and hides with no mutation on the controls that invoke it,
 * so `LiveTreeExtractor` re-reads this for each of them on refresh. It asks
 * `getAriaStates` itself rather than restating its precedence, which would
 * drift. `focusable` decides only `disabled`, so it is passed as false.
 */
export function expandedState(
  element: Element,
  role: string,
): boolean | undefined {
  return getAriaStates(element, role, false)["expanded"] as boolean | undefined;
}

/**
 * The states an element's own semantics decide, which Chromium reads in
 * place of the matching ARIA attribute. A state mapped to `undefined` is one
 * the element doesn't have, whatever its attribute says. `role` is its
 * computed role. Each rule was measured against Chromium 151.
 *
 * - A native checkbox or radio: its checkedness ({@link nativeChecked}) is
 *   `checked` on a role in {@link CHECKEDNESS_ROLES}, and on an `option` or
 *   `treeitem` while `aria-checked` is set. It is `pressed` instead on a
 *   `button` with `aria-pressed`, a toggle button. Any other role has neither.
 * - A `<select>` as a combobox or list box: a drop-down
 *   ({@link isDropDownSelect}) in the combobox role is expanded while its
 *   picker is open. A list box has no expanded state, unless the author gave
 *   it the combobox role, which reads `aria-expanded` as usual. Neither is a
 *   toggle button, so neither has `pressed`. Any other author role reads
 *   `aria-expanded` and `aria-pressed` as usual.
 * - Any `<summary>` child of a `<details>`, not only the one that toggles it:
 *   `expanded` is whether the details is open, in its own role or one in
 *   {@link SUMMARY_EXPANDED_ROLES}, and nothing under any other role. Only a
 *   `button` role makes it a toggle button, with a `pressed`.
 * - A `<button>` or `<input>` that invokes a popover: `expanded` is whether
 *   the popover is showing, from {@link popoverExpanded}.
 * - An `<option>` of a `<select>`, in the `option` role: `selected` is its
 *   selectedness, HTML-AAM's mapping, and `false` when it isn't selected. An
 *   authored `aria-selected` still wins when it is a valid boolean: Chromium
 *   151 reports `aria-selected="true"` on an unselected option as selected,
 *   and `"false"` on the selected one as not. A select the field-value rules
 *   withhold ({@link isSensitiveField}) gets no `selected` at all, since
 *   which option is chosen is the value they withhold.
 */
export function nativeStates(
  element: Element,
  tag: string,
  role: string,
): Record<string, boolean | string | undefined> {
  const checked = nativeChecked(element);
  if (checked !== null) {
    const ariaSet = (attr: string) =>
      ariaTristate(safeGetAttribute(element, attr)) !== null;
    if (role === "button" && ariaSet("aria-pressed"))
      return { checked: undefined, pressed: checked };
    const exposed =
      CHECKEDNESS_ROLES.has(role) ||
      ((role === "option" || role === "treeitem") && ariaSet("aria-checked"));
    return { checked: exposed ? checked : undefined, pressed: undefined };
  }
  if (tag === "select") {
    if (role !== "combobox" && role !== "listbox") return {};
    if (role === "combobox" && isDropDownSelect(element))
      return { expanded: isPickerOpen(element), pressed: undefined };
    // A list box has no expanded state, unless an author's combobox role
    // gives it one, read from aria-expanded as usual. Asked of the authored
    // role, not `role`: the live extractor passes the role it recorded, which
    // a since-changed `role`, `size` or `multiple` leaves stale.
    return getExplicitRole(element) === "combobox"
      ? { pressed: undefined }
      : { expanded: undefined, pressed: undefined };
  }
  if (tag === "button" || tag === "input") {
    const expanded = popoverExpanded(element, tag, role);
    return expanded === null ? {} : { expanded };
  }
  if (tag !== "summary") return optionStates(element, tag, role);
  // Read only for a summary: on a <form>, a field named `parentElement`
  // shadows the property.
  const details = safeParentElement(element);
  if (details && safeTagName(details) === "details") {
    const disclosure =
      (role === "generic" && getExplicitRole(element) !== "generic") ||
      SUMMARY_EXPANDED_ROLES.has(role);
    const expanded = disclosure
      ? (details as HTMLDetailsElement).open
      : undefined;
    return role === "button" ? { expanded } : { expanded, pressed: undefined };
  }
  return {};
}

/**
 * Get ARIA states from an element. `role` is its computed role, and
 * `focusable` its `isFocusable()` answer, both of which the caller already
 * has.
 */
function getAriaStates(
  element: Element,
  role: string,
  focusable: boolean,
): Record<string, string | boolean> {
  const states: Record<string, string | boolean> = {};
  const tag = safeTagName(element);
  const native = nativeStates(element, tag, role);

  for (const attr of ARIA_STATE_ATTRIBUTES) {
    const state = attr.slice("aria-".length);
    // The element's own semantics decide it, below.
    if (state in native) continue;
    // Chromium never marks an optgroup disabled, whatever its role. Its
    // options still inherit the state from it, below.
    if (attr === "aria-disabled" && tag === "optgroup") continue;
    if (!roleTakesState(element, attr, role)) continue;
    const value = ariaStateValue(element, attr, role);
    if (value !== null) states[state] = value;
  }
  for (const [state, value] of Object.entries(native))
    if (value !== undefined) states[state] = value;

  addFieldStates(element, tag, role, states);

  // A disabled control is disabled whatever its aria-disabled says. Anything
  // else with an explicit aria-disabled keeps it. The rest inherit from an
  // ancestor, if Chromium counts them focusable, as CORE-AAM says.
  if (isDisabledControl(element)) {
    states["disabled"] = true;
  } else if (
    explicitAriaDisabled(element) === null &&
    takesInheritedDisabled(element, tag, focusable) &&
    inheritsDisabled(element)
  ) {
    states["disabled"] = true;
  }

  return states;
}

/**
 * Get the element reference map — shared across extractions, and across every
 * copy of this package in the realm.
 *
 * The second half is load-bearing. `dispatch()` in `@real-a11y-dev/testing`
 * turns a node id back into a live `Element` through this map, and the
 * extraction that filled it usually happened in a different package. Every
 * published package bundles its own copy of the engine, so a per-module map
 * means the reader looks in one object and the writer wrote to another: the
 * lookup misses and the action silently does nothing.
 */
export function getElementRefs(): ElementRefMap {
  return realmSingleton(
    "element-refs",
    ELEMENT_REF_MAP_SHAPE,
    () => new ElementRefMap(),
  );
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
  const el = resolveFocusedElement(safeOwnerDocument(root));
  if (!el) return undefined;
  const id = getElementRefs().findId(el);
  return id && nodes.has(id) ? id : undefined;
}

/**
 * Options for {@link extractDomTree}. Primarily for internal incremental
 * extraction; the public single-argument form is unchanged.
 */
export interface ExtractDomTreeOptions extends RedactInputOption {
  /** Existing nodes map to update in-place. When provided, extraction is partial. */
  nodes?: Map<string, SemanticNode>;
  /** Parent id for the root of this partial extraction. */
  parentId?: string | null;
  /** Depth offset for the root of this partial extraction. */
  baseDepth?: number;
  /** Whether to compute the focused element id. Default true for full extractions. */
  includeFocused?: boolean;
}

/** What one extraction carries to every node it builds. */
interface Extraction {
  /** Fresh per extraction: styles may change between two of them. */
  readonly styleCache: StyleCache;
  readonly redactInput: boolean;
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
 * A shadowed `tagName` or `getAttribute` no longer reaches this boundary: every
 * read of the element being built goes through `safeTagName` and
 * `safeGetAttribute`, so such a form keeps its fields and buttons. The boundary
 * stays for clobbering nobody has found yet.
 *
 * Nothing here mutates `nodes` / the element ref map; the caller commits the node
 * only on success, so a caught element never leaves a half-built node behind.
 */
function buildNode(
  element: Element,
  parentId: string | null,
  depth: number,
  { styleCache, redactInput }: Extraction,
): { id: string; node: SemanticNode } | null {
  try {
    const tag = safeTagName(element);
    if (SKIP_TAGS.has(tag)) return null;

    // Skip Semantic Navigator internal elements (highlight overlay, curtain, etc.)
    // Read the id via getAttribute, not the `.id` property: on a <form> (or the
    // legacy named-property elements) a child named `id` clobbers `element.id`
    // to return that element, so `.id.startsWith(...)` would throw a TypeError
    // and crash the whole extraction. getAttribute always yields a string|null.
    if (safeGetAttribute(element, "id")?.startsWith("__sn-")) return null;
    // Through the prototype: every element is asked this, and on a <form>
    // holding `<input name="hasAttribute">` the method is that input.
    if (safeGetAttribute(element, PANEL_HOST_ATTRIBUTE) !== null) return null;

    // Resolve style once for this element — subtree-hidden / visually-hidden /
    // AT-hidden / sr-only all share the declaration via the per-extraction cache.
    const style = getCachedComputedStyle(element, styleCache);

    // Skip entire subtrees of display:none / hidden elements
    if (isSubtreeHidden(element, style)) return null;

    // An `aria-describedby` target is NOT folded into its referrer. A
    // description is a property of the referrer; it does not take the target
    // out of the page. WAI-ARIA 1.2 §7.2 requires an accessible object for a
    // non-hidden element whose id another element references, and Chromium
    // keeps the paragraph, heading or list as a node, so the description text
    // simply appears twice. Hidden targets are skipped above and still feed
    // the referrer's description.

    const id = getNodeId(element);
    const role = getImplicitRole(element);
    // Strict mode decides at the read: what it withholds is never computed.
    const value = redactInput
      ? undefined
      : getAnnouncedValue(element, role, styleCache);
    const actions = getActions(element);
    const focusable = isFocusable(element);
    const headingLevel = getHeadingLevel(element);
    const isMedia = MEDIA_TAGS.has(tag);
    const states = getAriaStates(element, role, focusable);

    const node: SemanticNode = {
      id,
      parentId,
      childIds: [],
      depth,
      dom: {
        tagName: tag,
        attributes: getKeyAttributes(element, redactInput),
        ...textPreviews(element, isMedia || redactInput),
        isHidden: isVisuallyHidden(element, style),
      },
      a11y: {
        role,
        name: accessibleName(element, styleCache, redactInput),
        description: computeAccessibleDescription(
          element,
          styleCache,
          redactInput,
        ),
        ...(value !== undefined ? { value } : {}),
        states: redactInput ? withholdStates(element, role, states) : states,
        properties: {
          ...(headingLevel !== null ? { level: String(headingLevel) } : {}),
          // The walk doesn't descend into media children, so the one
          // a11y-critical signal that lives there — does this media ship
          // a captions/subtitles track? (WCAG 1.2.2) — is hoisted onto
          // the media node itself.
          ...(isMedia
            ? { captions: hasCaptionsTrack(element) ? "true" : "false" }
            : {}),
        },
        isExposedToAT: !isHiddenFromAT(element, style),
      },
      interaction: {
        isInteractive: actions.length > 0,
        actions,
        isFocusable: focusable,
        isEditable:
          (tag === "input" &&
            TEXT_INPUT_TYPES.has(
              (element as HTMLInputElement).type || "text",
            )) ||
          tag === "textarea" ||
          isEditingHost(element),
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

/**
 * A node's `dom` text previews. None for media, whose children are unrendered
 * fallback and <track>/<source> metadata: "Sorry, your browser doesn't
 * support…" as a preview would misrepresent what AT renders. None in strict
 * mode either, which keeps what a user typed off every node, as the native
 * producer keeps no previews at all.
 */
function textPreviews(
  element: Element,
  none: boolean,
): Pick<NonNullable<SemanticNode["dom"]>, "textContent" | "descendantText"> {
  return none
    ? { textContent: "", descendantText: "" }
    : {
        textContent: getDirectTextContent(element),
        descendantText: getDescendantText(element),
      };
}

function walk(
  element: Element,
  parentId: string | null,
  depth: number,
  nodes: Map<string, SemanticNode>,
  extraction: Extraction,
): string | null {
  const built = buildNode(element, parentId, depth, extraction);
  if (!built) return null;
  const { id, node } = built;

  // Commit the finished node. Neither map write can throw, so a node that was
  // built successfully is never orphaned by a later failure.
  getElementRefs().set(id, element);
  nodes.set(id, node);

  // Media elements are leaves: their light-DOM children are unrendered
  // fallback content plus <track>/<source> metadata, none of which appear
  // in a real browser tree (Chromium's Video/Audio children are closed
  // UA-shadow controls we cannot reach). The captions signal from <track>
  // is hoisted onto the media node's `captions` property in buildNode.
  if (MEDIA_TAGS.has(node.dom!.tagName)) return id;

  // Walk children. Each child is isolated by buildNode's own boundary, so a
  // single pathological descendant can't take out its siblings or ancestors.
  // `flatChildren` leaves out what the browser doesn't render even though no
  // style on it says so: a light child no slot takes, a hidden slot's
  // assignment, and a closed <details>' body.
  for (const child of flatChildren(element)) {
    const childId = walk(child, id, depth + 1, nodes, extraction);
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

  const effectiveRoot = isPartial ? root : resolveEffectiveRoot(root);

  const startRoot = isPartial ? root : effectiveRoot;
  // Fresh cache per extraction — styles may have changed since the last
  // mutation-triggered run; never reuse across extractDomTree calls.
  // Any truthy value: a privacy switch that a `"1"` left off would fail open.
  const redactInput = Boolean(options.redactInput);
  // One `aria-owns` index for the whole walk (see aria-owner.ts).
  const rootId = withAriaOwnerIndex(() =>
    walk(startRoot, parentId, baseDepth, nodes, {
      styleCache: new WeakMap(),
      redactInput,
    }),
  );

  const includeFocused = options.includeFocused ?? !isPartial;
  const focusedId = includeFocused
    ? focusedNodeId(effectiveRoot, nodes)
    : undefined;
  return {
    nodes,
    rootId: rootId || "",
    ...(focusedId ? { focusedId } : {}),
    // Only a whole extraction vouches for its map: a partial one adds to nodes
    // someone else extracted, in whatever mode they used.
    source: treeSource("dom", { redactInput: redactInput && !isPartial }),
  };
}
