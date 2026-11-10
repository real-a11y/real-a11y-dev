/**
 * What the user does on a page, which the change marks tell the updates they
 * caused by (`usePageChanges` in the shared panel; the Storybook addon's
 * preview sends it to its panel).
 */

import { PANEL_HOST_ATTRIBUTE } from "../extraction/overlay-reach.js";

/**
 * What the user did: a press or a key (`act`), a click (`click`), which can
 * come with no press, as a screen reader's activation does, or typing in a
 * field (`type`).
 */
export type UserInput = "act" | "click" | "type";

/** Keys that do nothing on their own. */
const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Meta",
  "Shift",
]);

/** Whether `e` happened in a panel rather than on the page: the inspector
 *  marks the container of every panel it mounts. Through the prototype: a
 *  page's `<form>` can shadow `hasAttribute` with a control of that name. */
function inPanel(e: Event): boolean {
  return e
    .composedPath()
    .some(
      (n) =>
        n instanceof Element &&
        Element.prototype.hasAttribute.call(n, PANEL_HOST_ATTRIBUTE),
    );
}

/** The input `e` is: none for a modifier key on its own, or for an `input`
 *  event that isn't text entry, as a checkbox's or a `<select>`'s isn't. */
function inputOf(e: Event): UserInput | null {
  switch (e.type) {
    case "keydown":
      return MODIFIER_KEYS.has((e as KeyboardEvent).key) ? null : "act";
    case "pointerdown":
      return "act";
    case "click":
      return "click";
    default:
      return typeof (e as InputEvent).inputType === "string" ? "type" : null;
  }
}

const EVENTS = ["pointerdown", "keydown", "click", "input"];

/**
 * Calls `on` with what the user does on `doc`, and the event it came as,
 * heard as the event starts down to its target. Nothing in one of this
 * project's panels is the page's. Returns what stops it.
 */
export function watchUserInput(
  doc: Document,
  on: (input: UserInput, e: Event) => void,
): () => void {
  const listener = (e: Event) => {
    const input = inputOf(e);
    if (input && !inPanel(e)) on(input, e);
  };
  for (const name of EVENTS) doc.addEventListener(name, listener, true);
  return () => {
    for (const name of EVENTS) doc.removeEventListener(name, listener, true);
  };
}
