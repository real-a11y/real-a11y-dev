/**
 * The functions that run INSIDE the page under test, serialized by
 * {@link CdpActionBackend} and handed to `Runtime.callFunctionOn`.
 *
 * ## Why these are written the way they are
 *
 * Each function is passed to CDP as `String(fn)` — its **source text**, not a
 * closure. Everything a function needs must therefore live inside its own body:
 * no imports, no module-scope constants, no shared helpers. That is why the
 * composite-role list and the text-entry type list are re-declared inside each
 * function instead of being hoisted to module scope, and why these read more
 * repetitively than the rest of the package. Hoisting any of it produces a
 * `ReferenceError` in the page, not a compile error here.
 *
 * The same constraint rules out calling into the injected page bundle
 * (`window.__realA11y__`): `Runtime.callFunctionOn` is not subject to the page's
 * CSP, but `addScriptTag` injection is, so a strict-CSP page can act even where
 * the bundle can't be installed. Keeping the action path injection-free is the
 * whole reason it works there.
 *
 * ## Relationship to core's ActionDispatcher
 *
 * These mirror `@real-a11y-dev/core`'s `ActionDispatcher` — the in-page
 * dispatcher the extension, Storybook panel, and testing adapter use. That
 * dispatcher earned its behavior from real pages: bare `element.click()` no-ops
 * on jsaction/Material handlers that gate on a pointer sequence, and clicks on
 * composite-widget wrappers (Drive's `treeitem` rows) miss the delegated
 * handler entirely. The CDP backend shipped without either, so it silently
 * no-op'd on exactly those pages.
 *
 * The duplication is deliberate (see the serialization constraint) and is
 * pinned by the parity tests in `page-actions.test.ts`, which run core's
 * dispatcher and these functions over identical fixtures and compare the
 * observable result. **Two divergences are intentional:**
 *
 * 1. **Errors carry no page text.** Core catches and surfaces `err.message`,
 *    which can quote page content — forbidden on this path by R1. These don't
 *    catch at all: a throw propagates to `Runtime.callFunctionOn`, which
 *    reports it as `exceptionDetails`, and the backend maps that to a fixed
 *    content-free failure. (Note that a *listener* throwing during
 *    `dispatchEvent` reaches neither: the DOM routes it to the page's global
 *    error handler and dispatch continues, in core exactly as it does here.)
 * 2. **`focus` reports the field's real `type`** (`"email"`, `"search"`) where
 *    core always reports `"text"`. The attribute is structural, not content,
 *    and `focus_element` surfaces it so an agent knows what it just focused.
 */

/* eslint-disable @typescript-eslint/no-this-alias --
 * `Runtime.callFunctionOn` invokes these with the target element as `this`, so
 * the element genuinely arrives that way. The local alias is not stylistic:
 * TypeScript narrows a `const` (`el instanceof HTMLInputElement`) but will not
 * narrow `this`, and the type path depends on that narrowing to keep a custom
 * element away from the native value setter. */

/**
 * The only shape these functions may return. Structural markers exclusively —
 * never the typed text, the element's value, or any other page content.
 */
export interface PageActionMarker {
  ok: boolean;
  /** Stable, content-free failure cause. */
  reason?: string;
  /** `focus` only: the target accepts text entry, so a `type` may follow. */
  requiresInput?: boolean;
  /** `focus` only: the field's `type` attribute (or tag name for a textarea). */
  inputType?: string;
}

/**
 * Click, the way a real user's pointer does it.
 *
 * Fires the full `pointerdown → mousedown → pointerup → mouseup → click`
 * sequence rather than `element.click()` (which fires `click` alone), and
 * redirects a click on a composite-widget wrapper to the interactive descendant
 * that actually carries the handler — a delegated `event.target.closest(…)`
 * walk goes *upward*, so dispatching on the wrapper misses it.
 */
export function pageClick(this: Element): PageActionMarker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };

  // Composite-widget children are commonly containers wrapping the real
  // control. querySelector returns document order — the row's primary
  // action, not an inner chevron. Well-formed ARIA matches nothing and the
  // wrapper is used unchanged.
  let target: Element = el;
  const role = el.getAttribute("role") || "";
  const composite = [
    "treeitem",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "tab",
    "row",
    "gridcell",
    "cell",
  ];
  if (composite.indexOf(role) !== -1) {
    const inner = el.querySelector(
      '[role="link"], [role="button"], a[href], button',
    );
    if (inner) target = inner;
  }

  const base = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const pointer = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    pointerType: "mouse",
    isPrimary: true,
  };
  target.dispatchEvent(new PointerEvent("pointerdown", pointer));
  target.dispatchEvent(new MouseEvent("mousedown", base));
  target.dispatchEvent(new PointerEvent("pointerup", pointer));
  target.dispatchEvent(new MouseEvent("mouseup", base));
  target.dispatchEvent(new MouseEvent("click", base));
  return { ok: true };
}

/**
 * Move real keyboard focus, and report whether the target takes text entry.
 *
 * The text-entry check is an **allow**-list of input types, matching core.
 * (The list this replaced was a deny-list, which wrongly reported
 * `<input type="image">` — and any future input type — as typeable.)
 */
export function pageFocus(this: Element): PageActionMarker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  const focusable = el as HTMLElement;
  if (typeof focusable.focus !== "function") {
    return { ok: false, reason: "not-focusable" };
  }
  focusable.focus();

  const tag = el.tagName.toLowerCase();
  const textEntryTypes = [
    "text",
    "email",
    "password",
    "tel",
    "url",
    "search",
    "number",
    "date",
    "time",
    "datetime-local",
    "month",
    "week",
    "color",
  ];
  const editableAttr = el.getAttribute("contenteditable");
  const role = el.getAttribute("role");

  let acceptsText = false;
  let inputType = tag;
  if (tag === "textarea") {
    acceptsText = true;
  } else if (tag === "input") {
    inputType = (el.getAttribute("type") || "text").toLowerCase();
    acceptsText = textEntryTypes.indexOf(inputType) !== -1;
  } else if (
    focusable.isContentEditable === true ||
    editableAttr === "" ||
    editableAttr === "true" ||
    editableAttr === "plaintext-only"
  ) {
    acceptsText = true;
  } else if (
    role === "textbox" ||
    role === "searchbox" ||
    role === "spinbutton"
  ) {
    acceptsText = true;
  }

  return acceptsText
    ? { ok: true, requiresInput: true, inputType }
    : { ok: true };
}

/**
 * Replace a field's value.
 *
 * Native `<input>`/`<textarea>` go through the element's own prototype setter
 * so framework-controlled inputs (React et al.) observe the change. Custom
 * ARIA textboxes are usually contenteditable, where a raw `textContent` write
 * is wrong: model-driven editors (ProseMirror, Lexical, Draft) consume
 * `beforeinput` and insert into their own document model, then revert the DOM
 * underneath us. So fire a cancelable `beforeinput` first and only write when
 * nothing handled it.
 *
 * R1: the marker never carries `text` or the element's resulting value.
 */
export function pageType(this: Element, text: string): PageActionMarker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  // `instanceof` (not a tagName check) keeps a custom element from ever
  // reaching a native setter — the setters brand-check their receiver and
  // throw on the wrong element type.
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) descriptor.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  const editable = el as HTMLElement;
  const editableAttr = editable.getAttribute("contenteditable");
  const isEditable =
    editable.isContentEditable === true ||
    editableAttr === "" ||
    editableAttr === "true" ||
    editableAttr === "plaintext-only";
  if (isEditable) {
    const notHandled = editable.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );
    if (notHandled) {
      editable.textContent = text;
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }),
      );
    }
    return { ok: true };
  }

  return { ok: false, reason: "not-a-text-field" };
}
