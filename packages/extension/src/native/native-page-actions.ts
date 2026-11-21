/**
 * The in-page actions that report a structural marker: click, focus, reveal,
 * preview, step and select an option. Each is serialized with `String(fn)`
 * and run through `Runtime.callFunctionOn` by `native-core.ts`, which
 * re-exports them.
 */

/** What an in-page action reports back: structure only, never a value. */
export type Marker = { ok?: boolean; reason?: string };

/* eslint-disable @typescript-eslint/no-this-alias --
 * `Runtime.callFunctionOn` invokes these with the target element as `this`, so
 * the element genuinely arrives that way. The local alias is not stylistic:
 * TypeScript narrows a `const` (`el instanceof HTMLInputElement`) but will not
 * narrow `this`, and the type path depends on that narrowing to keep a custom
 * element away from the native value setter. */

/*
 * ── The functions that run INSIDE the page ──────────────────────────────────
 *
 * Each is serialized with `String(fn)` and handed to `Runtime.callFunctionOn`
 * as SOURCE TEXT, not a closure. Everything a function needs must live in its
 * own body: no imports, no module-scope constants, no shared helpers. That is
 * why the composite-role list is declared inside the function rather than
 * hoisted — hoisting produces a `ReferenceError` in the page, not a compile
 * error here. Writing them as real functions (rather than template strings) is
 * what gets them type-checked and linted at all.
 *
 * **Deliberate mirror.** These mirror `@real-a11y-dev/browser`'s
 * `page-actions.ts`, which in turn mirrors core's in-page `ActionDispatcher`.
 * The serialization constraint is what forces a copy instead of an import, and
 * neither original is reachable here: `browser` carries Playwright (no good in
 * an MV3 worker), and core's dispatcher lives *in the page* — precisely what
 * the native path deliberately works without. Sharing via `core` was measured
 * and rejected: core sits ~30 bytes under its gzip budget.
 *
 * The behaviour is not arbitrary — it was earned on real pages. A bare
 * `element.click()` fires `click` alone and silently no-ops on jsaction/Material
 * handlers that gate on a pointer sequence; a click on a composite-widget
 * wrapper misses the delegated handler, which walks *upward* from the target.
 * A raw `textContent` write loses to model-driven editors (ProseMirror, Lexical,
 * Draft), which consume `beforeinput` and then revert the DOM underneath.
 *
 * R1: a marker carries structure only — never the typed text or the element's
 * resulting value.
 */

/** Click the way a real pointer does, redirecting composite wrappers. */
export function pageClick(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };

  // Composite-widget children are commonly containers wrapping the real
  // control. querySelector returns document order — the row's primary action,
  // not an inner chevron. Well-formed ARIA matches nothing and the wrapper is
  // used unchanged.
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
 * Move real keyboard focus — the `focus` action, the same plain call as
 * `browser`'s own `pageFocus`: the browser may scroll to the element, and
 * success means the call was made, not that focus moved (a heading without
 * a `tabindex` ignores it). Selecting a row doesn't come through here; that
 * is {@link pageReveal}, which focuses without scrolling.
 */
export function pageFocus(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  const focusable = el as HTMLElement;
  if (typeof focusable.focus !== "function") {
    return { ok: false, reason: "not-focusable" };
  }
  focusable.focus();
  return { ok: true };
}

/**
 * Show the user where a selected native row lives on the page — the native
 * tree's counterpart to a TAB row's `HIGHLIGHT_NODE` on select. `nonce` is
 * the one the content script was armed with; it honours only the event that
 * carries it.
 *
 * Real focus alone is not a visible indicator: Chromium paints no focus ring
 * in a page whose window isn't focused, and while the user drives the side
 * panel, the inspected page never is. The DOM producer's visible indicator is
 * the content script's overlay (`FocusManager.highlightElement`), so this
 * asks for exactly that: it fires a DOM event on the element, which crosses
 * from this main-world call into the content script's isolated world, and
 * the content script draws its overlay on the event's own target. Keyed to
 * the element itself, it needs no node-id mapping between the two producers.
 * For a control inside a closed UA shadow root (a `<video>`'s built-in
 * buttons), the event reaches the content script retargeted to the host, so
 * the outline frames the whole `<video>` while focus lands on the control.
 * A node with no backing DOM element (`ax-<n>`) can't be revealed at all.
 * The event name is repeated in `content.ts` — this function is serialized
 * as source text, so it can't import a shared constant.
 *
 * Then moves real focus too, without scrolling (the overlay already
 * centered it), so keyboard use resumes from here when the user returns to
 * the page. A heading or landmark can't take focus; it still gets the
 * overlay, so the row counts as revealed either way.
 */
export function pageReveal(this: Element, nonce: string): Marker {
  // A `text` row is backed by a text node, which takes no outline and no
  // focus: the element it is text of stands for it.
  // eslint-disable-next-line no-restricted-properties -- read on a text node, which is never a <form>
  const el = (this as Node)?.nodeType === 3 ? this.parentElement : this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  // Through the prototypes, not `el.dispatchEvent`/`el.focus`: a `<form>`
  // holding `<input name="dispatchEvent">` shadows the method with the input,
  // and this runs on every settled selection, form landmarks included. It
  // doesn't bubble (the content script catches it on the way down), so page
  // listeners below the document never see it; `composed` lets it leave an
  // open shadow root.
  EventTarget.prototype.dispatchEvent.call(
    el,
    new CustomEvent("real-a11y:native-reveal", {
      bubbles: false,
      composed: true,
      detail: nonce,
    }),
  );
  const proto =
    el instanceof HTMLElement
      ? HTMLElement.prototype
      : el instanceof SVGElement
        ? SVGElement.prototype
        : null;
  proto?.focus.call(el, { preventScroll: true });
  return { ok: true };
}

/**
 * Outline a hovered native row's element on the page, and nothing more — a
 * hover preview. The same content-script
 * overlay as {@link pageReveal}, under its own event name and with no focus:
 * a hover is a preview, so the page neither scrolls nor moves focus
 * (`planHighlight` in `routing.ts` has the reasons). A separate
 * event rather than a flag in `detail`, so the content script decides what to
 * draw by the event's name and the arm it holds, and reads nothing else a
 * page-world object carries. Like the reveal's, it doesn't bubble and carries
 * the arm's nonce, so page listeners below the document never see it and the
 * page can't forge one. The event name is repeated in `content.ts`.
 */
export function pagePreview(this: Element, nonce: string): Marker {
  // As in pageReveal: a text node's element is the one it is text of.
  // eslint-disable-next-line no-restricted-properties -- read on a text node, which is never a <form>
  const el = (this as Node)?.nodeType === 3 ? this.parentElement : this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  EventTarget.prototype.dispatchEvent.call(
    el,
    new CustomEvent("real-a11y:native-preview", {
      bubbles: false,
      composed: true,
      detail: nonce,
    }),
  );
  return { ok: true };
}

/**
 * Step a value-bearing control by one unit — native `stepUp()`/`stepDown()`
 * for a real `<input type="range"|"number">`, else dispatch `ArrowRight`/
 * `ArrowLeft` on the element itself. Mirrors core's `ActionDispatcher`'s
 * `handleStep`/`dispatchArrowStep`
 * (`core/src/interaction/action-dispatcher.ts`) exactly, inlined for the
 * same reason every other in-page function here is: serialized as source
 * text for `Runtime.callFunctionOn`, so no imports or module-scope
 * references survive the trip. One function taking a signed `delta`, not
 * two — matching `handleStep`'s own shape rather than duplicating the whole
 * body per direction.
 *
 * Custom ARIA sliders (Radix, Headless UI, the W3C APG examples themselves)
 * install their keyboard listener on the slider element itself, so
 * dispatching there reaches the handler regardless of which element
 * currently holds focus — but a real, common share of them additionally
 * gate the handler on `document.activeElement === this` (a reasonable
 * assumption for hand-written widget code: a real user can only reach the
 * handler by having tabbed to the thumb first). Live dogfood finding:
 * "still unable to interact with the sliders" on the W3C multi-thumb
 * example — this function's marker reported `{ ok: true }` (the events
 * genuinely dispatched) while `aria-valuenow` never moved, because the
 * dogfooder's last real focus was the panel button, not the thumb. This
 * DIVERGES from core's `dispatchArrowStep`, which still doesn't call
 * `.focus()` first (see its own comment) — that decision predates this
 * finding and core has no report against it yet; the fix belongs here
 * until (or unless) the same gap is confirmed on the DOM producer too.
 *
 * `el.focus()` up front is safe specifically because the very next thing
 * this function does is the two-stage restore that already existed for a
 * different reason (a widget that moves focus to ITSELF as a side effect of
 * handling the key) — that restore doesn't care why focus moved, only that
 * it isn't where it started, so it undoes our own upfront call exactly the
 * same way. Restored in two stages, matching the DOM producer exactly:
 * synchronously (covers a widget that moves focus to itself inside its own
 * synchronous keydown handler, or nothing moving it at all, in which case
 * this undoes our own `.focus()` call) and via `setTimeout(0)` (covers a
 * Radix-style widget that schedules its OWN focus call through a state
 * update + re-render, landing on a microtask/RAF boundary after this
 * function has already returned).
 */
export function pageStep(this: Element, delta: number): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const input = el as HTMLInputElement;
    if (input.type === "range" || input.type === "number") {
      // Only stepUp()/stepDown() go in the try, matching core's own
      // handleStep exactly — dispatchEvent is never expected to throw (a
      // listener's own exception is reported to the global error handler,
      // not propagated back to the caller), so it stays outside the catch
      // that exists for an invalid step configuration. Keeping it outside
      // means a step can never double-fire: the native step already
      // succeeded by the time these run, so nothing here should fall
      // through to the keyboard path below.
      let stepped = false;
      try {
        if (delta > 0) input.stepUp();
        else input.stepDown();
        stepped = true;
      } catch {
        // stepUp/stepDown throw on an invalid configuration (e.g. already at
        // a bound with no step) — fall through to the keyboard path below so
        // the dogfooder still gets an attempt rather than a bare failure.
      }
      if (stepped) {
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
    }
  }

  const previouslyFocused = document.activeElement as HTMLElement | null;
  (el as HTMLElement).focus?.({ preventScroll: true });
  const key = delta > 0 ? "ArrowRight" : "ArrowLeft";
  const init: KeyboardEventInit = {
    key,
    code: key,
    keyCode: delta > 0 ? 39 : 37,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  const restore = (): void => {
    if (
      previouslyFocused &&
      document.activeElement !== previouslyFocused &&
      previouslyFocused.isConnected
    ) {
      previouslyFocused.focus?.({ preventScroll: true });
    }
  };
  restore();
  setTimeout(restore, 0);
  return { ok: true };
}

/**
 * Choose a native `<option>` the way the DOM producer's own `handleSelect`
 * does for the `<select>` it belongs to — set the select's value and fire
 * `change` — rather than clicking it. Live dogfood finding: a native
 * `<select>`'s options (Chromium normalizes it to `combobox` →
 * `option` on the native tree, e.g. Amazon's department
 * dropdown) showed up on the tree but had no way to act on them, matching
 * `ACTABLE`'s own long-standing exclusion of `option` — a synthetic click on
 * a real `<option>` is a no-op, since the browser renders the open list as
 * OS chrome, not DOM the click model reaches. This is a DEDICATED action,
 * not a `click` alias: `this instanceof HTMLOptionElement` is checked
 * in-page, against the live element, at dispatch time — the one place this
 * codebase can tell a real `<option>` apart from a custom
 * `role="option"` widget (impossible from the native tree's role-only data
 * alone, the reason `ACTABLE` stayed silent on it). A custom widget refuses
 * cleanly (`not-an-option`) rather than misfiring a wrong action.
 *
 * The panel's option picker only opens for a real `<select>` (a combobox whose
 * children are options, see `nativeSelectOptions`), so a `not-an-option`
 * refusal there means the page changed under the tree since it was read.
 * It reports "Failed:" rather than falling back to a click: a click on what
 * is now some other element would act blind. Refresh is the way back.
 */
export function pageSelectOption(this: Element): Marker {
  const el = this;
  if (!el || !el.tagName) return { ok: false, reason: "not-element" };
  if (!(el instanceof HTMLOptionElement)) {
    return { ok: false, reason: "not-an-option" };
  }
  const select = el.closest("select");
  if (!select) return { ok: false, reason: "no-select-ancestor" };
  // A disabled option (or one in a disabled `<optgroup>`), or a disabled
  // select, can't be chosen on the page, so it can't be from the tree either.
  if (el.disabled || select.disabled || el.matches(":disabled")) {
    return { ok: false, reason: "disabled" };
  }
  select.value = el.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}

/* eslint-enable @typescript-eslint/no-this-alias */
