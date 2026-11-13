/**
 * The text a node holds, read the way the DOM producer reads it outside a
 * name: the capped `descendantText` preview, and the value a field announces
 * (ADR-0001), sensitivity included. Kept apart from the name walk in
 * dom-extractor.ts, which asks it for a field's value.
 */
import { isAriaHiddenValue } from "./aria-tokens.js";
import {
  safeGetAttribute,
  safeNodeType,
  safeParentElement,
  safeTagName,
  safeTextContent,
} from "./clobber-safe.js";
import { isEditable, isEditingHost } from "./editing.js";
import { flatChildNodes } from "./flat-tree.js";
import { isTextVisible } from "./name-spacing.js";
import {
  getCachedComputedStyle,
  getExplicitRole,
  isSubtreeHidden,
  type StyleCache,
} from "./role-map.js";
import {
  isSensitiveField,
  REDACTED_VALUE,
  VALUELESS_INPUT_TYPES,
} from "./sensitivity.js";
import { warnSkippedElement } from "./skipped-element.js";

/** Elements whose children are fallback content, never what they show. */
export const MEDIA_TAGS: ReadonlySet<string> = new Set(["video", "audio"]);

/** Hard cap so we don't store huge text blobs on every node. */
const DESCENDANT_TEXT_MAX = 240;

type CollapsedTextState = {
  /** Collapsed text accumulated so far. */
  text: string;
  /** Whitespace-collapse phase for the next character. */
  phase: "start" | "text" | "space";
};

/**
 * Append one text chunk into `state`, collapsing whitespace the way
 * `textContent` + `/\s+/g` would. Returns true when the preview cap is
 * reached and more input remains (caller should stop the walk).
 */
function appendCollapsedTextChunk(
  state: CollapsedTextState,
  raw: string,
): boolean {
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (/\s/.test(ch)) {
      if (state.phase === "text") {
        // At cap, trailing whitespace is discarded by the final trim — keep
        // scanning without treating it as "more content".
        if (state.text.length >= DESCENDANT_TEXT_MAX) continue;
        state.text += " ";
        state.phase = "space";
      }
      continue;
    }

    // Non-whitespace beyond the cap means genuinely more visible content.
    if (state.text.length >= DESCENDANT_TEXT_MAX) return true;

    state.text += ch;
    state.phase = "text";
  }
  return false;
}

/**
 * Depth-first walk that collects descendant text with whitespace collapsed,
 * skipping `<video>`/`<audio>` subtrees (unrendered fallback + metadata).
 * Stops once enough characters for the capped preview are accumulated.
 * Clobber-immune throughout (flatChildNodes / safeTextContent).
 */
function collectDescendantTextBounded(
  node: Node,
  state: CollapsedTextState,
  moreNodesAfter: () => boolean,
): boolean {
  const type = safeNodeType(node);
  if (type === Node.TEXT_NODE) {
    return appendCollapsedTextChunk(state, safeTextContent(node));
  }
  if (type !== Node.ELEMENT_NODE) return false;
  const tag = safeTagName(node as Element);
  if (MEDIA_TAGS.has(tag)) return false;

  const children = flatChildNodes(node);
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const moreAfter = () =>
      i < children.length - 1 ||
      (moreNodesAfter() && i === children.length - 1);
    if (collectDescendantTextBounded(child, state, moreAfter)) return true;
  }
  return false;
}

/**
 * Recursive text content with whitespace collapsed and a hard length cap.
 * Used as a panel preview for elements whose accessible name is empty per
 * spec but which carry meaningful descendant text (`<code>`, `<pre>`,
 * `<svg>` with `<text>`, decorative wrappers around copy, etc.).
 *
 * Uses a bounded walk (O(min(subtree text, cap))) instead of materializing
 * the full subtree via `textContent`, which is O(subtree) per node.
 */
export function getDescendantText(element: Element): string {
  const state: CollapsedTextState = { text: "", phase: "start" };
  const children = flatChildNodes(element);
  let truncated = false;

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const moreAfter = () => i < children.length - 1;
    if (collectDescendantTextBounded(child, state, moreAfter)) {
      truncated = true;
      break;
    }
  }

  return finishCollapsedText(state, truncated);
}

/** Trim a collapsed-text walk's result and apply the cap's `…`. */
function finishCollapsedText(
  state: CollapsedTextState,
  truncated: boolean,
): string {
  if (state.phase === "space" && state.text.endsWith(" ")) {
    state.text = state.text.slice(0, -1);
  }

  if (!truncated && state.text.length <= DESCENDANT_TEXT_MAX) {
    return state.text;
  }
  return state.text.slice(0, DESCENDANT_TEXT_MAX - 1) + "…";
}

/**
 * Elements that break a line when rendered. A field's text reads a space
 * across them, the way `innerText` — and Chromium's AX value — does, so an
 * editor's `<p>one</p><p>two</p>` reads "one two", not "onetwo".
 */
const LINE_BREAKING_TAGS: ReadonlySet<string> = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

/**
 * Roles of a widget's own popup or companion. A select-only combobox that
 * renders its listbox inside itself holds "Apple" — not "Apple Apple Pear".
 */
const POPUP_ROLES: ReadonlySet<string> = new Set([
  "listbox",
  "option",
  "menu",
  "menuitem",
  "grid",
  "tree",
  "dialog",
  "tooltip",
]);

/**
 * Form controls whose child text is NOT what they show: a `<select>`'s every
 * option (only the chosen one is displayed, and it is the select's own
 * value), a `<textarea>`'s default value, a `<datalist>`'s suggestions. A
 * field's text walk skips them; the control carries its own `a11y.value`.
 * Chromium's rendered text of an editor lists a nested `<select>`'s every
 * option — a knowing divergence, since only the chosen one is on screen.
 */
const CONTROL_TEXT_TAGS: ReadonlySet<string> = new Set([
  "select",
  "textarea",
  "datalist",
]);

/**
 * True if a walk for the text an element renders reads none of a `tag`'s
 * children: a `<video>`'s or `<audio>`'s are fallback content, and a form
 * control's ({@link CONTROL_TEXT_TAGS}) are not what it shows — a
 * `<textarea>`'s are its markup default, for a sensitive field (ADR-0001) the
 * secret itself. Exported so the extension's own text reads skip exactly what
 * a field's value does.
 */
export function ignoresChildText(tag: string): boolean {
  return MEDIA_TAGS.has(tag) || CONTROL_TEXT_TAGS.has(tag);
}

/**
 * The text a non-native field holds — a contenteditable editor, an ARIA
 * textbox or combobox — collapsed and capped like {@link getDescendantText},
 * but with block boundaries read as spaces. What isn't rendered is always
 * skipped: `display:none` and `hidden` subtrees, `visibility:hidden` text,
 * and a closed `<details>`'s body.
 *
 * Chromium reads the rest two ways, and so does this (measured on Chromium
 * 151 over CDP). An editor's value, and any ARIA textbox's or searchbox's,
 * is the text it renders (`rendered`), which knows nothing of ARIA:
 * `aria-hidden` text and a popup inside it are part of the value. A
 * combobox you can't type into is read as the accessible text of what it
 * contains, which skips `aria-hidden` subtrees and the widget's own popup.
 */
function getFieldText(
  element: Element,
  rendered: boolean,
  styleCache?: StyleCache,
): string {
  const state: CollapsedTextState = { text: "", phase: "start" };
  const walk = (node: Node, textVisible: boolean): boolean => {
    const type = safeNodeType(node);
    if (type === Node.TEXT_NODE) {
      return textVisible
        ? appendCollapsedTextChunk(state, safeTextContent(node))
        : false;
    }
    if (type !== Node.ELEMENT_NODE) return false;
    const el = node as Element;
    const tag = safeTagName(el);
    if (ignoresChildText(tag)) return false;
    // An unreadable element costs its own text, not the field's value (see
    // getAccessibleTextContent). Nothing is appended before these reads, so
    // skipping it leaves the text so far intact.
    let style: CSSStyleDeclaration | null;
    try {
      if (!rendered) {
        if (isAriaHiddenValue(safeGetAttribute(el, "aria-hidden")))
          return false;
        const role = getExplicitRole(el);
        if (role && POPUP_ROLES.has(role)) return false;
      }
      style = getCachedComputedStyle(el, styleCache);
      if (isSubtreeHidden(el, style)) return false;
    } catch (error) {
      warnSkippedElement(el, error);
      return false;
    }
    const breaks = LINE_BREAKING_TAGS.has(tag);
    // Whitespace never trips the cap, so these two appends can't end the walk.
    if (breaks) appendCollapsedTextChunk(state, " ");
    // flatChildNodes gives a closed <details> only its <summary>.
    for (const child of flatChildNodes(el)) {
      if (walk(child, isTextVisible(style))) return true;
    }
    if (breaks) appendCollapsedTextChunk(state, " ");
    return false;
  };
  let truncated = false;
  const ownVisible = isTextVisible(getCachedComputedStyle(element, styleCache));
  for (const child of flatChildNodes(element)) {
    if (walk(child, ownVisible)) {
      truncated = true;
      break;
    }
  }
  return finishCollapsedText(state, truncated);
}

/**
 * Roles announced by position in a range: `aria-valuetext`, else `valuenow`.
 * Exported with {@link STATE_ONLY_ROLES} and {@link finishAnnouncedValue} so
 * the native producer applies the same rules to Chromium's value — one table,
 * or the two producers drift apart.
 */
export const RANGE_VALUE_ROLES: ReadonlySet<string> = new Set([
  "slider",
  "spinbutton",
  "progressbar",
  "meter",
  "scrollbar",
]);

/** Roles whose checked/pressed STATE is what's announced — never a value. */
export const STATE_ONLY_ROLES: ReadonlySet<string> = new Set([
  "checkbox",
  "radio",
  "switch",
  "menuitemcheckbox",
  "menuitemradio",
]);

/** Non-native roles whose value is the text they hold. */
const TEXT_VALUE_ROLES: ReadonlySet<string> = new Set([
  "textbox",
  "searchbox",
  "combobox",
]);

/** The cap an announced value is cut to, with `…` — the same as text previews. */
const VALUE_MAX = DESCENDANT_TEXT_MAX;

/** A `<select>`'s selected options by label — what a screen reader says. */
function selectedLabels(select: HTMLSelectElement): string {
  return Array.from(select.options)
    .filter((option) => option.selected)
    .map((option) => option.label || option.text)
    .join(", ");
}

/** True when `element` wraps a text-entry control that holds the value
 *  itself. Hidden, checkbox, radio, button and file inputs don't. */
function wrapsTextControl(element: Element): boolean {
  return Array.from(element.querySelectorAll("input, select, textarea")).some(
    (control) => {
      // Tag-checked, not `instanceof`, which fails across realms.
      if (safeTagName(control) !== "input") return true;
      const type = (control as HTMLInputElement).type;
      return !VALUELESS_INPUT_TYPES.has(type) && type !== "file";
    },
  );
}

/**
 * True when `element` sits inside editable content (itself excluded), by the
 * same rule as {@link isEditingHost}: a `contenteditable="false"` island ends
 * the region, so an editor reopened inside one is a field of its own.
 */
function insideEditable(element: Element): boolean {
  const parent = safeParentElement(element);
  return !!parent && isEditable(parent);
}

/**
 * The outermost field whose `a11y.value` is computed from `el`'s content — a
 * `<select>` (its options' labels), an editing host, or a non-native ARIA
 * textbox/searchbox/combobox (their text) — or null. A mutation anywhere
 * inside one changes that field's value without touching the field itself,
 * so a live refresh must re-extract it (see `LiveTreeExtractor.refresh`).
 * Outermost, because a textbox nested in an editor has no value of its own:
 * the editor's does.
 */
export function fieldValueOwner(el: Element): Element | null {
  let owner: Element | null = null;
  // Clobber-safe: through a `<form>` whose control is named `parentElement`,
  // the plain read cycles between the form and that control forever.
  for (let node: Element | null = el; node; node = safeParentElement(node)) {
    const tag = safeTagName(node);
    if (tag === "select" || isEditingHost(node)) {
      owner = node;
      continue;
    }
    if (tag === "input" || tag === "textarea") continue;
    const role = getExplicitRole(node);
    if (role && TEXT_VALUE_ROLES.has(role)) owner = node;
  }
  return owner;
}

/** The raw text a field holds, before sensitivity, collapse and cap. */
function readFieldValue(
  element: Element,
  role: string,
  styleCache?: StyleCache,
): string | undefined {
  const tag = safeTagName(element);
  if (STATE_ONLY_ROLES.has(role)) return undefined;

  if (RANGE_VALUE_ROLES.has(role)) {
    const valuetext = safeGetAttribute(element, "aria-valuetext");
    if (valuetext?.trim()) return valuetext;
    const valuenow = safeGetAttribute(element, "aria-valuenow");
    if (valuenow?.trim()) return valuenow;
    if (tag === "input") return (element as HTMLInputElement).value;
    // An indeterminate <progress> (no value attribute) announces no value.
    if (
      (tag === "progress" || tag === "meter") &&
      element.hasAttribute("value")
    ) {
      return String((element as HTMLProgressElement).value);
    }
    return undefined;
  }

  if (tag === "input") {
    const input = element as HTMLInputElement;
    if (VALUELESS_INPUT_TYPES.has(input.type)) return undefined;
    if (input.type === "file") {
      return Array.from(input.files ?? [])
        .map((file) => file.name)
        .join(", ");
    }
    return input.value;
  }
  if (tag === "textarea") return (element as HTMLTextAreaElement).value;
  if (tag === "select") return selectedLabels(element as HTMLSelectElement);

  // A non-native field: an editor, or an ARIA textbox/combobox built on a div.
  // A textbox nested INSIDE an editor is part of that editor's content, which
  // its host already announces — a second value would count the text twice.
  // An ARIA textbox/combobox that wraps a text-entry control (the ARIA 1.0
  // combobox around an <input>) leaves the value to that control — its own
  // text would be every option. An editor never does: a task list's
  // checkboxes are part of the document, and its text walk can't see a
  // control's value anyway.
  const editingHost = isEditingHost(element);
  if (TEXT_VALUE_ROLES.has(role) || editingHost) {
    if (insideEditable(element)) return undefined;
    if (!editingHost && wrapsTextControl(element)) return undefined;
    return getFieldText(
      element,
      editingHost || role !== "combobox",
      styleCache,
    );
  }
  return undefined;
}

/**
 * The value a screen reader announces for a field (ADR-0001): a text field's
 * text, a `<select>`'s selected option LABEL (not its `value` attribute), a
 * range widget's `aria-valuetext` else `valuenow`, a file input's file names,
 * an editor's or ARIA textbox's text. A checkbox, radio or button has none —
 * its state or name says it. Whitespace collapses and the value is capped at
 * {@link VALUE_MAX} characters with `…`. Empty reads as no value.
 *
 * A {@link isSensitiveField sensitive} field that holds anything reads
 * {@link REDACTED_VALUE}: an agent can tell "password entered" from "empty",
 * never what it is or how long.
 *
 * Never throws: a hostile page can make a getter throw, and the caller builds
 * the node inside one try — a value must not cost the page a node.
 */
export function getAnnouncedValue(
  element: Element,
  role: string,
  styleCache?: StyleCache,
): string | undefined {
  try {
    return finishAnnouncedValue(readFieldValue(element, role, styleCache), () =>
      isSensitiveField(element),
    );
  } catch {
    return undefined;
  }
}

/**
 * The shared tail of every announced value, whichever producer read it:
 * collapse whitespace, read empty as no value, substitute
 * {@link REDACTED_VALUE} for a sensitive field (asked lazily, only when there
 * is something to withhold), and cap at {@link VALUE_MAX} characters with `…`.
 */
export function finishAnnouncedValue(
  raw: string | undefined,
  isSensitive: () => boolean,
): string | undefined {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  if (isSensitive()) return REDACTED_VALUE;
  return collapsed.length > VALUE_MAX
    ? collapsed.slice(0, VALUE_MAX - 1) + "…"
    : collapsed;
}
