import { describe, expect, it } from "vitest";

import { splitStatesBlock, statesTokens } from "./states-block.js";

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
