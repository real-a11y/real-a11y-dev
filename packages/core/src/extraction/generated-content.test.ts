import { describe, expect, it, vi } from "vitest";

import { extractDomTree } from "./dom-extractor.js";
import {
  applyTextTransform,
  generatedText,
  parseContentText,
} from "./generated-content.js";

describe("parseContentText", () => {
  it("reads strings, and only the alternative text after a slash", () => {
    expect(parseContentText('"before "')).toBe("before ");
    expect(parseContentText('"★" / "Favourite "')).toBe("Favourite ");
    expect(parseContentText('"★" / ""')).toBe("");
    expect(parseContentText('"a" "b"')).toBe("ab");
  });

  it("adds nothing for none, normal and unresolved tokens", () => {
    expect(parseContentText("none")).toBe("");
    expect(parseContentText("normal")).toBe("");
    expect(parseContentText('counter(c) "51 "')).toBe("51 ");
    expect(parseContentText('url("x.png") " New "')).toBe(" New ");
    expect(parseContentText('open-quote "Hi" close-quote " "')).toBe("Hi ");
    expect(parseContentText('"x" / counter(c) "51 "')).toBe("51 ");
  });

  it("decodes escapes and ignores a slash inside a string", () => {
    expect(parseContentText('"a\\"b"')).toBe('a"b');
    expect(parseContentText('"\\2605 x"')).toBe("★x");
    expect(parseContentText('"a/b"')).toBe("a/b");
    expect(parseContentText('"Save\\a now"')).toBe("Save\nnow");
    expect(parseContentText('"a\\\nb"')).toBe("ab");
  });
});

describe("applyTextTransform", () => {
  it("uppercases, lowercases and capitalizes", () => {
    expect(applyTextTransform("Call us", "uppercase")).toBe("CALL US");
    expect(applyTextTransform("Call US", "lowercase")).toBe("call us");
    expect(applyTextTransform("call us now", "capitalize")).toBe("Call Us Now");
    expect(applyTextTransform("don't stop", "capitalize")).toBe("Don't Stop");
    expect(applyTextTransform("Call us", "none")).toBe("Call us");
    expect(applyTextTransform("'hello' world", "capitalize")).toBe(
      "'Hello' World",
    );
    expect(applyTextTransform("izin", "uppercase", "tr")).toBe("İZİN");
    expect(applyTextTransform("izin", "uppercase", "not a tag!")).toBe("IZIN");
  });
});

describe("extraction under jsdom", () => {
  it("makes no pseudo-element read and logs nothing", () => {
    document.body.innerHTML = `<button>one</button><button>two</button>`;
    const real = window.getComputedStyle.bind(window);
    const calls: unknown[][] = [];
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation(((
      el: Element,
      pseudo?: string | null,
    ) => {
      calls.push([el, pseudo]);
      return real(el, pseudo);
    }) as typeof window.getComputedStyle);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { nodes } = extractDomTree(document.body);
      const names = [...nodes.values()].map((n) => n.a11y.name);
      expect(names).toContain("one");
      expect(calls.filter(([, pseudo]) => pseudo)).toEqual([]);
      expect(error).not.toHaveBeenCalled();
      expect(generatedText(document.body).before.text).toBe("");
    } finally {
      spy.mockRestore();
      error.mockRestore();
    }
  });

  it("applies text-transform, which needs only the element's own style", () => {
    document.body.innerHTML = `<h2 style="text-transform: uppercase">Call us</h2>`;
    const { nodes } = extractDomTree(document.body);
    const heading = [...nodes.values()].find((n) => n.a11y.role === "heading");
    expect(heading?.a11y.name).toBe("CALL US");
  });

  it("never cases the marker for text withheld in strict mode", () => {
    document.body.innerHTML = `<div contenteditable="true" role="textbox" style="text-transform: uppercase" aria-label="">typed</div><button style="text-transform: uppercase">Save</button>`;
    const { nodes } = extractDomTree(document.body, { redactInput: true });
    const names = [...nodes.values()].map((n) => n.a11y.name);
    expect(names).not.toContain("[REDACTED]");
    expect(names).toContain("SAVE");
  });
});
