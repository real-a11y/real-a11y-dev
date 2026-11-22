// Name and description reads that sit around the accname walk in
// dom-extractor.ts: the embedded-control, reference, label and SVG-title
// alternatives, and the name/description entry points.
//
// This module and dom-extractor.ts import each other on purpose: the walk is
// mutually recursive. Every cross-import is a function declaration used at call
// time, so keep top-level evaluation in both files off the other one.

import { collapseAscii, trimAscii } from "../utils/ascii-whitespace.js";

import { readsSensitivePopup } from "./choice-withholding.js";
import {
  safeGetAttribute,
  safeGetElementById,
  safeNodeType,
  safeTagName,
} from "./clobber-safe.js";
import {
  computeAccessibleName,
  getAccessibleTextContent,
  textAlternative,
} from "./dom-extractor.js";
import {
  EMBEDDED_VALUE_ROLES,
  embeddedValue,
  lendsValueOnly,
} from "./field-text.js";
import { flatChildNodes, idScope } from "./flat-tree.js";
import * as host from "./host-names.js";
import { associatedLabels, wrappingLabelText } from "./label-text.js";
import {
  isImplicitDetailsGroup,
  NAME_BARRIER_ROLES,
  referenceWalk,
  type TextVisibility,
} from "./name-spacing.js";
import { scopeReferenceIndex } from "./reference-index.js";
import { getImplicitRole, type StyleCache } from "./role-map.js";
import { REDACTED_VALUE } from "./sensitivity.js";
import { warnSkippedElement } from "./skipped-element.js";
import {
  nameText,
  newNameRun,
  withhold,
  withholdsLentValue,
  type NameRun,
} from "./strict-mode.js";

/**
 * Compute the accessible description for an element.
 * Resolves aria-describedby IDs to text and falls back to aria-description.
 *
 * A description that read anything it may not show is dropped whole, with
 * no fallback to `aria-description` or `title`, as the native producer drops
 * one: see {@link NameRun.withheld}.
 */
export function computeAccessibleDescription(
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
        withheld ||=
          run.withheld || readsSensitivePopup(element, target, "describedby");
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
  // 3. title — see titleDescription.
  return host.titleDescription(safeGetAttribute(element, "title"), (source) =>
    computeAccessibleName(
      element,
      newNameRun(redactInput),
      styleCache,
      false,
      source,
    ),
  );
}

/** How a name-from-content walk was reached. */
export interface NameWalk extends TextVisibility {
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
export interface NameSource {
  /** The name is the element's own text, not an attribute or a reference. */
  fromContent?: boolean;
  /** The name is the `title` attribute, so it is not also the description. */
  fromTitle?: boolean;
}

/**
 * Where a name walk reads a control, for {@link embeddedControlText}: inside a
 * reference, its own aria-labelledby is ignored.
 */
export interface ControlRead extends NameWalk {
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
 * A sensitive field's value, the choice in its popup, and in strict mode any
 * value, is withheld ({@link withholdsLentValue}): the whole name reads
 * `[redacted]` (see {@link NameRun.withheld}), as the native producer reads a
 * name built around such a field. A name is markup, which neither withholds.
 */
export function embeddedControlText(
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
  return withholdsLentValue(element, role, run.redactInput)
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
export function barrierText(
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
export function referenceText(
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
  // Trimmed before the title is weighed: content that is only whitespace, or
  // an empty box's spacing, names nothing, so `<span title="Help"> </span>`
  // still lends "Help".
  return trimAscii(
    textAlternative(target, role, run, styleCache, walk) ||
      labelsText(target, tag, run, styleCache) ||
      host.inputValueName(target, tag) ||
      trimAscii(getAccessibleTextContent(target, run, styleCache, walk)) ||
      host.tooltipText(target, tag),
  );
}

/** The names of every element `element`'s aria-labelledby resolves to. */
export function labelledByText(
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
      if (!target) return "";
      if (readsSensitivePopup(element, target, "labelledby"))
        return withhold(run);
      return referenceText(target, run, styleCache);
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
export function svgTitle(
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
 * The name a node records: a run of its own, read as
 * {@link REDACTED_VALUE} whole when anything in it was withheld (see
 * {@link NameRun.withheld}).
 */
export function accessibleName(
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
export function labelsText(
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

/** A text node's text, as the default mode reads it into a name. */
export const textOf = (node: Node): string => node.textContent || "";

/** Get direct text content of an element, excluding child element text */
export function getDirectTextContent(
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
