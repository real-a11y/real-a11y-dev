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
} from "@real-a11y-dev/core";

export type Level = "polite" | "assertive";

/** The politeness each live role implies, for the `{live=…}` suffix. */
export const ROLE_LEVELS: ReadonlyMap<string, Level> = new Map([
  ["alert", "assertive"],
  ["status", "polite"],
  ["log", "polite"],
]);

/** The live region a change belongs to, and whether a nested
 *  `aria-live="off"` silenced it on the way there. */
export interface Holder {
  region: Element;
  quiet: boolean;
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
 * Is `now` what `before` was with some of its text taken out? Then it gained
 * nothing. White space aside, since a restyle can move a line break.
 */
export function onlyLost(now: string, before: string): boolean {
  const from = before.replace(/\s+/g, "");
  let i = 0;
  for (const char of now.replace(/\s+/g, "")) {
    i = from.indexOf(char, i);
    if (i < 0) return false;
    i += char.length;
  }
  return true;
}

/** Is `element` inside `aria-hidden` or `inert` content? */
export function hiddenAbove(element: Element): boolean {
  for (let el = renderingParent(element); el; el = renderingParent(el)) {
    if (isAriaHiddenValue(safeGetAttribute(el, "aria-hidden"))) return true;
    if (safeGetAttribute(el, "inert") !== null) return true;
  }
  return false;
}

/** Is `node` an element under its own `aria-live="off"`? */
export function isSilent(node: Node): boolean {
  return (
    safeNodeType(node) === Node.ELEMENT_NODE &&
    regionLevel(node as Element) === "off"
  );
}

/** `holder`, silenced when `silent`. */
export function quieted(holder: Holder | null, silent: boolean): Holder | null {
  return holder && silent ? { ...holder, quiet: true } : holder;
}

/** Is `region`'s level one that announces? */
export function isLive(level: Level | "off" | null): level is Level {
  return level !== null && level !== "off";
}

/** One line of text, its white space collapsed. */
function oneLine(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, " ").trim();
}

/**
 * What `region` holds whatever hides it from assistive tech above it: its
 * text as rendered, `aria-hidden` and ancestors aside. Empty when it is
 * emptied or hidden by its own `hidden` or `display`.
 */
export function heldText(region: Element): string {
  return oneLine(pageText(region, { lines: true }));
}

/**
 * What a screen reader could say for `region`: core's read of a live region
 * (never raw `textContent`, which also holds a `<textarea>`'s markup default
 * and hidden text), line by line as the page lays it out, so two paragraphs
 * don't run together, then joined into one line.
 */
export function announcedText(region: Element): string {
  return oneLine(pageText(region, { announced: true, lines: true }));
}
