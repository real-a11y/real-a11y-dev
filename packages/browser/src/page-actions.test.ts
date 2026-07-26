// @vitest-environment jsdom
//
// The rest of this package's unit tests are Node-side (URL gating, option
// shaping), but these functions are DOM code that happens to be *delivered*
// over CDP — so they're tested as DOM code, against the same jsdom the core
// dispatcher they mirror is tested in.

import { ActionDispatcher, ElementRefMap } from "@real-a11y-dev/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pageClick, pageFocus, pageType } from "./page-actions.js";

/** Call an in-page function the way `Runtime.callFunctionOn` does: as `this`. */
function on<A extends unknown[], R>(
  fn: (this: Element, ...args: A) => R,
  el: Element,
  ...args: A
): R {
  return fn.call(el, ...args);
}

/** Record the event types an element sees, in order. */
function record(el: Element, types: string[]): string[] {
  const seen: string[] = [];
  for (const type of types) el.addEventListener(type, () => seen.push(type));
  return seen;
}

const POINTER_SEQUENCE = [
  "pointerdown",
  "mousedown",
  "pointerup",
  "mouseup",
  "click",
];

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("pageClick", () => {
  it("fires the full pointer/mouse/click sequence, not a bare click", () => {
    // Regression: the CDP backend used to call `element.click()`, which fires
    // `click` alone. jsaction / Material-ripple handlers gate on the pointer
    // sequence, so those pages saw nothing and the tool still reported success.
    const el = document.createElement("button");
    document.body.appendChild(el);
    const seen = record(el, POINTER_SEQUENCE);

    expect(on(pageClick, el)).toEqual({ ok: true });
    expect(seen).toEqual(POINTER_SEQUENCE);
  });

  it("triggers a pointerdown-only handler (the jsaction failure mode)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const handler = vi.fn();
    el.addEventListener("pointerdown", handler);

    expect(on(pageClick, el)).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("redirects a click on a treeitem wrapper to its inner link (Drive shape)", () => {
    // The wrapper has no handler; the real one is delegated and finds its
    // target with closest(). Dispatching on the wrapper sets event.target to
    // the wrapper, whose closest() walk goes upward — away from the link — so
    // the handler no-ops.
    const row = document.createElement("div");
    row.setAttribute("role", "treeitem");
    const link = document.createElement("a");
    link.setAttribute("href", "#doc");
    row.appendChild(link);
    document.body.appendChild(row);

    const targets: (EventTarget | null)[] = [];
    row.addEventListener("click", (e) => targets.push(e.target));

    expect(on(pageClick, row)).toEqual({ ok: true });
    expect(targets).toEqual([link]);
  });

  it("leaves a well-formed composite wrapper alone when it owns the handler", () => {
    // Reach/Radix/APG shape: the treeitem itself is the control. Nothing
    // matches the descendant query, so the wrapper is clicked unchanged.
    const row = document.createElement("div");
    row.setAttribute("role", "treeitem");
    row.appendChild(document.createTextNode("Report.pdf"));
    document.body.appendChild(row);

    const targets: (EventTarget | null)[] = [];
    row.addEventListener("click", (e) => targets.push(e.target));

    expect(on(pageClick, row)).toEqual({ ok: true });
    expect(targets).toEqual([row]);
  });
});

describe("pageFocus", () => {
  it("focuses and flags a text field with its real input type", () => {
    const input = document.createElement("input");
    input.type = "email";
    document.body.appendChild(input);

    expect(on(pageFocus, input)).toEqual({
      ok: true,
      requiresInput: true,
      inputType: "email",
    });
    expect(document.activeElement).toBe(input);
  });

  it("does not call <input type=image> a text field", () => {
    // Regression: the replaced check was a deny-list that excluded only
    // button/submit/reset/checkbox/radio/file/range/hidden — so an image
    // button (and every input type added since) was advertised as typeable.
    const input = document.createElement("input");
    input.type = "image";
    document.body.appendChild(input);

    expect(on(pageFocus, input)).toEqual({ ok: true });
  });

  it("flags a contenteditable and an ARIA textbox", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const ariaBox = document.createElement("span");
    ariaBox.setAttribute("role", "textbox");
    ariaBox.tabIndex = 0;
    document.body.append(editable, ariaBox);

    expect(on(pageFocus, editable).requiresInput).toBe(true);
    expect(on(pageFocus, ariaBox).requiresInput).toBe(true);
  });

  it("refuses an element that cannot take focus", () => {
    // `focus()` comes from the HTMLOrSVGElement mixin, so HTML *and* SVG
    // elements all have it. An element in some other namespace is a plain
    // Element with no focus method at all — the case the guard is for.
    const el = document.createElementNS("urn:example:widgets", "dial");
    document.body.appendChild(el);

    expect(on(pageFocus, el)).toEqual({ ok: false, reason: "not-focusable" });
  });
});

describe("pageType", () => {
  it("writes through the prototype setter and fires input + change", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const seen = record(input, ["input", "change"]);

    expect(on(pageType, input, "hello")).toEqual({ ok: true });
    expect(input.value).toBe("hello");
    expect(seen).toEqual(["input", "change"]);
  });

  it("writes into a textarea through its own prototype setter", () => {
    // The input and textarea setters brand-check their receiver and throw on
    // the wrong element type, so the prototype must match the element.
    const area = document.createElement("textarea");
    document.body.appendChild(area);

    expect(on(pageType, area, "multi\nline")).toEqual({ ok: true });
    expect(area.value).toBe("multi\nline");
  });

  it("leaves the DOM alone when an editor consumes beforeinput", () => {
    // Regression: the CDP backend wrote `textContent` unconditionally.
    // ProseMirror/Lexical/Draft insert into their own model from beforeinput
    // and then re-render, reverting our write — so the text appeared to land
    // and then vanished.
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.textContent = "model-owned";
    document.body.appendChild(editor);

    const handled = vi.fn((e: Event) => e.preventDefault());
    editor.addEventListener("beforeinput", handled);

    expect(on(pageType, editor, "typed")).toEqual({ ok: true });
    expect(handled).toHaveBeenCalledOnce();
    expect(editor.textContent).toBe("model-owned");
  });

  it("writes plain contenteditable itself when nothing handles beforeinput", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    const seen = record(editable, ["input"]);

    expect(on(pageType, editable, "typed")).toEqual({ ok: true });
    expect(editable.textContent).toBe("typed");
    expect(seen).toEqual(["input"]);
  });

  it("refuses an element that takes no text", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    expect(on(pageType, el, "x")).toEqual({
      ok: false,
      reason: "not-a-text-field",
    });
  });

  it("never returns the typed text (R1)", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const secret = "hunter2-lives-here";

    const marker = on(pageType, input, secret);
    expect(JSON.stringify(marker)).not.toContain("hunter2");
    expect(input.value).toBe(secret); // it did land in the page
  });
});

describe("parity with core's ActionDispatcher", () => {
  // These functions are hand-mirrored from core because they must serialize to
  // self-contained source (see the module docstring). That duplication is only
  // safe if it's pinned: run both implementations over identical DOM and
  // require the same observable outcome.
  function bothWays(build: () => Element): {
    viaCore: string[];
    viaPage: string[];
  } {
    const types = [...POINTER_SEQUENCE, "input", "change"];

    document.body.innerHTML = "";
    const coreEl = build();
    const refs = new ElementRefMap();
    refs.set("n1", coreEl);
    const viaCore = record(coreEl, types);
    new ActionDispatcher(refs).dispatch({ nodeId: "n1", action: "click" });

    document.body.innerHTML = "";
    const pageEl = build();
    const viaPage = record(pageEl, types);
    on(pageClick, pageEl);

    return { viaCore, viaPage };
  }

  it("clicks a plain button identically", () => {
    const { viaCore, viaPage } = bothWays(() => {
      const el = document.createElement("button");
      document.body.appendChild(el);
      return el;
    });
    expect(viaPage).toEqual(viaCore);
    expect(viaPage).toEqual(POINTER_SEQUENCE);
  });

  it("retargets a composite wrapper identically", () => {
    const { viaCore, viaPage } = bothWays(() => {
      const row = document.createElement("div");
      row.setAttribute("role", "menuitem");
      const link = document.createElement("a");
      link.setAttribute("href", "#go");
      row.appendChild(link);
      document.body.appendChild(row);
      return row;
    });
    // Both retarget to the inner link, so the wrapper sees the bubbled events
    // in the same order — and neither dispatches directly on the wrapper.
    expect(viaPage).toEqual(viaCore);
  });

  it("agrees on which elements accept text entry", () => {
    // core reports requiresInput; these report the same boolean (with a more
    // specific inputType, the one intentional divergence).
    const cases: [string, string | null][] = [
      ["input", "text"],
      ["input", "email"],
      ["input", "checkbox"],
      ["input", "image"],
      ["input", "file"],
      ["textarea", null],
      ["div", null],
    ];

    for (const [tag, type] of cases) {
      document.body.innerHTML = "";
      const build = () => {
        const el = document.createElement(tag);
        if (type) el.setAttribute("type", type);
        document.body.appendChild(el);
        return el;
      };

      const coreEl = build();
      const refs = new ElementRefMap();
      refs.set("n1", coreEl);
      const coreResult = new ActionDispatcher(refs).dispatch({
        nodeId: "n1",
        action: "focus",
      });

      document.body.innerHTML = "";
      const pageResult = on(pageFocus, build());

      expect(
        { tag, type, requiresInput: pageResult.requiresInput === true },
        `${tag}[type=${type}]`,
      ).toEqual({
        tag,
        type,
        requiresInput: coreResult.requiresInput === true,
      });
    }
  });

  it("types into a native input identically", () => {
    document.body.innerHTML = "";
    const coreEl = document.createElement("input");
    document.body.appendChild(coreEl);
    const refs = new ElementRefMap();
    refs.set("n1", coreEl);
    const coreSeen = record(coreEl, ["input", "change"]);
    new ActionDispatcher(refs).dispatch({
      nodeId: "n1",
      action: "type",
      payload: { value: "shared" },
    });

    document.body.innerHTML = "";
    const pageEl = document.createElement("input");
    document.body.appendChild(pageEl);
    const pageSeen = record(pageEl, ["input", "change"]);
    on(pageType, pageEl, "shared");

    expect(pageSeen).toEqual(coreSeen);
    expect(pageEl.value).toBe(coreEl.value);
  });
});
