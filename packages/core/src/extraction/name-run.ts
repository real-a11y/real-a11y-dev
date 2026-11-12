/**
 * Strict mode in the name walk (ADR-0001's `redactInput`), and the run that
 * carries it: one name or description computation, which knows what it has
 * read and whether any of it may not be shown.
 *
 * Kept apart from the walk itself so the walk reads as accname, and so the
 * rule for what strict mode withholds sits in one place.
 */
import { safeParentElement } from "./clobber-safe.js";
import { isEditable } from "./editing.js";

/**
 * What a strict-mode extraction is asked for: the one option that
 * {@link extractDomTree}, `extractA11yTree` and `LiveTreeExtractor` share.
 */
export interface RedactInputOption {
  /**
   * Strict mode (ADR-0001): no field value and no rich-text editor content in
   * the tree. The same option, with the same meaning, as the native
   * producer's `nativeTree({ redactInput })`, so a tree and a tab sequence
   * withhold alike whichever producer built them.
   *
   * - No node carries `a11y.value`, and no field's `dom.attributes.value`
   *   holds what was entered (a button input's `value`, its label, stays).
   * - A name that would carry what a user typed — editor text, read into a
   *   heading, a button, a label or a reference — reads `[redacted]` whole. So
   *   does a node inside an editor that is named by its own content. A name the
   *   page's markup gave (`aria-label`, `alt`) is kept.
   * - A description that would carry it is dropped.
   *
   * The `dom` text previews (`textContent`, `descendantText`) are not
   * covered: no serializer prints them.
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
   * and the whole name then reads `[redacted]` (`REDACTED_VALUE`) while a description
   * is dropped. That is what the native producer does (`withholdRegionNames`
   * in core's native/value-regions.ts), so the tree and the tab sequence print
   * one node the same way, whichever producer read it. A name that kept the
   * rest of its text would still say where the value sat.
   */
  withheld: boolean;
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
 * What a text node lends a name. In strict mode, text inside an editable
 * region is what a user typed, so it is withheld, as the native producer
 * withholds an editor's content (`redactEditableContent`). Whitespace alone is
 * nothing typed: an empty editor, like an empty field, has nothing to give.
 */
export function nameText(node: Node, run: NameRun): string {
  const text = node.textContent || "";
  if (!run.redactInput || !text.trim()) return text;
  // Editing stops at a shadow root, as `isEditable` does: a text node with no
  // parent element sits straight in one.
  const parent = safeParentElement(node);
  return parent && isEditable(parent) ? withhold(run) : text;
}
