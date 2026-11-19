import type { ActionType } from "../types.js";

import { safeGetAttribute, safeTagName } from "./clobber-safe.js";
import { isEditingHost, isLiveLink } from "./editing.js";
import { MEDIA_TAGS } from "./field-text.js";
import { getExplicitRole } from "./role-map.js";

/** Roles whose widget is operated by a plain click. */
const CLICK_ROLES = new Set([
  "button",
  "checkbox",
  "switch",
  "radio",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "treeitem",
  "gridcell",
  "row",
]);

/** Actions for an `<input>`, by its type. */
function inputActions(inputType: string): ActionType[] {
  const type = inputType || "text";
  if (type === "checkbox" || type === "radio") return ["click"];
  if (type === "file") return ["focus"];
  // Sliders aren't typeable — they listen for ArrowLeft/ArrowRight
  // (or use the .stepUp/.stepDown API). Pair the increment/decrement
  // actions so the panel can drive value changes under the Screen
  // Curtain too.
  if (type === "range") return ["focus", "increment", "decrement"];
  // Number inputs accept typed values *and* arrow-key stepping —
  // expose both so the panel can either set a value or nudge it.
  if (type === "number") return ["focus", "type", "increment", "decrement"];
  return type === "hidden" ? [] : ["focus", "type"];
}

/**
 * Actions an element's tag gives it, or `undefined` when its tag says
 * nothing and its role decides.
 */
function tagActions(element: Element, tag: string): ActionType[] | undefined {
  // Links — live ones. A link inside editable content is not: Chromium
  // won't follow it, not even on a scripted click(), or focus it, so it has
  // no action to offer. (One that is itself an editing host gets focus/type
  // below.)
  if (tag === "a" && isLiveLink(element)) return ["click", "navigate"];
  // Buttons (native + input type=button/submit/reset/image) and the other
  // inputs, differentiated by type.
  if (tag === "button" || tag === "input") {
    const type = (element as HTMLInputElement).type;
    if (
      tag === "button" ||
      ["button", "submit", "reset", "image"].includes(type)
    ) {
      return type === "submit" ? ["click", "submit"] : ["click"];
    }
    return inputActions(type);
  }
  // Textarea — text entry
  if (tag === "textarea") return ["focus", "type"];
  // Select — option picker
  if (tag === "select") return ["focus", "select"];
  // Details / Summary — toggle
  if (tag === "details" || tag === "summary") return ["toggle"];
  // Media with native controls — the element itself is a tab stop (the
  // play/seek/volume UI lives in a closed UA shadow root we can't reach).
  // Only "focus" is honest here: a synthetic click doesn't count as a user
  // gesture for playback, so a CLICK badge would no-op.
  if (MEDIA_TAGS.has(tag) && element.hasAttribute("controls")) return ["focus"];
  return undefined;
}

/** Actions an ARIA role (or an `onclick`) gives an element. */
function roleActions(element: Element, role: string | undefined): ActionType[] {
  // Any element reaches the `onclick` read, so it goes through the
  // prototype: a <form> can shadow `hasAttribute`.
  if (
    CLICK_ROLES.has(role as string) ||
    safeGetAttribute(element, "onclick") !== null
  ) {
    return ["click"];
  }
  if (role === "combobox") {
    // An ARIA combobox is either EDITABLE (a text field you type into, e.g.
    // Slack's search — the ARIA 1.2 editable-combobox pattern) or SELECT-ONLY
    // (a popup button with no text entry). A non-native combobox is editable
    // exactly when it's a contenteditable host. An editable one is treated like
    // a textbox so the panel opens its inline input. Deliberately NOT "click":
    // click outranks type in getPrimaryAction, so a co-present click would
    // re-hijack the primary action and re-break text entry. A select-only one
    // dispatches click to open the popup natively.
    return isEditingHost(element) ? ["focus", "type"] : ["click"];
  }
  if (role === "textbox" || role === "searchbox") return ["focus", "type"];
  // ARIA slider: a custom widget (Radix `<span role="slider">`,
  // Headless UI, etc.) that listens for ArrowLeft/ArrowRight on the
  // element. "type" would set a `.value` property the widget never
  // reads — drop it. The dispatcher's increment/decrement focus the
  // element and dispatch real keydown events, which works equally
  // well under the Screen Curtain.
  if (role === "slider") return ["focus", "increment", "decrement"];
  // Spinbuttons (date pickers, custom number steppers) accept both
  // typed values and arrow-key stepping. Surface both.
  if (role === "spinbutton") return ["focus", "type", "increment", "decrement"];
  return [];
}

/**
 * Determine what actions an element supports.
 *
 * @internal
 */
export function getActions(element: Element): ActionType[] {
  const tag = safeTagName(element);
  // The role the tree shows, so the actions offered agree with it: a
  // `role="foo button"` clicks, an option the browser discarded doesn't.
  const role = getExplicitRole(element);
  const actions = tagActions(element, tag) ?? roleActions(element, role);

  // An editing host is a text field whatever its role: Chromium focuses it
  // and takes typing, and the dispatcher's `type` writes into it. The role
  // branches above cover a textbox, a searchbox and an editable combobox;
  // this catches the role-less `<div contenteditable>` composer, which
  // otherwise read as inert and folded out of the a11y view — and so out of
  // every tab sequence built on it. It precedes the tabindex catch-all,
  // whose `click` would outrank `type` in getPrimaryAction.
  if (actions.length > 0) return actions;
  if (isEditingHost(element)) return ["focus", "type"];
  return safeGetAttribute(element, "tabindex") !== null ? ["click"] : actions;
}
