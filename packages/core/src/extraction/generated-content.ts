/**
 * CSS generated content and `text-transform` in names read from content
 * (accname 1.2 step 2F: "Name From Generated Content").
 *
 * `::before` text is prepended and `::after` text appended to an element's own
 * text, without a space, as Chromium does; a pseudo-element laid out as a box
 * is spaced like any box (see `displayNeedsSpace`).
 */
import { displayNeedsSpace } from "./name-spacing.js";
import { getCachedComputedStyle, type StyleCache } from "./role-map.js";
import { REDACTED_VALUE } from "./sensitivity.js";

export interface PseudoText {
  /** The text the pseudo-element contributes, `text-transform` applied. */
  text: string;
  /** Whether it is laid out as a box that separates its neighbours. */
  boxed: boolean;
}

const NONE: PseudoText = { text: "", boxed: false };

/** The `\` escape at `i` (just past the backslash): its character and length. */
function readEscape(value: string, i: number): [string, number] {
  const hex = /^[0-9a-fA-F]{1,6}/.exec(value.slice(i, i + 6));
  if (hex) {
    const cp = parseInt(hex[0], 16);
    let len = hex[0].length;
    if (/^[ \t\n\r\f]/.test(value.charAt(i + len))) len += 1;
    const ok = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
    return [ok ? String.fromCodePoint(cp) : "�", len];
  }
  return [value.charAt(i), 1];
}

/** The quoted string opening at `i`: its text, and the index just past it. */
function readString(value: string, i: number): [string, number] {
  const quote = value[i];
  let out = "";
  i += 1;
  while (i < value.length && value[i] !== quote) {
    if (value[i] !== "\\") {
      out += value[i];
      i += 1;
      continue;
    }
    if (i + 1 >= value.length) break;
    const [ch, len] = readEscape(value, i + 1);
    // An escaped newline is a line continuation: it adds nothing.
    if (ch !== "\n") out += ch;
    i += 1 + len;
  }
  return [out, i + 1];
}

/** The index just past the argument list opening at `i`, strings skipped. */
function skipArguments(value: string, i: number): number {
  let depth = 0;
  while (i < value.length) {
    const c = value[i];
    if (c === '"' || c === "'") {
      i = readString(value, i)[1];
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    i += 1;
    if (depth === 0) break;
  }
  return i;
}

/**
 * The text of a computed `content` value. Strings count (Chromium's computed
 * value has already resolved `attr()`); in the alternative-text form `X / Y`
 * only `Y` does; `none`, `normal` and every other token — `counter()`,
 * `counters()`, `url()`, `open-quote`, `close-quote` — add nothing, and the
 * strings around them still count.
 */
export function parseContentText(value: string): string {
  let current = "";
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      const [str, next] = readString(value, i);
      current += str;
      i = next;
    } else if (ch === "(") {
      i = skipArguments(value, i);
    } else {
      // Everything before a slash is the content; only what follows is read.
      if (ch === "/") current = "";
      i += 1;
    }
  }
  return current;
}

/** Apply a computed `text-transform` (`uppercase`, `lowercase`, `capitalize`). */
export function applyTextTransform(text: string, transform: string): string {
  if (!text || !transform || transform === "none") return text;
  if (transform.includes("uppercase")) return text.toUpperCase();
  if (transform.includes("lowercase")) return text.toLowerCase();
  if (transform.includes("capitalize")) {
    return text.replace(
      /(^|[^\p{L}\p{N}_'’])(\p{L})/gu,
      (_m, pre: string, letter: string) => pre + letter.toUpperCase(),
    );
  }
  return text;
}

/**
 * jsdom does not implement `getComputedStyle(el, pseudoElt)`: it reports the
 * call as not implemented and returns the element's own style. Make no such
 * call there, so generated content contributes nothing, as it always has.
 */
function pseudoReadsUnsupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /jsdom/i.test(String(navigator.userAgent))
  );
}

type Sides = { before: PseudoText; after: PseudoText };

/** Per extraction, keyed by that extraction's style cache — never shared. */
const perExtraction = new WeakMap<object, WeakMap<Element, Sides>>();

function readSide(
  element: Element,
  pseudo: "::before" | "::after",
): PseudoText {
  const style = window.getComputedStyle(element as HTMLElement, pseudo);
  const content = style.content;
  if (!content || content === "none" || content === "normal") return NONE;
  const text = applyTextTransform(
    parseContentText(content),
    style.textTransform,
  );
  if (!text) return NONE;
  return { text, boxed: displayNeedsSpace(style.display) };
}

/**
 * The generated text before and after an element's content, each read at most
 * once per extraction.
 */
export function generatedText(
  element: Element,
  styleCache?: StyleCache | null,
): Sides {
  const none: Sides = { before: NONE, after: NONE };
  if (
    typeof window === "undefined" ||
    !window.getComputedStyle ||
    pseudoReadsUnsupported()
  )
    return none;
  let byElement = styleCache ? perExtraction.get(styleCache) : undefined;
  if (styleCache && !byElement) {
    byElement = new WeakMap();
    perExtraction.set(styleCache, byElement);
  }
  const hit = byElement?.get(element);
  if (hit) return hit;
  let sides = none;
  try {
    sides = {
      before: readSide(element, "::before"),
      after: readSide(element, "::after"),
    };
  } catch {
    // An element whose pseudo-elements cannot be read lends none.
  }
  byElement?.set(element, sides);
  return sides;
}

/** A pseudo-element's text, padded when it is laid out as a box. */
export function pseudoNameText(side: PseudoText): string {
  return side.boxed && side.text ? ` ${side.text} ` : side.text;
}

/** What a name read from `element`'s content adds around and within its text. */
export interface GeneratedText {
  before: string;
  after: string;
  /** Applies the element's `text-transform` to one of its text nodes. */
  transform: (text: string) => string;
}

const UNCHANGED: GeneratedText = { before: "", after: "", transform: (t) => t };

/** {@link generatedText} and `text-transform` of a name's host, if its text shows. */
export function readGeneratedText(
  element: Element,
  textVisible: boolean,
  styleCache?: StyleCache | null,
): GeneratedText {
  if (!textVisible) return UNCHANGED;
  try {
    const { before, after } = generatedText(element, styleCache);
    const transform = getCachedComputedStyle(
      element,
      styleCache,
    )?.textTransform;
    return {
      before: pseudoNameText(before),
      after: pseudoNameText(after),
      // The withheld marker is a sentinel, not page text: never cased.
      transform: (text) =>
        text === REDACTED_VALUE
          ? text
          : applyTextTransform(text, transform ?? ""),
    };
  } catch {
    return UNCHANGED;
  }
}
