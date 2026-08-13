/**
 * Input validation at the serializer boundary.
 *
 * The worst variant of the unchecked cast lived here: `serializeTree(42)`
 * returned `""`. Committed through `toMatchSnapshot()` that is a test which
 * passes forever while asserting nothing — a silent, permanent green. Found
 * running the published package from npm (scenario R33, step 8).
 */
import { extractA11yTree } from "@real-a11y-dev/core";
import { describe, it, expect } from "vitest";

import {
  serializeOutline,
  serializeTabSequence,
  serializeTree,
} from "./serialize.js";

const JUNK: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["a string", "<button></button>"],
  ["a number", 42],
  ["a boolean", true],
  ["a plain object", {}],
  ["an object with a nodes array", { nodes: [] }],
  ["an empty array", []],
  ["a Date", new Date(0)],
];

const SERIALIZERS: Array<[string, (input: never) => string]> = [
  ["serializeTree", serializeTree],
  ["serializeOutline", serializeOutline],
  ["serializeTabSequence", serializeTabSequence],
];

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe("rejects input that is not a tree", () => {
  for (const [name, fn] of SERIALIZERS) {
    for (const [label, value] of JUNK) {
      it(`${name}(${label}) throws instead of returning a string`, () => {
        expect(() => fn(value as never)).toThrow(TypeError);
      });
    }
  }

  it("never returns the empty string for junk — that is the snapshot trap", () => {
    // Each of these previously returned "" / "(no headings)" /
    // "(nothing focusable)", all of which commit as a passing baseline.
    for (const [, value] of JUNK) {
      let returned: string | undefined;
      try {
        returned = serializeTree(value as never);
      } catch {
        returned = undefined;
      }
      expect(returned).toBeUndefined();
    }
  });

  it("names the serializer and the received type", () => {
    expect(() => serializeTree(42 as never)).toThrow(
      /^serializeTree: expected a DOM Element or an extracted a11y tree, received number/,
    );
    expect(() => serializeOutline(42 as never)).toThrow(/^serializeOutline:/);
    expect(() => serializeTabSequence(42 as never)).toThrow(
      /^serializeTabSequence:/,
    );
  });

  it("does not print the rejected value", () => {
    const secret = "nw_live_sk_9f2b7c41d8";
    expect(() => serializeTree(secret as never)).not.toThrow(
      new RegExp(secret),
    );
  });
});

describe("still accepts what it is documented to accept", () => {
  it("a live DOM Element", () => {
    const root = mount(`<main><h1>Title</h1><button>Save</button></main>`);
    expect(serializeTree(root)).toContain('button "Save"');
  });

  it("an already-extracted tree", () => {
    const root = mount(`<main><h1>Title</h1><button>Save</button></main>`);
    const tree = extractA11yTree(root);
    expect(serializeTree(tree)).toContain('button "Save"');
    expect(serializeOutline(tree)).toContain("Title");
  });

  it("an empty but VALID tree still serializes rather than throwing", () => {
    // "nothing to show" and "you passed the wrong thing" must stay distinct.
    const tree = extractA11yTree(mount(`<div></div>`));
    expect(() => serializeTree(tree)).not.toThrow();
    expect(serializeOutline(tree)).toBe("(no headings)");
    expect(serializeTabSequence(tree)).toBe("(nothing focusable)");
  });
});
