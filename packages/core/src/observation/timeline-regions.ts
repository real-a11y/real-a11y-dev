// How the timeline recorder reads live regions: which element is one, how it
// announces, and the text it says or holds. Kept apart from the recorder,
// which decides when and in what order those reads become events.

import { isAriaHiddenValue } from "../extraction/aria-tokens.js";
import {
  safeAssignedSlot,
  safeContains,
  safeGetAttribute,
  safeNodeType,
  safeParentElement,
  safeParentNode,
} from "../extraction/clobber-safe.js";
import {
  isRenderedInFlatTree,
  renderingParent,
} from "../extraction/flat-tree.js";
import { liveRegionLevel } from "../extraction/overlay-scope.js";
import { pageText } from "../extraction/page-text.js";
import { getImplicitRole, isSubtreeHidden } from "../extraction/role-map.js";

/** Is `element` inside `node`, across shadow roots and slots? */
export function holds(node: Node, element: Element): boolean {
  if (safeContains(node, element)) return true;
  for (let el: Element | null = element; el; el = renderingParent(el)) {
    if (el === node) return true;
  }
  return false;
}

/**
 * How a live region announces: politely, or interrupting.
 *
 * @internal Exported as `LiveLevel`, for the timeline's events. Not a
 * stability promise.
 */
export type Level = "polite" | "assertive";

/** The politeness each live role implies. */
const ROLE_LEVELS: ReadonlyMap<string, Level> = new Map([
  ["alert", "assertive"],
  ["status", "polite"],
  ["log", "polite"],
]);

/**
 * The politeness `role` implies, or undefined for a role that implies none:
 * a region whose `aria-live` sets another is printed with `{live=…}`.
 *
 * @internal For `serialize`'s timeline lines. Not a stability promise.
 */
export function impliedLiveLevel(role: string): Level | undefined {
  return ROLE_LEVELS.get(role);
}

/**
 * How `el` announces: a politeness, `"off"` when its `aria-live` switches
 * announcing off for everything inside it, or null when it is no region.
 * Core's rule, which reads authored roles only (its overlay pivot keys on
 * them), plus `<output>`: a `status` by its tag, which Chromium announces.
 */
export function regionLevel(el: Element): Level | "off" | null {
  const live = safeGetAttribute(el, "aria-live")?.trim().toLowerCase();
  if (live === "off") return "off";
  const level = liveRegionLevel(el);
  if (level) return level;
  return el.localName === "output" && getImplicitRole(el) === "status"
    ? "polite"
    : null;
}

/**
 * Does something above `element` hide it from assistive tech? With
 * `unrendered`, only something that keeps it from rendering at all: a
 * `hidden` or `display: none` ancestor, a closed `<details>`, no slot for it.
 * Otherwise `aria-hidden` and `inert` content as well.
 */
export function hiddenAbove(element: Element, unrendered = false): boolean {
  if (!isRenderedInFlatTree(element)) return true;
  for (let el = renderingParent(element); el; el = renderingParent(el)) {
    if (!unrendered && isAriaHiddenValue(safeGetAttribute(el, "aria-hidden"))) {
      return true;
    }
    // `inert` only hides from assistive tech, though core's rule counts it.
    if (unrendered && safeGetAttribute(el, "inert") !== null) continue;
    if (isSubtreeHidden(el, getComputedStyle(el))) return true;
  }
  return false;
}

/** Is `region`'s level one that announces? */
export function isLive(level: Level | "off" | null): level is Level {
  return level !== null && level !== "off";
}

/** One line of text, its white space collapsed. */
function oneLine(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, " ").trim();
}

/** A region's text, and the text nodes it comes from, with each one's data
 *  as read. */
export interface RegionRead {
  text: string;
  from: Map<Text, string>;
}

/**
 * What a screen reader could say for `region`: core's read of a live region
 * (never raw `textContent`, which also holds a `<textarea>`'s markup default
 * and hidden text), line by line as the page lays it out, so two paragraphs
 * don't run together, then joined into one line; and the text nodes it
 * comes from.
 */
export function announcedRead(region: Element): RegionRead {
  const texts: Text[] = [];
  const text = pageText(region, { announced: true, lines: true, texts });
  return { text: oneLine(text), from: dataOf(texts) };
}

/**
 * The text nodes `region` holds while `aria-hidden` or `inert` content above
 * it hides it from assistive tech (a modal's `aria-hidden` on the page
 * behind it): what it would say once shown, nothing `aria-hidden` inside it
 * included. None when it is emptied, hidden by its own `hidden`, `display`
 * or `aria-hidden`, or not rendered at all because of an ancestor.
 */
export function heldFrom(region: Element): Map<Text, string> {
  // Its own `aria-hidden` hides it as its own `hidden` does, and a container
  // that doesn't render it as well: shown again, its text is news.
  if (
    isAriaHiddenValue(safeGetAttribute(region, "aria-hidden")) ||
    hiddenAbove(region, true)
  ) {
    return new Map();
  }
  const texts: Text[] = [];
  pageText(region, { texts });
  return dataOf(
    texts.filter(
      (node) =>
        /\S/.test(node.data) &&
        !between(node, region).some((el) =>
          isAriaHiddenValue(safeGetAttribute(el, "aria-hidden")),
        ),
    ),
  );
}

/**
 * Does `region` show text `before` didn't: a text node new to it, or one
 * whose data changed? Not white space alone, and not text under an
 * `aria-live` inside it, `off` or a region of its own, which `region`
 * announces nothing for. Text a removal or a restyle only takes away, or
 * shows again unchanged, is no gain.
 */
export function gains(
  region: Element,
  now: Map<Text, string>,
  before: Map<Text, string> | undefined,
): boolean {
  for (const [node, data] of now) {
    if (before?.get(node) === data || !/\S/.test(data)) continue;
    if (!silentIn(node, region)) return true;
  }
  return false;
}

/** What a region said aloud at one moment: its rendered text on one line,
 *  and the text nodes that text comes from. */
export interface Said {
  text: string;
  from: Map<Text, string>;
}

/**
 * What `region` says aloud now, for placing its event: {@link announcedRead}
 * without what sits under an `aria-live` inside it, so a silent edit, or a
 * nested region's, reads as nothing said and silenced text as not said yet,
 * with the page's word and line breaks kept around it. Nodes of white space
 * alone aside.
 */
export function audibleRead(region: Element): Said {
  const texts: Text[] = [];
  const text = pageText(region, {
    announced: true,
    lines: true,
    texts,
    keep: (node) => !silentIn(node, region),
  });
  return {
    text: oneLine(text),
    from: dataOf(texts.filter((node) => /\S/.test(node.data))),
  };
}

/**
 * Had a region that said `then` already said `now`? It had if the two read
 * the same as rendered, word and block breaks kept, whichever nodes carry the
 * words; or if all it did since was lose text nodes it says aloud: what it
 * says now, it said then, the same nodes with the same data in the same
 * order, as a log trimmed of an old entry or an edit under `aria-live="off"`
 * leaves it. Words put in a new order, or new text that only reads like part
 * of the old, are new. Linear in the region's text nodes.
 */
export function alreadySaid(then: Said, now: Said): boolean {
  if (then.text === now.text) return true;
  const order = new Map([...then.from.keys()].map((node, i) => [node, i]));
  let last = -1;
  for (const [node, data] of now.from) {
    const at = order.get(node);
    if (at === undefined || at < last || then.from.get(node) !== data) {
      return false;
    }
    last = at;
  }
  return true;
}

/** Is `node` under an `aria-live="off"` inside `region`, or a region of its
 *  own there? Either way `region` says nothing for it. */
function silentIn(node: Text, region: Element): boolean {
  return between(node, region).some((el) => regionLevel(el) !== null);
}

/** The elements from `node`'s parent up to `region`, not including it, as
 *  rendered: text a slot renders is inside the slot, and text straight under
 *  a shadow root inside its host. */
function between(node: Text, region: Element): Element[] {
  const path: Element[] = [];
  let el = renderedIn(node);
  for (; el && el !== region; el = renderingParent(el)) path.push(el);
  return path;
}

/** The element `node` renders inside: its slot, its parent, or the host of
 *  the shadow root it sits directly under. */
export function renderedIn(node: Node): Element | null {
  const type = safeNodeType(node);
  let slot: Element | null = null;
  if (type === Node.ELEMENT_NODE) slot = safeAssignedSlot(node as Element);
  else if (type === Node.TEXT_NODE) {
    // eslint-disable-next-line no-restricted-properties -- one read, and a text node is never a form
    slot = (node as Text).assignedSlot;
  }
  if (slot) return slot;
  const parent = safeParentElement(node);
  if (parent) return parent;
  const root = safeParentNode(node) as Node | null;
  return root && safeNodeType(root) === Node.DOCUMENT_FRAGMENT_NODE
    ? ((root as Partial<ShadowRoot>).host ?? null)
    : null;
}

function dataOf(texts: Text[]): Map<Text, string> {
  return new Map(texts.map((node) => [node, node.data]));
}
