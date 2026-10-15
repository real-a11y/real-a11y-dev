import { describe, expect, it, vi } from "vitest";

import {
  isPageInput,
  isTyping,
  pageInputFilter,
  type PageInputEvent,
} from "./page-input.js";

function element(html: string, selector: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.querySelector(selector)!;
}

/** jsdom has no `isContentEditable`: say what Chromium would. */
function editable<T extends Element>(el: T, value: boolean): T {
  Object.defineProperty(el, "isContentEditable", { value });
  return el;
}

const button = () => element("<button>Save</button>", "button");
const field = () => element('<input type="search">', "input");
const area = () => element("<textarea></textarea>", "textarea");
const editor = () => editable(element("<div><p>Hi</p></div>", "p"), true);

function event(over: Partial<PageInputEvent>): PageInputEvent {
  return { type: "click", isTrusted: true, ...over };
}

const key = (over: Partial<PageInputEvent> = {}) =>
  event({ type: "keydown", key: "Enter", ...over });

describe("isPageInput", () => {
  it("counts a click, on a checkbox or a select too", () => {
    const box = element('<input type="checkbox">', "input");
    const select = element("<select></select>", "select");
    for (const target of [button(), box, select, document.body, null]) {
      expect(isPageInput(event({}), () => target)).toBe(true);
    }
  });

  it("leaves out a click that puts the caret in a field or an editor", () => {
    const password = element('<input type="password">', "input");
    // Typed into where it is clicked; its picker opens from its icon.
    const date = element('<input type="date">', "input");
    for (const target of [field(), password, date, area(), editor()]) {
      expect(isPageInput(event({}), () => target)).toBe(false);
    }
  });

  it("counts a click on a read-only field, which a picker opens on", () => {
    for (const type of ["text", "date"]) {
      const picker = element(`<input type="${type}" readonly>`, "input");
      expect(isPageInput(event({}), () => picker)).toBe(true);
    }
  });

  it("counts Enter, as in a search field", () => {
    expect(isPageInput(key(), field)).toBe(true);
    // Focus somewhere the page can't say.
    expect(isPageInput(key(), () => null)).toBe(true);
  });

  it("counts Space on a control that takes it, native or authored", () => {
    // A menu button that acts on the key and cancels its click, and custom
    // widgets by their role, read as Chromium reads it.
    for (const target of [
      button(),
      element('<input type="checkbox">', "input"),
      element('<div role="Button" tabindex="0">Go</div>', "div"),
      element('<div role="switch" tabindex="0">On</div>', "div"),
      element('<div role="combobox" tabindex="0">Pick</div>', "div"),
      element(
        '<div role="tablist"><div role="tab" tabindex="0">One</div></div>',
        '[role="tab"]',
      ),
      // An option in a wrapper with no role of its own.
      element(
        '<ul role="listbox"><li><div role="option" tabindex="0">a</div></li></ul>',
        '[role="option"]',
      ),
      // A date picker's day.
      element(
        '<table role="grid"><tr><td tabindex="0">15</td></tr></table>',
        "td",
      ),
      // A role Chrome sets aside on a control that takes focus, and a first
      // token that needs a list around it.
      element('<button role="presentation">Menu</button>', "button"),
      element('<div role="listitem button" tabindex="0">Go</div>', "div"),
    ]) {
      expect(isPageInput(key({ key: " " }), () => target)).toBe(true);
    }
  });

  it("leaves out Space where it types or only scrolls", () => {
    const link = element('<a href="#more">More</a>', "a");
    // Part of what the user types to find an option.
    const select = element("<select><option>a</option></select>", "select");
    const slider = element('<input type="range">', "input");
    const readonly = element('<input type="text" readonly>', "input");
    // Focus a page parks on a wrapper or a heading, as after a route change.
    const wrapper = element('<div tabindex="-1">Page</div>', "div");
    const heading = element('<h1 tabindex="-1">Title</h1>', "h1");
    const region = element('<div role="region" tabindex="0"></div>', "div");
    // A cell of a table that isn't a grid.
    const cell = element(
      '<table><tr><td tabindex="0">15</td></tr></table>',
      "td",
    );
    for (const target of [
      field(),
      area(),
      editor(),
      select,
      slider,
      readonly,
      document.body,
      document.documentElement,
      link,
      wrapper,
      heading,
      region,
      cell,
      null,
    ]) {
      expect(isPageInput(key({ key: " " }), () => target)).toBe(false);
    }
  });

  it("leaves out Enter that only starts a new line of text", () => {
    for (const target of [area(), editor()]) {
      expect(isPageInput(key(), () => target)).toBe(false);
    }
    // Not editable after all, as in a contenteditable="false" island.
    const island = editable(element("<div><p>Hi</p></div>", "p"), false);
    expect(isPageInput(key(), () => island)).toBe(true);
  });

  it("leaves out an event a script made, the extension's own among them", () => {
    expect(isPageInput(event({ isTrusted: false }), button)).toBe(false);
    expect(isPageInput(key({ isTrusted: false }), field)).toBe(false);
  });

  it("leaves out a form submitted, which a script's requestSubmit() makes the browser's own", () => {
    expect(isPageInput(event({ type: "submit" }), button)).toBe(false);
  });

  it("leaves out other keys, a key held down, and one an IME takes", () => {
    for (const k of ["a", "Tab", "Escape"]) {
      expect(isPageInput(key({ key: k }), field)).toBe(false);
    }
    expect(isPageInput(key({ repeat: true }), field)).toBe(false);
    expect(isPageInput(key({ isComposing: true }), field)).toBe(false);
    expect(isPageInput(key({ keyCode: 229 }), field)).toBe(false);
  });

  it("looks for the target only once the event could count", () => {
    const target = vi.fn(button);
    isPageInput(event({ isTrusted: false }), target);
    isPageInput(key({ key: "a" }), target);
    expect(target).not.toHaveBeenCalled();
    isPageInput(key(), target);
    isPageInput(event({}), target);
    expect(target).toHaveBeenCalledTimes(2);
  });

  it("leaves out events it doesn't follow, a press of the pointer among them", () => {
    for (const type of ["pointerdown", "mousedown", "focusin", "keyup"]) {
      expect(isPageInput(event({ type, key: "Enter" }), button)).toBe(false);
    }
  });
});

describe("isTyping", () => {
  const input = (over: Partial<PageInputEvent>) =>
    event({ type: "input", inputType: "insertText", ...over });

  it("counts an edit of text the browser made for the user", () => {
    for (const inputType of ["insertText", "deleteContentBackward"]) {
      expect(isTyping(input({ inputType }))).toBe(true);
    }
  });

  it("leaves out a value a checkbox, a select or a slider changed", () => {
    expect(isTyping(input({ inputType: "" }))).toBe(false);
    expect(isTyping(input({ inputType: undefined }))).toBe(false);
  });

  it("leaves out an edit a script made, and other events", () => {
    expect(isTyping(input({ isTrusted: false }))).toBe(false);
    expect(isTyping(input({ type: "change" }))).toBe(false);
  });
});

describe("pageInputFilter", () => {
  it("leaves out the click a script's click on a label makes the browser fire", async () => {
    const accepts = pageInputFilter();
    // The script's click, then the browser's own on the label's control,
    // while the first is still being dispatched.
    expect(accepts(event({ isTrusted: false }), button)).toBe(false);
    expect(accepts(event({}), button)).toBe(false);
    // The user's next click comes in a task of its own.
    await Promise.resolve();
    expect(accepts(event({}), button)).toBe(true);
  });

  it("otherwise counts what isPageInput does", () => {
    const accepts = pageInputFilter();
    expect(accepts(event({}), button)).toBe(true);
    expect(accepts(event({}), field)).toBe(false);
    expect(accepts(key(), field)).toBe(true);
    expect(accepts(key({ key: "a" }), field)).toBe(false);
    expect(accepts(event({ type: "submit" }), button)).toBe(false);
  });
});
