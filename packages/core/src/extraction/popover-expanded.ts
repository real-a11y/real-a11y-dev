import { canExpand } from "./aria-state-roles.js";
import {
  safeContains,
  safeGetAttribute,
  safeGetElementById,
  safeRootNode,
} from "./clobber-safe.js";
import { idScope } from "./flat-tree.js";
import { isActuallyDisabled } from "./focusability.js";

/** The `<input>` types that can invoke a popover through `popovertarget`. */
const POPOVER_INVOKER_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "image",
]);

/** The `command` values that show or hide a popover, in any case. */
const POPOVER_COMMANDS = new Set([
  "toggle-popover",
  "show-popover",
  "hide-popover",
]);

/**
 * The element an IDREF attribute names, the way its reflecting property
 * (`popoverTargetElement`, `commandForElement`) resolves it: the id in the
 * element's own tree, or an element script set. An engine without the
 * property, such as jsdom, gets the id lookup alone.
 */
function referencedElement(
  element: Element,
  attr: string,
  property: string,
): Element | null {
  if (property in element)
    return (element as unknown as Record<string, Element | null>)[property];
  const id = safeGetAttribute(element, attr);
  return id ? safeGetElementById(idScope(element), id) : null;
}

/**
 * True for a submit button: an `<input>` of type submit or image, or a
 * `<button>` of type submit. A `<button>` with a missing or invalid type is
 * one too, unless it has a `commandfor`, which makes it a plain button.
 * `type` is its `type` attribute, lowercased.
 */
function isSubmitButton(element: Element, tag: string, type: string): boolean {
  if (tag === "input") return type === "submit" || type === "image";
  if (type === "button" || type === "reset") return false;
  return type === "submit" || !element.hasAttribute("commandfor");
}

/**
 * The element a `<button>` or `<input>` shows and hides, as Chromium 151
 * resolves it for the expanded state, or `null`:
 *
 * - A `<button>`'s `commandfor` decides when it names an element and its
 *   `command` is a popover one, whether or not that element is a popover.
 * - Otherwise `popovertarget` does, when it names a popover. An `<input>`
 *   takes it only as a button, submit, reset or image.
 * - Neither, for a disabled control, or a submit button with a form: that
 *   one submits the form instead.
 */
function invokedElement(element: Element, tag: string): Element | null {
  const type = (safeGetAttribute(element, "type") ?? "").toLowerCase();
  if (tag === "input") {
    if (!POPOVER_INVOKER_INPUT_TYPES.has(type)) return null;
  } else if (tag !== "button") {
    return null;
  }
  if (isActuallyDisabled(element)) return null;
  if (isSubmitButton(element, tag, type) && (element as HTMLButtonElement).form)
    return null;
  if (tag === "button") {
    const command = (safeGetAttribute(element, "command") ?? "").toLowerCase();
    const target = POPOVER_COMMANDS.has(command)
      ? referencedElement(element, "commandfor", "commandForElement")
      : null;
    if (target) return target;
  }
  const popover = referencedElement(
    element,
    "popovertarget",
    "popoverTargetElement",
  );
  // Through the prototype: the target can be a <form>, which a field named
  // `hasAttribute` or `contains` shadows.
  return popover && safeGetAttribute(popover, "popover") !== null
    ? popover
    : null;
}

/**
 * True when `element` is inside `container`, crossing shadow roots, and is
 * not `container` itself.
 */
function isShadowIncludingDescendant(
  element: Element,
  container: Element,
): boolean {
  if (element === container) return false;
  for (let el: Element | undefined = element; el;) {
    if (safeContains(container, el)) return true;
    const root = safeRootNode(el);
    el = root.nodeType === 11 ? (root as ShadowRoot).host : undefined;
  }
  return false;
}

/**
 * A popover invoker's `expanded` state in Chromium's tree: whether the
 * element it shows and hides is a showing popover. See {@link invokedElement}
 * for which controls invoke which element.
 *
 * `null` where `aria-expanded` decides instead: for a control that invokes
 * nothing, or sits inside what it invokes, like a popover's close button.
 * Also for a role Chromium gives no expanded state, which it lacks whatever
 * sets one, and in an engine without popovers, which throws on
 * `:popover-open`.
 */
export function popoverExpanded(
  element: Element,
  tag: string,
  role: string,
): boolean | null {
  if (!canExpand(element, role)) return null;
  const invoked = invokedElement(element, tag);
  if (!invoked || isShadowIncludingDescendant(element, invoked)) return null;
  try {
    return Element.prototype.matches.call(invoked, ":popover-open");
  } catch {
    return null;
  }
}
