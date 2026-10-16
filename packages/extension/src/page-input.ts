/**
 * Which of the user's own events on a page count as acting on it, for
 * Chrome's tree to follow what the page does next (the content script's
 * `PAGE_INPUT`), and when. The content script reports only that one
 * happened, and when: never what was clicked or typed, or where.
 */

import {
  getImplicitRole,
  resolveRoleToken,
  safeGetAttribute,
} from "@real-a11y-dev/core";

/** What a page-input filter looks at in an event.
 *
 * @internal */
export interface PageInputEvent {
  type: string;
  isTrusted: boolean;
  key?: string;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  /** An `input` event's: what an edit of text did, `""` or absent for a
   *  checkbox, a select or a slider changing value. */
  inputType?: string;
}

/**
 * A click, which Enter or Space on a button makes too, or Enter or Space
 * pressed where it acts rather than types. Typing isn't followed
 * (`isTyping` ends what is): not a click that puts the caret in a text
 * field or an editable region, not Enter in a `<textarea>` or an editable
 * region, where it starts a new line (left out even when a page makes it
 * send a message instead). Space counts only on a control that takes it
 * (`spaceActsOn`): elsewhere it types or only scrolls. `target` is the
 * element clicked, or the one a key went to inside any shadow root, asked
 * for only once the event could count.
 *
 * Only the browser's own events count. One a script makes, the
 * extension's among them, isn't the user acting, and neither is a key held
 * down repeating or one an IME takes to finish what it composes. A form
 * submitted isn't listened for: the browser fires `submit` as its own for a
 * script's `requestSubmit()` too, and a user's submit comes from a click or
 * an Enter already counted. Nor does a press of the pointer count, which
 * only `typingClock` hears: a read while it is held, in a drag, would bring
 * Chrome's bar up and move the page under it.
 *
 * @internal
 */
export function isPageInput(
  e: PageInputEvent,
  target: () => Element | null,
): boolean {
  if (!e.isTrusted) return false;
  if (e.type === "click") {
    const clicked = target();
    return !editsText(clicked) && !isTextField(clicked);
  }
  if (e.type !== "keydown" || e.repeat) return false;
  if (e.key !== "Enter" && e.key !== " ") return false;
  if (e.isComposing || e.keyCode === 229) return false;
  const focused = target();
  if (editsText(focused)) return false;
  return e.key === "Enter" || spaceActsOn(focused);
}

/**
 * The user typing: an edit of text, which the browser reports with what it
 * did (`inputType`), unlike a checkbox, a select or a slider changing value.
 * Only the browser's own, as for `isPageInput`.
 *
 * @internal
 */
export function isTyping(e: PageInputEvent): boolean {
  return e.isTrusted && e.type === "input" && !!e.inputType;
}

/**
 * `isPageInput`, and the one script-made click it can't tell from an event
 * alone: a script's click on a `<label>` clicks the label's control as well,
 * and the browser fires that second click as its own. It comes while the
 * script's click is still being dispatched, so a click until that dispatch
 * is over is left out with it. No user input can come in between: the
 * browser dispatches each in a task of its own.
 *
 * @internal
 */
export function pageInputFilter(): (
  e: PageInputEvent,
  target: () => Element | null,
) => boolean {
  let scriptClicking = false;
  return (e, target) => {
    if (e.type === "click" && !e.isTrusted && !scriptClicking) {
      scriptClicking = true;
      queueMicrotask(() => {
        scriptClicking = false;
      });
    }
    if (e.type === "click" && scriptClicking) return false;
    return isPageInput(e, target);
  };
}

/** What dating an event looks at. */
interface TimedEvent {
  type: string;
  isTrusted: boolean;
  timeStamp: number;
}

/**
 * When the user did what `e` reports, by the clock a frame dates its
 * changes by (`Date.now()`): the event's own time, not when the page got
 * round to dispatching it, which a busy page holds back. A click and a key
 * carry the moment the browser took them from the user.
 *
 * @internal
 */
export function actedAt(e: TimedEvent): number {
  return Date.now() - Math.max(0, performance.now() - e.timeStamp);
}

/** How long after the page dispatches a key an edit of text is still that
 *  key's: it follows at once, unless the page's own handling of the key
 *  holds it up. */
const KEY_EDITS_WITHIN_MS = 500;

/**
 * When the user pressed the key that made an edit `isTyping` sees. Chrome
 * dates an `input` event when the page dispatches it, late on a busy page,
 * so the key is the one the page dispatched just before it, with no press
 * of the pointer since; an edit with none (a paste from a menu, a drop) is
 * dated by itself. The panel orders typing and clicks in different frames
 * by when the user did them, not by whose report reaches it first.
 *
 * @internal
 */
export function typingClock(): {
  keyPressed(e: TimedEvent): void;
  pointerPressed(e: TimedEvent): void;
  pressedAt(e: TimedEvent): number;
} {
  let key: { at: number; dispatchedAt: number } | null = null;
  return {
    keyPressed(e) {
      if (!e.isTrusted || e.type !== "keydown") return;
      key = { at: actedAt(e), dispatchedAt: performance.now() };
    },
    // Whatever is edited after a press of the pointer (a paste from a menu,
    // a drop, a pick from a list) isn't the key's.
    pointerPressed(e) {
      if (e.isTrusted && e.type === "pointerdown") key = null;
    },
    pressedAt(e) {
      return key !== null &&
        performance.now() - key.dispatchedAt <= KEY_EDITS_WITHIN_MS
        ? key.at
        : actedAt(e);
    },
  };
}

/** A `<textarea>` or an editable region, including a document in design
 *  mode: the browser's own answer, inherited editability and all. */
function editsText(element: Element | null): boolean {
  return (
    element !== null &&
    (element.localName === "textarea" ||
      (element as HTMLElement).isContentEditable === true)
  );
}

/** The roles of the controls Space works: buttons, checkboxes and the
 *  like, and the composite widgets that move a selection among their
 *  items or open a list. */
const SPACE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "switch",
  "radio",
  "tab",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "gridcell",
  "listbox",
  "tree",
  "treegrid",
  "grid",
  "menu",
  "menubar",
  "tablist",
  "radiogroup",
  "combobox",
]);

/**
 * Whether Space acts on `focused` rather than type or scroll: a control
 * that takes it, by its role. Counted on the key, not only by the click it
 * may make: a menu button often acts on the key and cancels the click. Not
 * a `<select>`, where Space is part of what the user types to find an
 * option.
 */
function spaceActsOn(focused: Element | null): boolean {
  if (!focused || isTextField(focused) || focused.localName === "select") {
    return false;
  }
  // The role the tree gives it, an author's included where it holds; or
  // the author's alone where a wrapper with no role of its own sits
  // between it and the composite it needs around it.
  const role = getImplicitRole(focused);
  if (SPACE_ROLES.has(role) || SPACE_ROLES.has(authoredRole(focused) ?? "")) {
    return true;
  }
  // A date picker's day: a cell, in a grid.
  return (
    role === "cell" &&
    focused.closest('[role~="grid" i], [role~="treegrid" i]') !== null
  );
}

/** The first role token in `focused`'s `role` attribute that is a role,
 *  case-folded, whatever the elements around it. */
function authoredRole(focused: Element): string | undefined {
  const value = safeGetAttribute(focused, "role");
  for (const token of value?.split(/\s+/) ?? []) {
    const role = token ? resolveRoleToken(token) : undefined;
    if (role) return role;
  }
  return undefined;
}

/** The `<input>` types typed into, unlike a checkbox's or a button's. */
const TEXT_FIELD_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

/** An `<input>` that takes typed text: not a read-only one, which a date
 *  picker or a custom select opens on a click instead. A date or time field
 *  is typed into where it is clicked; its picker opens only from its icon,
 *  which can't be told apart. */
function isTextField(element: Element | null): boolean {
  if (element?.localName !== "input") return false;
  const input = element as HTMLInputElement;
  return TEXT_FIELD_TYPES.has(input.type) && !input.readOnly;
}
