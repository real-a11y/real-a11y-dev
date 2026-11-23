/**
 * CSS generated content and `text-transform` in names read from content
 * (accname 1.2 step 2F: "Name From Generated Content").
 *
 * `::before` text is prepended and `::after` text appended to an element's own
 * text, without a space, as Chromium does; a pseudo-element laid out as a box
 * is spaced like any box (see `displayNeedsSpace`).
 */
import { displayNeedsSpace, isTextVisible } from "./name-spacing.js";
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
    // A backslash before a raw newline is a line continuation: it adds
    // nothing. (A `\a` escape is a real line feed, and is kept.)
    if (value[i + 1] === "\n") {
      i += 2;
      continue;
    }
    const [ch, len] = readEscape(value, i + 1);
    out += ch;
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

/** The effective content language of an element, or undefined. */
function langOf(element: Element): string | undefined {
  return element.closest("[lang]")?.getAttribute("lang") || undefined;
}

/**
 * Apply a computed `text-transform` (`uppercase`, `lowercase`, `capitalize`),
 * with the language's own casing rules (`lang="tr"` uppercases `i` to `İ`).
 */
export function applyTextTransform(
  text: string,
  transform: string,
  lang?: string,
): string {
  if (!text || !transform || transform === "none") return text;
  try {
    if (transform.includes("uppercase")) return text.toLocaleUpperCase(lang);
    if (transform.includes("lowercase")) return text.toLocaleLowerCase(lang);
    if (transform.includes("capitalize")) {
      // A letter that starts a word. An apostrophe between two letters is part
      // of the word (`don't`); one after a quote or space is not.
      return text.replace(
        /(?<![\p{L}\p{N}_])(?<!\p{L}['\u2019])(\p{L})/gu,
        (letter: string) => letter.toLocaleUpperCase(lang),
      );
    }
  } catch {
    // A language tag the engine rejects: fall back to its default casing.
    return applyTextTransform(text, transform);
  }
  return text;
}

/**
 * Whether a window is jsdom's. Its user agent says so, read through
 * `Navigator.prototype`'s own getter: a test of code that detects a phone
 * fakes `navigator.userAgent` with an own property, which that read passes by.
 * Where the test replaced `navigator` whole, the getter refuses the stand-in,
 * and jsdom's refusal is worded as no browser's is (jsdom 26 to 31 alike;
 * Chromium says "Illegal invocation").
 */
function isJsdom(view: Window & typeof globalThis): boolean {
  try {
    const own = Object.getOwnPropertyDescriptor(
      view.Navigator.prototype,
      "userAgent",
    )?.get;
    const agent = own ? own.call(view.navigator) : view.navigator.userAgent;
    return /jsdom/i.test(String(agent));
  } catch (error) {
    return /not a valid instance of Navigator/.test(
      String((error as { message?: unknown } | null)?.message),
    );
  }
}

/**
 * The windows found to be jsdom's. Only that answer is kept: a "no" given
 * while a test had faked the prototype's own getter is asked again next time.
 * A memo, not shared state: every copy of this code reaches the same answer.
 */
const jsdomWindows = new WeakSet<object>();

/**
 * jsdom does not implement `getComputedStyle(el, pseudoElt)`: it reports the
 * call as not implemented and returns the element's own style. Make no such
 * call there, so generated content contributes nothing, as it always has.
 *
 * Asked of the window whose `getComputedStyle` would be called. Once it says
 * jsdom, what a test does to `navigator` afterwards cannot change the answer.
 */
function pseudoReadsUnsupported(): boolean {
  if (jsdomWindows.has(window)) return true;
  if (!isJsdom(window)) return false;
  jsdomWindows.add(window);
  return true;
}

type Sides = { before: PseudoText; after: PseudoText };

/** Per extraction, keyed by that extraction's style cache — never shared. */
const perExtraction = new WeakMap<object, WeakMap<Element, Sides>>();

function readSide(
  element: Element,
  pseudo: "::before" | "::after",
  lang: string | undefined,
): PseudoText {
  const style = window.getComputedStyle(element as HTMLElement, pseudo);
  const content = style.content;
  if (!content || content === "none" || content === "normal") return NONE;
  // No box is drawn, or its text is not shown: nothing is read.
  if (style.display === "none" || !isTextVisible(style)) return NONE;
  const text = applyTextTransform(
    parseContentText(content),
    style.textTransform,
    lang,
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
    const lang = langOf(element);
    sides = {
      before: readSide(element, "::before", lang),
      after: readSide(element, "::after", lang),
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
          : !transform || transform === "none"
            ? text
            : applyTextTransform(text, transform, langOf(element)),
    };
  } catch {
    return UNCHANGED;
  }
}
