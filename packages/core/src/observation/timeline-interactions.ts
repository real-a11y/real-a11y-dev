// The timeline's interactions (ADR-0002): what the page received from the
// user, a click, a key that types no text, or typing into a field, as
// events. Never a character (ADR-0001): no key that types one, nothing from
// `input` or `beforeinput` data, no clipboard content. Kept apart from the
// recorder, which places these among the block's changes as it places focus.

import { buildA11yTree } from "../extraction/a11y-extractor.js";
import {
  safeDocumentElement,
  safeNodeType,
  safeOwnerDocument,
  safeParentElement,
  safeTagName,
} from "../extraction/clobber-safe.js";
import { extractDomTree, getElementRefs } from "../extraction/dom-extractor.js";
import { renderingParent } from "../extraction/flat-tree.js";
import { isFocusable } from "../extraction/focusability.js";
import { NAMED_WIDGET_ROLES } from "../extraction/name-spacing.js";
import { getImplicitRole } from "../extraction/role-map.js";
import { isSensitiveField } from "../extraction/sensitivity.js";
import { holdsTypedText } from "../extraction/strict-mode.js";
import { asStop } from "../query/tab-sequence.js";
import type { A11yInfo, ExtractionResult, SemanticNode } from "../types.js";

import {
  type TimelineEvent,
  type TimelineInteractionEvent,
  type TimelineModifier,
  type TimelinePressEvent,
  unreached,
} from "./timeline-events.js";
import { hiddenAbove } from "./timeline-regions.js";

/** The events an interaction is read from, each listened to on the
 *  document in the capture phase, so the page's own listeners can't hide it. */
export const INTERACTION_TYPES = ["click", "keydown", "input"] as const;

/** A node as a line names it: its a11y facet without its value, and whether
 *  assistive tech can reach it. */
export interface Named {
  stop: Omit<A11yInfo, "value">;
  hidden: boolean;
}

/** An interaction, and the element it names, if any: typing into one field
 *  is one event however many `input` events it takes. */
export interface Act {
  event: TimelineInteractionEvent;
  el: Element | null;
}

/** An interaction as the recorder notes it: before record `k` of its
 *  block, with `n` focus moves noted there before it. */
export interface NotedAct extends Act {
  k: number;
  n: number;
}

/** Where a block's focus line goes, and how many of its moves had been
 *  noted when focus came to rest on what it names. */
export interface FocusLine {
  at: number;
  moves: number;
}

/**
 * Where in its block `act` goes, given where each of the block's focus moves
 * was noted (`moves`) and its focus line, if any: a quarter after `2k` when
 * a move noted there came before it, as a click's follows the
 * `pointerdown`'s move, and a quarter before otherwise, as a Tab's `keydown`
 * comes before the move it makes. Before the line, when the move focus came
 * to rest with was noted after it, though another move there came first.
 */
export function placeAct(
  act: NotedAct,
  moves: readonly number[],
  line: FocusLine | null,
): number {
  const at = 2 * act.k;
  const after =
    act.n > 0 &&
    moves[act.n - 1] === act.k &&
    (line?.at !== at || act.n >= line.moves);
  return at + (after ? 0.25 : -0.25);
}

/** Is the node `id`, and everything above it, exposed to assistive tech? */
function exposed(tree: ExtractionResult, id: string): boolean {
  for (let n = tree.nodes.get(id); n;) {
    if (!n.a11y.isExposedToAT) return false;
    n = n.parentId === null ? undefined : tree.nodes.get(n.parentId);
  }
  return true;
}

/**
 * `element`, which the root holds, as the tab order singles it out. One the
 * a11y view folds away (a `<div tabindex="-1">` with no name) falls back to
 * the DOM view's node. With `climb`, it names what a click on `element`
 * activates instead ({@link activated}), so a click on a button's icon names
 * the button. One
 * assistive tech can't reach is `hidden`, since a screen reader meets
 * nothing there: inside `aria-hidden`, `inert` or hidden content, above the
 * root as well as in it, or somewhere the tree doesn't walk at all (jsdom
 * lets a `hidden` element take focus).
 */
export function nodeStop(
  root: Element,
  element: Element,
  { climb = false, strict = false } = {},
): Named {
  // Partial, so the root is read as it is: never widened to a portaled
  // overlay or narrowed to a modal, which would make what counts as inside
  // it hang on the rest of the page.
  const dom = extractDomTree(root, {
    nodes: new Map(),
    includeFocused: false,
    redactInput: strict,
  });
  const refs = getElementRefs();
  const id = refs.findId(element);
  const node = id ? dom.nodes.get(id) : undefined;
  if (!id || !node) {
    return { stop: unreached(getImplicitRole(element)), hidden: true };
  }
  const kept = buildA11yTree(
    dom.nodes,
    dom.rootId,
    undefined,
    dom.source,
  ).nodes;
  const target = climb ? activated(root, element, kept) : element;
  const climbed = target && refs.findId(target);
  const targetId = climbed && dom.nodes.has(climbed) ? climbed : id;
  const named = kept.get(targetId) ?? dom.nodes.get(targetId) ?? node;
  // Singling a node out says what it is, so a sensitive field's choice is
  // withheld here as the tab order withholds it (ADR-0001). The line never
  // prints a value, and an event carries none either.
  const { value: _value, ...stop } = asStop(named).a11y;
  // What is named decides: a click on a button's `aria-hidden` icon is a
  // click on the button.
  const reachable =
    (kept.has(targetId) || exposed(dom, targetId)) && !hiddenAbove(root);
  return { stop, hidden: !reachable };
}

/** Roles a click activates, though the element can't take focus, beside
 *  {@link NAMED_WIDGET_ROLES}. Not spread into one set: a spread at module
 *  scope can't be tree-shaken, and would ride into every bundle of core. */
const CLICKED_ITEM_ROLES: ReadonlySet<string> = new Set([
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "treeitem",
]);

/**
 * What a click on `element` activates: the nearest element from it up, in
 * the root, that can take focus or has a role a click activates, such as the
 * button around an icon. Null when none does: the click names its target.
 */
function activated(
  root: Element,
  element: Element,
  kept: Map<string, SemanticNode>,
): Element | null {
  const refs = getElementRefs();
  for (let el: Element | null = element; el;) {
    const id = refs.findId(el);
    const role = id ? kept.get(id)?.a11y.role : undefined;
    const clicked =
      role && (NAMED_WIDGET_ROLES.has(role) || CLICKED_ITEM_ROLES.has(role));
    if (isFocusable(el) || clicked) return el;
    el = el === root ? null : renderingParent(el);
  }
  return null;
}

/** The element an event was aimed at, inside open shadow roots, or null when
 *  it was the document or the window. */
function targetOf(event: Event): Element | null {
  const first = event.composedPath()[0] ?? event.target;
  if (!first || typeof (first as Node).nodeType !== "number") return null;
  const node = first as Node;
  return safeNodeType(node) === Node.ELEMENT_NODE
    ? (node as Element)
    : safeParentElement(node);
}

/** `<input>` types that hold no typed text. */
const UNTYPED_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Does what a user types into `element` become text it holds: a text field,
 *  a `<textarea>`, or an editor? */
export function typesText(element: Element): boolean {
  const tag = safeTagName(element);
  if (tag === "textarea") return true;
  if (tag === "input") {
    // The property, as `isSensitiveField` reads it: an unknown type is text.
    return !UNTYPED_INPUTS.has((element as HTMLInputElement).type);
  }
  return holdsTypedText(element);
}

/** Does `Enter` in `element` type a line break: a `<textarea>` or an
 *  editor, but not a one-line field, where it submits? */
function breaksLines(element: Element): boolean {
  return safeTagName(element) === "textarea" || holdsTypedText(element);
}

/**
 * Keys that type nothing and name themselves. A list, not a pattern such as
 * "longer than one character": a synthetic `keydown` can carry any string as
 * its key, and a word a test typed must not pass for a key's name.
 */
const NAMED_KEY =
  /^(?:Enter|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ContextMenu|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1\d|2[0-4]))$/;

const MODIFIERS: readonly [TimelineModifier, keyof KeyboardEvent][] = [
  ["Ctrl", "ctrlKey"],
  ["Alt", "altKey"],
  ["Shift", "shiftKey"],
  ["Meta", "metaKey"],
];

/** Is a character key held as a shortcut, so it types nothing? `AltGr`
 *  reports `Ctrl` and `Alt` together, and types a character. */
function shortcut(event: KeyboardEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  return !event.altKey && !event.getModifierState?.("AltGraph");
}

/**
 * A press event for a `keydown`, or null for a key that types, or could
 * type, a character: one with no `Ctrl` or `Meta`, a `Space` in a field,
 * an `Enter` in a `<textarea>` or an editor, a key composing text through an IME, a modifier on its own, or a key the
 * recorder doesn't name ({@link NAMED_KEY}).
 */
export function pressOf(
  event: KeyboardEvent,
  target: Element | null,
): TimelinePressEvent | null {
  const key = event.key;
  if (event.isComposing || typeof key !== "string") return null;
  let name: string | null = null;
  if (NAMED_KEY.test(key)) {
    if (key !== "Enter" || shortcut(event) || !target || !breaksLines(target))
      name = key;
  } else if (key === " ") {
    if (shortcut(event) || !target || !typesText(target)) name = "Space";
  } else if ([...key].length === 1 && shortcut(event)) {
    name = key.toUpperCase();
  }
  if (name === null) return null;
  const modifiers = MODIFIERS.filter(([, flag]) => event[flag] === true).map(
    ([modifier]) => modifier,
  );
  return { kind: "press", key: name, modifiers };
}

/** How a click names what it activates: the user's own typing never names
 *  it, since a click line is one step from a type line. */
const STRICT_CLIMB = { climb: true, strict: true } as const;

/** A sensitive field's stop with no more than its role and name. */
function roleAndName(stop: Omit<A11yInfo, "value">): Omit<A11yInfo, "value"> {
  return { ...stop, description: "", states: {}, properties: {} };
}

/**
 * The interaction `event` is, aimed at something `inRoot` holds, or null.
 * A press with focus resting nowhere (on `<body>`) counts, as a `(none)`
 * focus line does. `typing` is the last field typed into and how it was
 * named, reused while the same field takes more text.
 */
export function interactionOf(
  event: Event,
  root: Element,
  inRoot: (element: Element) => boolean,
  typing: Act | null,
): Act | null {
  const target = targetOf(event);
  if (event.type === "keydown") {
    const doc = safeOwnerDocument(root);
    const nowhere =
      !target ||
      safeTagName(target) === "body" ||
      target === safeDocumentElement(doc);
    if (!nowhere && !inRoot(target)) return null;
    const press = pressOf(event as KeyboardEvent, target);
    return press && { event: press, el: null };
  }
  if (!target || !inRoot(target)) return null;
  if (event.type === "click") {
    const { stop, hidden } = nodeStop(root, target, STRICT_CLIMB);
    return { event: { kind: "click", target: stop, hidden }, el: target };
  }
  if (event.type !== "input" || !typesText(target)) return null;
  if (typing?.el === target) return typing;
  const { stop, hidden } = nodeStop(root, target, { strict: true });
  const named = isSensitiveField(target) ? roleAndName(stop) : stop;
  return { event: { kind: "type", target: named, hidden }, el: target };
}

/**
 * Typing into one field as one type event, however many `input` events it
 * took: a type event for the field the last event handed over typed into,
 * with nothing between, adds nothing, in its block or a later one.
 */
export class TypingRun {
  /** The field the last event handed over typed into. */
  private field: Element | null = null;
  /** The last type interaction recorded, reused while its field takes more
   *  text, so a keystroke reads no tree ({@link interactionOf}). */
  last: Act | null = null;

  /** Is `event`, naming `el`, handed over? Called for each, in order. */
  keeps(event: TimelineEvent, el: Element | null | undefined): boolean {
    if (event.kind !== "type") {
      this.field = null;
      return true;
    }
    if (el === this.field) return false;
    this.field = el ?? null;
    return true;
  }

  /** Once a block's events are out: a field typed into, then left for
   *  something else, is named afresh. */
  settled(): void {
    if (this.last?.el !== this.field) this.last = null;
  }
}
