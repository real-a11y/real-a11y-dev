import { describe, expect, it } from "vitest";

import {
  splitStatesBlock,
  statesBlock,
  statesTokens,
  unprintableToken,
} from "./states-block.js";

describe("splitStatesBlock", () => {
  it("returns a line with no block unchanged", () => {
    for (const line of [
      "checkbox",
      'checkbox "Subscribe"',
      'heading "Setup" (level 2)',
      'textbox "Email" = "a@b.c"',
      'button "Save" [focused]',
    ]) {
      expect(splitStatesBlock(line)).toEqual({ line });
    }
  });

  it("splits each token shape off the end of the line", () => {
    expect(splitStatesBlock('checkbox "Subscribe" {checked}')).toEqual({
      line: 'checkbox "Subscribe"',
      block: "checked",
    });
    expect(splitStatesBlock('checkbox "Subscribe" {checked=false}')).toEqual({
      line: 'checkbox "Subscribe"',
      block: "checked=false",
    });
    expect(splitStatesBlock('button "x" {roledescription="slide"}')).toEqual({
      line: 'button "x"',
      block: 'roledescription="slide"',
    });
    expect(splitStatesBlock("separator {disabled}")).toEqual({
      line: "separator",
      block: "disabled",
    });
  });

  it("reads numbers, dots, underscores and either case as words", () => {
    expect(
      splitStatesBlock(
        'slider "Volume" {valuenow=0.5, Orientation=Horizontal}',
      ),
    ).toEqual({
      line: 'slider "Volume"',
      block: "valuenow=0.5, Orientation=Horizontal",
    });
    expect(splitStatesBlock("button {aria-busy, x_y=a_b}")).toEqual({
      line: "button",
      block: "aria-busy, x_y=a_b",
    });
  });

  it("splits a multi-token block after the value and the level", () => {
    expect(
      splitStatesBlock(
        'treeitem "Docs" = "x" (level 2) {expanded=false, selected, current=page}',
      ),
    ).toEqual({
      line: 'treeitem "Docs" = "x" (level 2)',
      block: "expanded=false, selected, current=page",
    });
  });

  it("expects the focus marker gone: a block before it is not at the end", () => {
    const line = 'button "Menu" {expanded=false} [focused]';
    expect(splitStatesBlock(line)).toEqual({ line });
  });

  it("reads a very long quoted value without overflowing the regex stack", () => {
    const description = `description="${"y".repeat(12_000_000)}"`;
    const { block } = splitStatesBlock(`button "x" {${description}}`);
    expect(block?.length).toBe(description.length);
  });

  it("reads a JSON string holding a brace, a separator and an escaped quote as one token", () => {
    const block = String.raw`required, description="Use {a}, then \"b\"}"`;
    expect(splitStatesBlock(`textbox "Email" {${block}}`)).toEqual({
      line: 'textbox "Email"',
      block,
    });
  });

  it("never mistakes a name that contains braces for a block", () => {
    for (const line of ['button "Save {draft}"', 'link "x {y}" = "{z}"']) {
      expect(splitStatesBlock(line)).toEqual({ line });
    }
    // A block after such a name still splits off, and only the block does.
    expect(splitStatesBlock('button "Save {draft}" {pressed}')).toEqual({
      line: 'button "Save {draft}"',
      block: "pressed",
    });
  });

  it("ignores text in braces that is not a well-formed block", () => {
    for (const line of [
      "button {}",
      "button {-checked}",
      "button {checked,expanded}",
      "button {description=unquoted text}",
      'button {description="unterminated}',
      "button{checked}",
    ]) {
      expect(splitStatesBlock(line)).toEqual({ line });
    }
  });
});

describe("statesTokens", () => {
  it("splits a block's contents into its tokens, in order", () => {
    expect(statesTokens("checked=false, required, current=page")).toEqual([
      "checked=false",
      "required",
      "current=page",
    ]);
  });

  it("keeps a JSON string whole, whatever separators or braces it holds", () => {
    const description = String.raw`description="a, b} \"c\""`;
    expect(statesTokens(`required, ${description}, disabled`)).toEqual([
      "required",
      description,
      "disabled",
    ]);
  });

  it("reads the block splitStatesBlock returns", () => {
    const { block } = splitStatesBlock(
      'button "Menu" {expanded=false, haspopup=menu}',
    );
    expect(statesTokens(block ?? "")).toEqual([
      "expanded=false",
      "haspopup=menu",
    ]);
  });
});

describe("statesBlock", () => {
  const block = (
    states: Record<string, string | boolean>,
    properties: Record<string, string> = {},
    description = "",
    redact = (t: string) => t,
  ) => statesBlock({ states, properties, description }, redact);

  it("prints nothing for a node with nothing to print", () => {
    expect(block({})).toBe("");
  });

  it("checked and pressed: nothing for a token they don't take", () => {
    expect(block({ checked: "page" })).toBe("");
  });

  it("checked and pressed: true, false and mixed", () => {
    expect(block({ checked: true })).toBe(" {checked}");
    expect(block({ checked: false })).toBe(" {checked=false}");
    expect(block({ checked: "mixed" })).toBe(" {checked=mixed}");
    expect(block({ pressed: true })).toBe(" {pressed}");
    expect(block({ pressed: false })).toBe(" {pressed=false}");
    expect(block({ pressed: "mixed" })).toBe(" {pressed=mixed}");
  });

  it("expanded: true and false", () => {
    expect(block({ expanded: true })).toBe(" {expanded}");
    expect(block({ expanded: false })).toBe(" {expanded=false}");
  });

  it("selected, disabled, readonly, required: only when true", () => {
    for (const key of ["selected", "disabled", "readonly", "required"]) {
      expect(block({ [key]: true })).toBe(` {${key}}`);
      expect(block({ [key]: false })).toBe("");
    }
  });

  it("invalid: bare for any truthy value, nothing for false", () => {
    for (const value of [true, "true", "grammar", "spelling"]) {
      expect(block({ invalid: value })).toBe(" {invalid}");
    }
    for (const value of [false, "false"]) {
      expect(block({ invalid: value })).toBe("");
    }
  });

  it("current: bare for true, a token otherwise, never false", () => {
    expect(block({ current: true })).toBe(" {current}");
    expect(block({ current: "page" })).toBe(" {current=page}");
    expect(block({ current: false })).toBe("");
  });

  it("haspopup from either key, never false", () => {
    expect(block({}, { hasPopup: "menu" })).toBe(" {haspopup=menu}");
    expect(block({}, { haspopup: "listbox" })).toBe(" {haspopup=listbox}");
    expect(block({}, { hasPopup: "false" })).toBe("");
  });

  it("roledescription and description: JSON-quoted and redacted", () => {
    expect(block({}, { roledescription: "slide" })).toBe(
      ' {roledescription="slide"}',
    );
    expect(block({}, {}, 'Say "hi", {then} go')).toBe(
      String.raw` {description="Say \"hi\", {then} go"}`,
    );
    expect(
      block({}, {}, "Order 1234 ships", (t) => t.replace(/\d+/g, "[REDACTED]")),
    ).toBe(' {description="Order [REDACTED] ships"}');
  });

  it("never prints what isn't on the allowlist, nor native's defaults", () => {
    expect(
      block(
        {
          focusable: true,
          focused: true,
          editable: "plaintext",
          settable: true,
          modal: false,
          multiline: false,
          busy: true,
          invalid: "false",
          selected: false,
          required: false,
        },
        { level: "2", valuemin: "0", orientation: "horizontal" },
      ),
    ).toBe("");
  });

  it("prints in the fixed order, whatever order the states come in", () => {
    expect(
      block(
        {
          invalid: true,
          required: true,
          disabled: true,
          current: "step",
          selected: true,
          expanded: false,
          pressed: true,
          checked: "mixed",
        },
        { roledescription: "r", hasPopup: "menu" },
        "d",
      ),
    ).toBe(
      ' {checked=mixed, pressed, expanded=false, selected, current=step, disabled, required, invalid, haspopup=menu, roledescription="r", description="d"}',
    );
  });

  it("quotes a token that isn't a word, so the line still reads back", () => {
    expect(block({ current: "Some Place" })).toBe(' {current="Some Place"}');
  });

  it("writes only what the reader splits back off, token for token", () => {
    const written = block(
      { checked: false, current: "Some Place", required: true },
      { hasPopup: "menu" },
      'A "quoted", {braced} hint',
    );
    const line = `checkbox "x"${written}`;
    const { line: rest, block: read } = splitStatesBlock(line);
    expect(rest).toBe('checkbox "x"');
    expect(` {${statesTokens(read!).join(", ")}}`).toBe(written);
  });
});

describe("unprintableToken", () => {
  it("accepts every token the writer prints", () => {
    const values: (string | boolean)[] = [
      true,
      false,
      "mixed",
      "page",
      "Some Place",
      "spelling",
    ];
    const keys = [
      "checked",
      "pressed",
      "expanded",
      "selected",
      "current",
      "disabled",
      "readonly",
      "required",
      "invalid",
    ];
    for (const key of keys) {
      for (const value of values) {
        const written = statesBlock(
          {
            states: { [key]: value },
            properties: { hasPopup: String(value), roledescription: "r" },
            description: "d",
          },
          (t) => t,
        );
        const { block } = splitStatesBlock(`button${written}`);
        for (const token of statesTokens(block!)) {
          expect(unprintableToken(token), token).toBeUndefined();
        }
      }
    }
  });

  it("names the printed form of a token that never prints", () => {
    expect(unprintableToken("checked=true")).toMatch(/never prints/);
    expect(unprintableToken("checked=yes")).toMatch(/never prints/);
    expect(unprintableToken("pressed=1")).toMatch(/never prints/);
    expect(unprintableToken("required=false")).toMatch(/never prints/);
    expect(unprintableToken("haspopup=false")).toMatch(/never prints/);
    expect(unprintableToken("roledescription=slide")).toMatch(/never prints/);
    expect(unprintableToken("focusable")).toMatch(/is not a key/);
  });
});
