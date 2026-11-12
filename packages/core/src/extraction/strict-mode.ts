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

import { ariaOwner } from "./aria-owner.js";
import {
  safeOwnerDocument,
  safeParentElement,
  safeTagName,
} from "./clobber-safe.js";
import { isEditable } from "./editing.js";
import { flatParentElement } from "./flat-tree.js";
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
   *   page's markup gave (`aria-label`, `alt`, `title`) is kept.
   * - A description that would carry it is dropped.
   * - A node inside an editor keeps no `href`, `src`, `poster` or `id` in its
   *   `dom.attributes`: a pasted link's URL, and an id some editors derive
   *   from a heading's text.
   * - No node carries the `dom` text previews (`textContent`,
   *   `descendantText`), which the native producer never fills either.
   *
   * An editor is a `contenteditable` region or a `designMode` document. Any
   * truthy value turns it on, so a privacy switch never fails open.
   *
   * The result of a whole extraction is stamped `source.redactInput: true`. A
   * partial one (`nodes`) is not: it adds to a map it did not build, so the
   * caller that built the map vouches for it. Default false: values are
   * announced as a screen reader announces them, a sensitive field's as
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

/**
 * True for an element strictly inside an editor: its parent holds typed text
 * ({@link holdsTypedText}). The editing host itself is the page's, as the
 * native producer counts it (`nodesInsideEditable` in the browser package).
 */
export function insideEditor(element: Element): boolean {
  const parent = safeParentElement(element);
  return parent !== null && holdsTypedText(parent);
}

/**
 * True for an option that a `<select>`, a combobox or a listbox holds. The
 * climb reads the tree the option's role was computed in: flat-tree parents,
 * so an option slotted into a web component's listbox, or one inside a
 * listbox host's shadow root, counts; then the `aria-owns` owners met on the
 * way. Either path reaching a choice field is enough, so a withheld selection
 * never depends on which of the two the role rules preferred.
 */
function inChoiceField(option: Element): boolean {
  const seen = new Set<Element>([option]);
  const pending: Element[] = [option];
  for (let start = pending.pop(); start; start = pending.pop()) {
    for (let el: Element | null = start; el; el = flatParentElement(el)) {
      const owner = ariaOwner(el);
      if (owner && !seen.has(owner)) {
        seen.add(owner);
        pending.push(owner);
      }
      if (el === option) continue;
      const role = getImplicitRole(el);
      if (role === "combobox" || role === "listbox") return true;
    }
  }
  return false;
}

/**
 * The attributes strict mode keeps out of `element`'s `dom.attributes`: what
 * was entered into a field (`value`, which `getKeyAttributes` reads from the
 * live `.value`; a range's `aria-valuenow`), and inside an editor what a user
 * supplied ({@link insideEditor}): the native producer's
 * `EDITABLE_CONTENT_ATTRIBUTES`. Asked before the attributes are read, so a
 * withheld value is never read at all.
 */
export function withheldAttributes(element: Element): ReadonlySet<string> {
  const withheld = new Set(["aria-valuenow"]);
  const tag = safeTagName(element);
  // An input's `type` property, the keyword the browser resolved: any value it
  // doesn't know, padded or not, is a text field.
  const type = tag === "input" ? (element as HTMLInputElement).type : null;
  if (holdsEnteredValue(tag, type)) withheld.add("value");
  if (insideEditor(element)) {
    for (const name of EDITOR_CONTENT_ATTRIBUTES) withheld.add(name);
  }
  return withheld;
}

const EDITOR_CONTENT_ATTRIBUTES = ["href", "src", "poster", "id"];

/**
 * True when strict mode keeps `state` off the node of `element`: an option's
 * `selected`, inside a choice field, since it says what the field's withheld
 * value is. The native producer drops the same option states. One rule for
 * {@link withholdStates} and the live extractor's check for states that
 * moved, which would otherwise see the missing state as a change.
 */
export function withholdsState(
  element: Element,
  role: string,
  state: string,
): boolean {
  return state === "selected" && role === "option" && inChoiceField(element);
}

/** `states` without what {@link withholdsState} keeps off `element`'s node. */
export function withholdStates(
  element: Element,
  role: string,
  states: SemanticNode["a11y"]["states"],
): SemanticNode["a11y"]["states"] {
  if ("selected" in states && withholdsState(element, role, "selected")) {
    const { selected: _withheld, ...rest } = states;
    return rest;
  }
  return states;
}
