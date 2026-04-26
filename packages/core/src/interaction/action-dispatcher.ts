import type { ActionRequest, ActionResult } from "../types.js";
import { ElementRefMap } from "../utils/element-ref.js";

/**
 * Maps tree actions to real DOM operations.
 * This is the bridge between the tree UI and the actual page.
 */
export class ActionDispatcher {
  constructor(private elementRefs: ElementRefMap) {}

  dispatch(request: ActionRequest): ActionResult {
    const element = this.elementRefs.get(request.nodeId);
    if (!element) {
      return { success: false, error: "Element no longer in DOM" };
    }

    switch (request.action) {
      case "click":
        return this.handleClick(element);
      case "navigate":
        return this.handleNavigate(element);
      case "focus":
        return this.handleFocus(element);
      case "type":
        return this.handleType(element, request.payload);
      case "submit":
        return this.handleSubmit(element);
      case "toggle":
        return this.handleToggle(element);
      case "select":
        return this.handleSelect(element, request.payload);
      case "scroll":
        return this.handleScroll(element);
      default:
        return { success: false, error: `Unknown action: ${request.action}` };
    }
  }

  private handleClick(element: Element): ActionResult {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: element.ownerDocument.defaultView,
    });
    element.dispatchEvent(event);
    return { success: true };
  }

  private handleNavigate(element: Element): ActionResult {
    // For links, dispatch a real click which triggers natural navigation
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: element.ownerDocument.defaultView,
    });
    element.dispatchEvent(event);
    return { success: true };
  }

  private handleFocus(element: Element): ActionResult {
    const htmlEl = element as HTMLElement;
    if (htmlEl.focus) {
      htmlEl.focus();
      return { success: true, requiresInput: true, inputType: "text" };
    }
    return { success: false, error: "Element is not focusable" };
  }

  private handleType(
    element: Element,
    payload?: Record<string, unknown>,
  ): ActionResult {
    const value = payload?.["value"];
    if (typeof value !== "string") {
      return { success: false, error: "No value provided for type action" };
    }

    const el = element as HTMLInputElement | HTMLTextAreaElement;

    // Use the native setter from the element's own prototype so frameworks
    // (React, Angular, Vue) see the change. The input and textarea setters
    // are NOT interchangeable — each performs internal-slot checks and
    // throws TypeError when called on the wrong element type.
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");

    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true };
  }

  private handleSubmit(element: Element): ActionResult {
    const form =
      element.closest("form") || (element.tagName === "FORM" ? element : null);

    if (!form) {
      return { success: false, error: "No form found" };
    }

    (form as HTMLFormElement).requestSubmit();
    return { success: true };
  }

  private handleToggle(element: Element): ActionResult {
    const tag = element.tagName.toLowerCase();

    if (tag === "details") {
      (element as HTMLDetailsElement).open = !(element as HTMLDetailsElement)
        .open;
      return { success: true };
    }

    if (tag === "summary") {
      const details = element.closest("details");
      if (details) {
        details.open = !details.open;
        return { success: true };
      }
    }

    // Fallback: click
    return this.handleClick(element);
  }

  private handleSelect(
    element: Element,
    payload?: Record<string, unknown>,
  ): ActionResult {
    const value = payload?.["value"];
    if (typeof value !== "string") {
      return { success: false, error: "No value provided for select action" };
    }

    const select = element as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true };
  }

  private handleScroll(element: Element): ActionResult {
    (element as HTMLElement).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    return { success: true };
  }
}
