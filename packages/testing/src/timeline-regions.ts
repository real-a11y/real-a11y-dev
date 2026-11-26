// How `recordTimeline` reads live regions: which element is one, how it
// announces, and the text it says or holds. Kept apart from the recorder,
// which decides when and in what order those reads become lines.

import {
  getImplicitRole,
  isAriaHiddenValue,
  liveRegionLevel,
  pageText,
  renderingParent,
  safeGetAttribute,
  safeNodeType,
  safeParentElement,
} from "@real-a11y-dev/core";

export type Level = "polite" | "assertive";

/** The politeness each live role implies, for the `{live=…}` suffix. */
export const ROLE_LEVELS: ReadonlyMap<string, Level> = new Map([
  ["alert", "assertive"],
  ["status", "polite"],
  ["log", "polite"],
]);

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

/** Is `element` inside `aria-hidden` or `inert` content? */
export function hiddenAbove(element: Element): boolean {
  for (let el = renderingParent(element); el; el = renderingParent(el)) {
    if (isAriaHiddenValue(safeGetAttribute(el, "aria-hidden"))) return true;
    if (safeGetAttribute(el, "inert") !== null) return true;
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
 * The text nodes `region` holds whatever hides it from assistive tech above
 * it (a modal's `aria-hidden` on the page behind it, or a hidden ancestor):
 * what it would say once shown, nothing `aria-hidden` inside it included.
 * None when it is emptied, or hidden by its own `hidden`, `display` or
 * `aria-hidden`.
 */
export function heldFrom(region: Element): Map<Text, string> {
  // Its own `aria-hidden` hides it as its own `hidden` does: shown again, its
  // text is news.
  if (isAriaHiddenValue(safeGetAttribute(region, "aria-hidden"))) {
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
 * `aria-live="off"` inside it, a change it announces nothing for. Text a
 * removal or a restyle only takes away, or shows again unchanged, is no gain.
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

/**
 * What `region` says aloud, in reading order: its text without what sits
 * under an `aria-live="off"` inside it, and without white space, which a
 * restyle can move. Two reads that say the same are the same message,
 * whichever nodes carry it.
 */
export function audible(region: Element, from: Map<Text, string>): string {
  let said = "";
  for (const [node, data] of from) {
    if (!silentIn(node, region)) said += data;
  }
  return said.replace(/\s+/g, "");
}

/** Is `node` under an `aria-live="off"` inside `region`? The nearest
 *  `aria-live` decides. */
function silentIn(node: Text, region: Element): boolean {
  const level = between(node, region)
    .map(regionLevel)
    .find((l) => l !== null);
  return level === "off";
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
  const slot = (node as Partial<Text>).assignedSlot;
  if (slot) return slot;
  const parent = safeParentElement(node);
  if (parent) return parent;
  const root = node.parentNode;
  return root && safeNodeType(root) === Node.DOCUMENT_FRAGMENT_NODE
    ? ((root as Partial<ShadowRoot>).host ?? null)
    : null;
}

function dataOf(texts: Text[]): Map<Text, string> {
  return new Map(texts.map((node) => [node, node.data]));
}
