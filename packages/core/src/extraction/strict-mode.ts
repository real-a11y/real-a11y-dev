/**
 * Strict mode (ADR-0001's `redactInput`) in the DOM producer: what it keeps out
 * of a name — through the run that carries one name or description
 * computation — and out of what a node records.
 *
 * Kept apart from the walk itself so the walk reads as accname, and so the
 * rule for what strict mode withholds sits in one place. The native producer
 * applies the same rule to Chromium's tree (`prepareRawNodes` in the browser
 * package), so the two strict trees print a node alike.
 */
import type { SemanticNode } from "../types.js";

import {
  safeOwnerDocument,
  safeParentElement,
  safeTagName,
} from "./clobber-safe.js";
import { isEditable } from "./editing.js";
import { getImplicitRole } from "./role-map.js";
import { holdsEnteredValue } from "./sensitivity.js";

/**
 * What a strict-mode extraction is asked for: the one option that
 * `extractDomTree`, `extractA11yTree` and `LiveTreeExtractor` share.
 */
export interface RedactInputOption {
  /**
   * Strict mode (ADR-0001): no field value and no rich-text editor content in
   * the tree. The same option, with the same meaning, as the native
   * producer's `nativeTree({ redactInput })`, so a tree and a tab sequence
   * withhold alike whichever producer built them.
   *
   * - No node carries `a11y.value`. No field's `dom.attributes` holds what was
   *   entered (`value`, a range's `aria-valuenow`; a button input's `value`,
   *   its label, stays), and no option in a choice field says it is selected.
   * - A name that would carry what a user typed — editor text, read into a
   *   heading, a button, a label or a reference — reads `[redacted]` whole. A
   *   node inside an editor named by its own content does too, and one named
   *   by its own text alone, such as a paragraph, reads unnamed. A name the
   *   page's markup gave (`aria-label`, `alt`) is kept.
   * - A description that would carry it is dropped.
   *
   * An editor is a `contenteditable` region or a `designMode` document. The
   * `dom` text previews (`textContent`, `descendantText`) are not covered: no
   * serializer prints them.
   *
   * The result is stamped `source.redactInput: true`. Default false: values
   * are announced as a screen reader announces them, a sensitive field's as
   * `[redacted]`.
   */
  redactInput?: boolean;
}

/**
 * One name or description computation, from start to finish: the elements it
 * has read (accname's visit-once rule), and whether it read anything it may
 * not show. A nested computation — a link read into a heading's name, an
 * image's alt, a reference target — shares its caller's run, so what one of
 * them withholds, the name being built withholds too.
 */
export interface NameRun {
  readonly visited: Set<Element>;
  /**
   * Strict mode ({@link RedactInputOption.redactInput}): nothing a user
   * entered reaches a name, not even a non-sensitive field's.
   */
  readonly redactInput: boolean;
  /**
   * Set when the computation met text it may not show. The read adds nothing,
   * and the whole name then reads `[redacted]` (`REDACTED_VALUE`) while a
   * description is dropped. That is what the native producer does
   * (`withholdRegionNames` in core's native/value-regions.ts), so the tree and
   * the tab sequence print one node the same way, whichever producer read it.
   * A name that kept the rest of its text would still say where the value sat.
   */
  withheld: boolean;
  /**
   * The last text parent {@link nameText} asked about, and its answer: a
   * name's text nodes mostly share one parent, so each is asked once rather
   * than climbing to the root per node.
   */
  typedParent?: Element;
  typedHere?: boolean;
}

export function newNameRun(redactInput: boolean): NameRun {
  return { visited: new Set(), redactInput, withheld: false };
}

/**
 * Text the run may not show: it marks the run withheld and lends nothing. See
 * {@link NameRun.withheld}.
 */
export function withhold(run: NameRun): string {
  run.withheld = true;
  return "";
}

/**
 * True when what `element` holds as text is what a user typed: it is editable
 * content (`isEditable`), or its document is in `designMode`, which makes the
 * whole document one editor and which `isEditable` leaves unmodelled.
 */
export function holdsTypedText(element: Element): boolean {
  if (isEditable(element)) return true;
  const doc = safeOwnerDocument(element);
  // Through the prototype where there is one: `<img name="designMode">` would
  // otherwise shadow it on the document.
  const getter = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "designMode",
  )?.get;
  const mode: unknown = getter ? getter.call(doc) : doc.designMode;
  return typeof mode === "string" && mode.toLowerCase() === "on";
}

/**
 * What a text node lends a name. In strict mode, text a user typed is withheld
 * (see {@link holdsTypedText}), as the native producer withholds an editor's
 * content (`redactEditableContent`). Whitespace alone is nothing typed: an
 * empty editor, like an empty field, has nothing to give.
 */
export function nameText(node: Node, run: NameRun): string {
  const text = node.textContent || "";
  if (!run.redactInput || !text.trim()) return text;
  // Editing stops at a shadow root, as `isEditable` does: a text node with no
  // parent element sits straight in one.
  const parent = safeParentElement(node);
  if (!parent) return text;
  if (parent !== run.typedParent) {
    run.typedParent = parent;
    run.typedHere = holdsTypedText(parent);
  }
  return run.typedHere ? withhold(run) : text;
}

/** True for an option that a `<select>`, a combobox or a listbox holds. */
function inChoiceField(option: Element): boolean {
  for (
    let el = safeParentElement(option);
    el !== null;
    el = safeParentElement(el)
  ) {
    const role = getImplicitRole(el);
    if (role === "combobox" || role === "listbox") return true;
  }
  return false;
}

/**
 * True when strict mode keeps `state` off the node of `element`: an option's
 * `selected`, inside a choice field, since it says what the field's withheld
 * value is. The native producer drops the same option states. One rule for
 * {@link withholdEntered} and the live extractor's check for states that
 * moved, which would otherwise see the missing state as a change.
 */
export function withholdsState(
  element: Element,
  role: string,
  state: string,
): boolean {
  return state === "selected" && role === "option" && inChoiceField(element);
}

/**
 * Strict mode for what a node records beyond its name: no announced value,
 * no entered value in its attributes (a range's position included), and no
 * option in a choice field marked selected, since that says what the field's
 * withheld value is. The native producer drops the same option states.
 */
export function withholdEntered(
  element: Element,
  role: string,
  node: SemanticNode,
): void {
  delete node.a11y.value;
  const attributes = node.dom?.attributes ?? {};
  const tag = safeTagName(element);
  // An input's `type` property, the keyword the browser resolved: any value it
  // doesn't know, padded or not, is a text field.
  const type = tag === "input" ? (element as HTMLInputElement).type : null;
  if (holdsEnteredValue(tag, type)) delete attributes["value"];
  delete attributes["aria-valuenow"];
  if (withholdsState(element, role, "selected"))
    delete node.a11y.states["selected"];
}
