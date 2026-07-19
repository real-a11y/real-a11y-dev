import { describe, it, expect, afterEach } from "vitest";

import { computeFieldState } from "./field-state.js";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Mount `html` and return its first element child. */
function mount(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

describe("computeFieldState", () => {
  describe("native form controls", () => {
    it("reads a text input's value and placeholder", () => {
      const el = mount(
        `<input type="email" value="a@b.com" placeholder="Email" />`,
      );
      expect(computeFieldState(el)).toEqual({
        success: true,
        type: "email",
        value: "a@b.com",
        placeholder: "Email",
      });
    });

    it("reads a textarea", () => {
      const el = mount(`<textarea>hello</textarea>`);
      expect(computeFieldState(el)).toMatchObject({
        success: true,
        type: "textarea",
        value: "hello",
      });
    });

    it("reads a select with its options", () => {
      const el = mount(
        `<select><option value="a">A</option><option value="b" selected>B</option></select>`,
      );
      expect(computeFieldState(el)).toEqual({
        success: true,
        type: "select",
        value: "b",
        options: [
          { value: "a", label: "A", selected: false },
          { value: "b", label: "B", selected: true },
        ],
      });
    });

    it("never reveals a password value (but still allows typing)", () => {
      const el = mount(`<input type="password" value="hunter2" />`);
      expect(computeFieldState(el)).toMatchObject({
        success: true,
        type: "password",
        value: "",
      });
    });
  });

  describe("custom contenteditable text widgets (ARIA textbox/combobox)", () => {
    // Replicates Slack's message composer (Quill): a contenteditable <div>
    // exposed as role="textbox". This is the W3C APG multi-line Textbox
    // pattern hosted on contenteditable — the case native <input> can't cover.
    it("opens for a contenteditable role=textbox (Slack message box)", () => {
      const el = mount(
        `<div class="ql-editor" contenteditable="true" role="textbox" dir="auto"
              aria-label="Message to new-channel" aria-multiline="true"><p><br></p></div>`,
      );
      // An empty Quill editor is <p><br></p>: value must read as empty, not "\n".
      expect(computeFieldState(el)).toEqual({
        success: true,
        type: "text",
        value: "",
        placeholder: "",
      });
    });

    // Replicates Slack's search box: an editable/autocomplete combobox built as
    // a contenteditable <div role="combobox"> (ARIA 1.2 editable combobox).
    it("opens for a contenteditable role=combobox (Slack search)", () => {
      const el = mount(
        `<div class="ql-editor" contenteditable="true" role="combobox" dir="auto"
              aria-label="Query" aria-autocomplete="list" aria-expanded="true"
              aria-multiline="false" aria-controls="suggestions"><p>in:new-channel</p></div>`,
      );
      expect(computeFieldState(el)).toEqual({
        success: true,
        type: "text",
        value: "in:new-channel",
        placeholder: "",
      });
    });

    it("trims framework whitespace and surfaces aria-placeholder", () => {
      const el = mount(
        `<div contenteditable="true" role="textbox" aria-placeholder="Search">  hi there\n</div>`,
      );
      expect(computeFieldState(el)).toEqual({
        success: true,
        type: "text",
        value: "hi there",
        placeholder: "Search",
      });
    });

    it('supports contenteditable="plaintext-only"', () => {
      const el = mount(
        `<div contenteditable="plaintext-only" role="textbox">x</div>`,
      );
      expect(computeFieldState(el)).toMatchObject({
        success: true,
        type: "text",
        value: "x",
      });
    });
  });

  describe("non-fillable elements", () => {
    it("returns failure for a plain (non-editable) div", () => {
      const el = mount(`<div role="textbox">read only</div>`);
      expect(computeFieldState(el)).toEqual({ success: false });
    });

    it('returns failure for contenteditable="false"', () => {
      const el = mount(`<div contenteditable="false" role="textbox">no</div>`);
      expect(computeFieldState(el)).toEqual({ success: false });
    });

    it("returns failure for a button", () => {
      const el = mount(`<button>Go</button>`);
      expect(computeFieldState(el)).toEqual({ success: false });
    });
  });
});
