/**
 * Frame owners: which element of a page holds which frame, told by the frame
 * itself.
 *
 * The extension knows a frame by a number, and the page's own document knows
 * it by the `<iframe>` that holds it, with nothing in Chrome's extension API
 * that turns one into the other. A frame's URL does for most frames, but not
 * for the ones a page makes without a URL of their own: every `about:blank`
 * and `srcdoc` frame shows the same one, and a frame a script wrote into
 * (`document.open()`) shows the URL of the document that wrote it.
 *
 * So each frame's content script marks the element holding its frame, and
 * the script of the document around it reads the mark off that element. Two
 * facts of Chromium make that work, both pinned by `e2e/blank-frames.test.ts`:
 * `window.frameElement` is readable from a frame of its parent's origin,
 * which is every frame without a URL of its own that the content script runs
 * in, and one extension's content scripts see the same object for the same
 * element in every frame of an origin. A property set on it by one is there
 * for the other, and for nobody else: page script has objects of its own for
 * the page's elements, and nothing of this ever reaches the DOM.
 *
 * A frame of another origin than its parent's can't reach the element, marks
 * nothing, and is told apart by its URL as before.
 */

/** Keyed by a symbol, which no `<form>` control or `<object>` plugin can
 *  shadow as it could a named property. The registry is shared by every
 *  frame of the page, so each frame's script gets the same symbol. */
const MARK = Symbol.for("@real-a11y-dev/extension.frame-owner");

type Marked = Element & { [MARK]?: unknown };

/** The elements that can hold a frame, by local name. */
const FRAME_HOLDERS = new Set(["iframe", "frame", "object", "embed"]);

/** Whether an element of this local name can hold a frame. */
export function isFrameHolder(localName: string): boolean {
  return FRAME_HOLDERS.has(localName);
}

/** A mark for one content script: 96 random bits, as hex. Not a secret, as
 *  the page never sees it; only never the same for two frames. */
export function newFrameMark(): string {
  const words = crypto.getRandomValues(new Uint32Array(3));
  return Array.from(words, (word) => word.toString(16).padStart(8, "0")).join(
    "",
  );
}

/** The element holding `win`'s frame, or null: for the top frame, and for a
 *  frame of another origin than its parent's, which can't reach it. */
function frameHolder(win: Window): Marked | null {
  try {
    return win.frameElement;
  } catch {
    return null;
  }
}

/**
 * The elements this script has marked, held for as long as it runs. The mark
 * is a property of the script's own object for the element, which nothing
 * else of the extension may be holding between two reads of it: kept here,
 * that object can't be collected and made anew without its mark.
 */
const marked = new Set<Marked>();

/**
 * Leave `mark` on the element holding `win`'s frame, over whatever an
 * earlier document in the frame left. False when the element is out of
 * reach, and nothing was marked.
 */
export function markFrameOwner(win: Window, mark: string): boolean {
  const holder = frameHolder(win);
  if (!holder) return false;
  try {
    holder[MARK] = mark;
    marked.add(holder);
    return true;
  } catch {
    return false;
  }
}

/** Take `mark` back off the element holding `win`'s frame, when it is still
 *  the one there: for a document leaving its frame, whose successor may be
 *  of another origin and unable to replace it. */
export function unmarkFrameOwner(win: Window, mark: string): void {
  const holder = frameHolder(win);
  try {
    if (holder && holder[MARK] === mark) delete holder[MARK];
    if (holder) marked.delete(holder);
  } catch {
    /* out of reach after all: nothing to take back */
  }
}

/** The mark the frame `el` holds left on it, if any. */
export function frameOwnerMark(el: Element): string | undefined {
  const mark = (el as Marked)[MARK];
  return typeof mark === "string" ? mark : undefined;
}
