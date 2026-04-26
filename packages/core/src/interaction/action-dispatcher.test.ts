import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ActionDispatcher } from "./action-dispatcher.js";
import { ElementRefMap } from "../utils/element-ref.js";

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
});
