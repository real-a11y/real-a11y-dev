import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ElementRefMap } from "../utils/element-ref.js";

import { ActionDispatcher } from "./action-dispatcher.js";

describe("ActionDispatcher", () => {
  let refs: ElementRefMap;
  let dispatcher: ActionDispatcher;

  beforeEach(() => {
    document.body.innerHTML = "";
    refs = new ElementRefMap();
    dispatcher = new ActionDispatcher(refs);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("click action", () => {
    it("fires the full pointer/mouse/click sequence in order", () => {
      // Regression: handleClick used to dispatch only a synthetic
      // MouseEvent("click"). Google apps (Drive, Gmail) wire their handlers
      // through jsaction + Material ripple, which expects pointerdown →
      // mousedown → pointerup → mouseup → click. Bare clicks no-op'd silently
      // on every treeitem and tab in the Drive side panel.
      const el = document.createElement("button");
      document.body.appendChild(el);
      refs.set("n1", el);

      const seen: string[] = [];
      for (const type of [
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
      ]) {
        el.addEventListener(type, () => seen.push(type));
      }

      const result = dispatcher.dispatch({ nodeId: "n1", action: "click" });

      expect(result.success).toBe(true);
      expect(seen).toEqual([
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
      ]);
    });

    it("triggers a pointerdown-only handler (the jsaction failure mode)", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      refs.set("n1", el);

      const handler = vi.fn();
      el.addEventListener("pointerdown", handler);

      dispatcher.dispatch({ nodeId: "n1", action: "click" });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("bubbles so delegated listeners on ancestors fire", () => {
      const root = document.createElement("div");
      const target = document.createElement("button");
      root.appendChild(target);
      document.body.appendChild(root);
      refs.set("n1", target);

      const delegated = vi.fn();
      root.addEventListener("click", delegated);

      dispatcher.dispatch({ nodeId: "n1", action: "click" });

      expect(delegated).toHaveBeenCalledTimes(1);
    });

    it("redirects clicks on a treeitem container to its inner role=link descendant (Drive shape)", () => {
      // Regression: Drive's tree wraps each row in `<div role="treeitem">`
      // with no event handler. The actual click handler is delegated and
      // looks for `event.target.closest('[data-target="node"]')` on a
      // descendant `<div role="link" data-target="node">`. Dispatching on
      // the wrapper made event.target the wrapper, the closest() walk went
      // upward, the handler returned null, and every Drive tree click was
      // a silent no-op even after the pointer-sequence fix in #21.
      document.body.innerHTML = `
        <div role="treeitem" id="row">
          <div role="link" data-target="node" id="link">
            <div data-target="expander" id="exp">▸</div>
            <span>Home</span>
          </div>
        </div>
      `;
      const row = document.getElementById("row")!;
      const link = document.getElementById("link")!;
      const exp = document.getElementById("exp")!;
      refs.set("n1", row);

      const linkClicks = vi.fn();
      const expanderClicks = vi.fn();
      link.addEventListener("click", (e) => linkClicks(e.target));
      exp.addEventListener("click", expanderClicks);

      dispatcher.dispatch({ nodeId: "n1", action: "click" });

      expect(linkClicks).toHaveBeenCalledTimes(1);
      // event.target should be the link (or a descendant of it), not the
      // expander — the resolver explicitly skips expander descendants.
      const target = linkClicks.mock.calls[0]![0] as Element;
      expect(link.contains(target)).toBe(true);
      expect(exp.contains(target)).toBe(false);
    });

    it("falls through to the wrapper when no interactive descendant is present", () => {
      // For well-formed ARIA where the treeitem itself owns the click
      // handler (ARIA Authoring Practices reference impl, Material UI),
      // the resolver should NOT redirect.
      document.body.innerHTML = `
        <div role="treeitem" id="row">
          <span>Home</span>
        </div>
      `;
      const row = document.getElementById("row")!;
      refs.set("n1", row);

      const onClick = vi.fn();
      row.addEventListener("click", (e) => onClick(e.target));

      dispatcher.dispatch({ nodeId: "n1", action: "click" });

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onClick.mock.calls[0]![0]).toBe(row);
    });

    it("does not redirect for non-composite-child roles", () => {
      // A regular button containing a span shouldn't have its click
      // redirected to the span — the button is the natural target.
      document.body.innerHTML = `
        <button id="btn"><span id="inner">Click me</span></button>
      `;
      const btn = document.getElementById("btn")!;
      refs.set("n1", btn);

      const onClick = vi.fn();
      btn.addEventListener("click", (e) => onClick(e.target));

      dispatcher.dispatch({ nodeId: "n1", action: "click" });

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onClick.mock.calls[0]![0]).toBe(btn);
    });

    it("redirects menuitem container clicks to a nested role=button child", () => {
      // Same shape as treeitem — Gmail-style menuitem wrappers.
      document.body.innerHTML = `
        <div role="menuitem" id="row">
          <div role="button" id="action">Open</div>
        </div>
      `;
      const row = document.getElementById("row")!;
      const action = document.getElementById("action")!;
      refs.set("n1", row);

      const onAction = vi.fn();
      action.addEventListener("click", onAction);

      dispatcher.dispatch({ nodeId: "n1", action: "click" });

      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("type action", () => {
    it("writes the value into an <input>", () => {
      const input = document.createElement("input");
      input.type = "text";
      document.body.appendChild(input);
      refs.set("n1", input);

      const result = dispatcher.dispatch({
        nodeId: "n1",
        action: "type",
        payload: { value: "hello" },
      });

      expect(result.success).toBe(true);
      expect(input.value).toBe("hello");
    });

    it("writes the value into a <textarea>", () => {
      // Regression: handleType used to pick HTMLInputElement.prototype.value's
      // setter unconditionally (the `||` short-circuit always returned it),
      // and calling that setter on a <textarea> throws TypeError because the
      // setter has internal-slot checks. The contact form on a11y-agency
      // surfaced this — its name/email <input>s worked but the message
      // <textarea> stayed empty.
      const ta = document.createElement("textarea");
      document.body.appendChild(ta);
      refs.set("n1", ta);

      const result = dispatcher.dispatch({
        nodeId: "n1",
        action: "type",
        payload: { value: "hello textarea" },
      });

      expect(result.success).toBe(true);
      expect(ta.value).toBe("hello textarea");
    });

    it("dispatches input and change events so frameworks observe the write", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      refs.set("n1", input);

      const inputSpy = vi.fn();
      const changeSpy = vi.fn();
      input.addEventListener("input", inputSpy);
      input.addEventListener("change", changeSpy);

      dispatcher.dispatch({
        nodeId: "n1",
        action: "type",
        payload: { value: "x" },
      });

      expect(inputSpy).toHaveBeenCalledTimes(1);
      expect(changeSpy).toHaveBeenCalledTimes(1);
    });

    it("calls the prototype setter, bypassing instance-level setters (React-style)", () => {
      // React's controlled-input wrapper installs an instance-level setter on
      // the field that intercepts writes. The dispatcher must bypass that
      // and use the prototype's native setter so React's _valueTracker
      // notices the change on the next 'input' event.
      const input = document.createElement("input");
      document.body.appendChild(input);
      refs.set("n1", input);

      const proto = HTMLInputElement.prototype;
      const original = Object.getOwnPropertyDescriptor(proto, "value")!;
      const spy = vi.fn(function (this: HTMLInputElement, v: string) {
        original.set!.call(this, v);
      });
      Object.defineProperty(proto, "value", {
        ...original,
        set: spy,
      });

      try {
        const result = dispatcher.dispatch({
          nodeId: "n1",
          action: "type",
          payload: { value: "framework-aware" },
        });
        expect(result.success).toBe(true);
        expect(spy).toHaveBeenCalledWith("framework-aware");
      } finally {
        Object.defineProperty(proto, "value", original);
      }
    });

    it("returns an error when no string value is supplied", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      refs.set("n1", input);

      expect(
        dispatcher.dispatch({ nodeId: "n1", action: "type", payload: {} })
          .success,
      ).toBe(false);
      expect(
        dispatcher.dispatch({
          nodeId: "n1",
          action: "type",
          payload: { value: 42 as unknown as string },
        }).success,
      ).toBe(false);
    });

    it("returns an error when the element is no longer in the DOM", () => {
      const result = dispatcher.dispatch({
        nodeId: "missing",
        action: "type",
        payload: { value: "x" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no longer in DOM/i);
    });
  });

  // Slider / spinbutton stepping. Two paths share one entry point:
  //   - Native <input type="range"|"number">: use the .stepUp/.stepDown
  //     API + emit input/change. No keystrokes needed.
  //   - Custom ARIA widgets (Radix `<span role="slider">`, Headless UI):
  //     focus the element and dispatch ArrowRight/ArrowLeft keydown+keyup.
  describe("increment / decrement actions", () => {
    it("steps a native <input type='range'> up via .stepUp + input/change events", () => {
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.step = "1";
      input.value = "50";
      document.body.appendChild(input);
      refs.set("n1", input);

      const inputSpy = vi.fn();
      const changeSpy = vi.fn();
      input.addEventListener("input", inputSpy);
      input.addEventListener("change", changeSpy);

      const result = dispatcher.dispatch({ nodeId: "n1", action: "increment" });

      expect(result.success).toBe(true);
      expect(input.value).toBe("51");
      expect(inputSpy).toHaveBeenCalledTimes(1);
      expect(changeSpy).toHaveBeenCalledTimes(1);
    });

    it("steps a native <input type='number'> down via .stepDown", () => {
      const input = document.createElement("input");
      input.type = "number";
      input.value = "10";
      document.body.appendChild(input);
      refs.set("n1", input);

      const result = dispatcher.dispatch({ nodeId: "n1", action: "decrement" });

      expect(result.success).toBe(true);
      expect(input.value).toBe("9");
    });

    it("dispatches ArrowRight keydown+keyup directly on a custom [role='slider'] without stealing focus", () => {
      // Radix Slider renders a <span role="slider"> that listens for arrow
      // keys on itself — dispatching directly on the element fires the
      // handler regardless of which element currently has focus. The
      // dispatcher must NOT call element.focus(): that would yank focus out
      // of the panel button the user just clicked and leave the next
      // keystroke landing on whatever follows the slider in tab order.
      const focusBefore = document.createElement("button");
      focusBefore.textContent = "panel button";
      document.body.appendChild(focusBefore);
      focusBefore.focus();

      const slider = document.createElement("span");
      slider.setAttribute("role", "slider");
      slider.tabIndex = 0;
      document.body.appendChild(slider);
      refs.set("n1", slider);

      const seen: Array<{ type: string; key: string }> = [];
      slider.addEventListener("keydown", (e) =>
        seen.push({ type: "keydown", key: (e as KeyboardEvent).key }),
      );
      slider.addEventListener("keyup", (e) =>
        seen.push({ type: "keyup", key: (e as KeyboardEvent).key }),
      );

      const result = dispatcher.dispatch({ nodeId: "n1", action: "increment" });

      expect(result.success).toBe(true);
      expect(seen).toEqual([
        { type: "keydown", key: "ArrowRight" },
        { type: "keyup", key: "ArrowRight" },
      ]);
      // Focus stays on the original element — the panel button keeps it,
      // which keeps the panel's keyboard ergonomics intact.
      expect(document.activeElement).toBe(focusBefore);
    });

    it("dispatches ArrowLeft on decrement for a custom [role='slider']", () => {
      const slider = document.createElement("span");
      slider.setAttribute("role", "slider");
      slider.tabIndex = 0;
      document.body.appendChild(slider);
      refs.set("n1", slider);

      const keys: string[] = [];
      slider.addEventListener("keydown", (e) =>
        keys.push((e as KeyboardEvent).key),
      );

      dispatcher.dispatch({ nodeId: "n1", action: "decrement" });

      expect(keys).toEqual(["ArrowLeft"]);
    });

    it("works under the Screen Curtain (no reliance on visibility)", () => {
      // The Screen Curtain hides the page from the user but leaves the DOM
      // intact. The dispatcher must still drive the slider — focus + keydown
      // is the same code path regardless of visual occlusion.
      const slider = document.createElement("span");
      slider.setAttribute("role", "slider");
      slider.tabIndex = 0;
      document.body.appendChild(slider);
      refs.set("n1", slider);

      let value = 5;
      slider.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "ArrowRight") value++;
        if ((e as KeyboardEvent).key === "ArrowLeft") value--;
      });

      dispatcher.dispatch({ nodeId: "n1", action: "increment" });
      dispatcher.dispatch({ nodeId: "n1", action: "increment" });
      dispatcher.dispatch({ nodeId: "n1", action: "decrement" });

      expect(value).toBe(6);
    });
  });
});
