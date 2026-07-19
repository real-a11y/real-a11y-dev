import type { ActionRequest, ActionResult } from "../types.js";
import { ElementRefMap } from "../utils/element-ref.js";

/**
 * ARIA composite-widget child roles. Elements with these roles are commonly
 * implemented as containers — the actual click handler lives on a more
 * specific descendant (a `role="link"`, an `<a href>`, or a Google-style
 * `[data-target="node"]` hint).
 */
const COMPOSITE_CHILD_ROLES = new Set([
  "treeitem",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "row",
  "gridcell",
  "cell",
]);

/**
 * Pick the element the page is actually listening for a click on.
 *
 * Composite-widget children (treeitem, menuitem, option, tab, …) are
 * commonly implemented as containers wrapping an interactive descendant —
 * a `role="link"` / `role="button"`, an `<a href>`, or a `<button>`. The
 * wrapper itself often has no handler; delegated handlers look for the
 * descendant via `event.target.closest(…)`. Dispatching on the wrapper
 * sets `event.target = wrapper`, the `closest()` walk goes upward (away
 * from the descendant), the handler returns null, and the click no-ops.
 *
 * `querySelector` returns the first match in document order, which is the
 * outermost interactive descendant — typically the row's primary action,
 * not an inner secondary control like an expand/collapse chevron. If
 * nothing matches (well-formed ARIA where the wrapper itself is
 * interactive — Reach UI, Radix UI, ARIA APG reference impl), return the
 * wrapper unchanged.
 */
export function resolveClickTarget(element: Element): Element {
  const role = element.getAttribute("role") ?? "";
  if (!COMPOSITE_CHILD_ROLES.has(role)) return element;
  const candidate = element.querySelector(
    '[role="link"], [role="button"], a[href], button',
  );
  return candidate ?? element;
}

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

    // Any handler can throw — a native setter's brand check on the wrong
    // element type, or a page's own event listener throwing during one of our
    // synthetic dispatches. Never let that escape: in the extension it would
    // blow out of the content-script message handler and leave the panel's
    // action hanging with no response.
    try {
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
        case "increment":
          return this.handleStep(element, 1);
        case "decrement":
          return this.handleStep(element, -1);
        default:
          return {
            success: false,
            error: `Unknown action: ${request.action}`,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private handleClick(element: Element): ActionResult {
    this.dispatchPointerSequence(resolveClickTarget(element));
    return { success: true };
  }

  private handleNavigate(element: Element): ActionResult {
    this.dispatchPointerSequence(resolveClickTarget(element));
    return { success: true };
  }

  // Many modern UIs (Google's jsaction, Material ripple, etc.) gate their
  // click handlers on a full pointer/mouse sequence rather than a bare
  // synthetic click. Fire the whole sequence so those handlers run.
  private dispatchPointerSequence(element: Element): void {
    const base = { bubbles: true, cancelable: true, composed: true, button: 0 };
    const pointer = { ...base, pointerType: "mouse", isPrimary: true };
    element.dispatchEvent(new PointerEvent("pointerdown", pointer));
    element.dispatchEvent(new MouseEvent("mousedown", base));
    element.dispatchEvent(new PointerEvent("pointerup", pointer));
    element.dispatchEvent(new MouseEvent("mouseup", base));
    element.dispatchEvent(new MouseEvent("click", base));
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

    // Native <input>/<textarea>: write through the element's OWN prototype
    // setter so frameworks (React, Angular, Vue) see the change. The input
    // and textarea setters are NOT interchangeable — each brand-checks its
    // receiver and throws TypeError on the wrong element type — so match the
    // prototype to the element. The `instanceof` guard also keeps a custom
    // widget from ever reaching the native setter (that was an uncaught
    // "Illegal invocation" crash when the extractor assigned `type` to an
    // ARIA textbox that is really a contenteditable <div>).
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      const proto =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true };
    }

    // Custom ARIA textbox / searchbox / spinbutton — in real apps these are
    // usually contenteditable <div>/<span>s. There's no `.value`, so drive the
    // platform text-insertion sequence: fire a cancelable `beforeinput`, and
    // only write `textContent` ourselves if nothing handled it. Model-driven
    // editors (ProseMirror, Lexical, Draft) consume `beforeinput` and insert
    // into their own document model — writing `textContent` under them would
    // just get reverted — so when the event is handled we leave the DOM alone.
    // Plain contenteditable has no such listener, so we do the write. This is
    // best-effort: an editor that only inserts from a real caret/Selection may
    // still need key simulation. `isContentEditable` covers real browsers
    // (incl. inherited editability); the attribute check is the jsdom fallback.
    const htmlEl = element as HTMLElement;
    const ceAttr = htmlEl.getAttribute("contenteditable");
    const editable =
      htmlEl.isContentEditable ||
      ceAttr === "" ||
      ceAttr === "true" ||
      ceAttr === "plaintext-only";
    if (editable) {
      const notHandled = htmlEl.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value,
        }),
      );
      if (notHandled) {
        htmlEl.textContent = value;
        htmlEl.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: value,
          }),
        );
      }
      return { success: true };
    }

    return { success: false, error: "Element does not accept text input" };
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

  // Slider / spinbutton step. Native <input type="range"|"number"> have a
  // .stepUp() / .stepDown() API and emit input/change automatically — use
  // it so the DOM `value` and the visual thumb stay in sync without going
  // through the keyboard path. Custom ARIA widgets (Radix Slider span,
  // headless date pickers, etc.) listen for ArrowRight/ArrowLeft on the
  // element itself, so focus the element first and dispatch a full
  // keydown+keyup pair. Works under the Screen Curtain because nothing
  // here depends on the user seeing the page — the panel drives the value
  // change end-to-end.
  private handleStep(element: Element, delta: 1 | -1): ActionResult {
    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      const input = element as HTMLInputElement;
      const type = input.type;
      if (type === "range" || type === "number") {
        try {
          if (delta > 0) input.stepUp();
          else input.stepDown();
        } catch {
          // stepUp/stepDown throw on invalid configurations — fall through
          // to the keyboard path so the user still gets feedback.
          return this.dispatchArrowStep(element, delta);
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
    }
    return this.dispatchArrowStep(element, delta);
  }

  // Dispatch ArrowRight/ArrowLeft on the slider widget. Custom ARIA
  // widgets (Radix Slider span, Headless UI, etc.) install the
  // keyboard listener on the slider element itself, so dispatching
  // directly on the element fires the handler regardless of which
  // element currently holds focus. We deliberately do NOT call
  // `element.focus()` here — that would steal focus from the panel
  // button the user just clicked, and (worse) advance focus to
  // whatever follows the slider in the document tab order once the
  // user's next keystroke goes anywhere but back to the panel.
  //
  // Focus restoration is done in two stages:
  //
  //   1. Synchronous, immediately after dispatch — covers widgets
  //      that move focus to themselves *inside* their keydown
  //      handler (which runs synchronously during dispatchEvent).
  //   2. Deferred via setTimeout(0) — covers Radix-style widgets
  //      that schedule a focus call through React state + re-render,
  //      which lands on a microtask/RAF boundary after dispatchEvent
  //      returns. Without this second stage the slider thumb steals
  //      focus from the panel button the user clicked.
  //
  // Both stages no-op when focus is already where we want it, so
  // doing both is idempotent and rapid clicks behave correctly.
  private dispatchArrowStep(element: Element, delta: 1 | -1): ActionResult {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const key = delta > 0 ? "ArrowRight" : "ArrowLeft";
    const code = delta > 0 ? "ArrowRight" : "ArrowLeft";
    const keyCode = delta > 0 ? 39 : 37;
    const init: KeyboardEventInit = {
      key,
      code,
      keyCode,
      bubbles: true,
      cancelable: true,
    };
    element.dispatchEvent(new KeyboardEvent("keydown", init));
    element.dispatchEvent(new KeyboardEvent("keyup", init));
    this.restoreFocus(previouslyFocused);
    setTimeout(() => this.restoreFocus(previouslyFocused), 0);
    return { success: true };
  }

  private restoreFocus(previouslyFocused: HTMLElement | null): void {
    if (
      previouslyFocused &&
      document.activeElement !== previouslyFocused &&
      previouslyFocused.isConnected
    ) {
      previouslyFocused.focus?.({ preventScroll: true });
    }
  }
}
