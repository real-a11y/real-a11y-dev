import { describe, expect, it, vi } from "vitest";

import { resetRealmSingletons } from "../utils/realm-singleton.js";

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

const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/**
 * The pseudo-elements `run` asks `getComputedStyle` for. jsdom's "not
 * implemented" report goes to its virtual console, which a spy on
 * `console.error` does not see under Vitest, so the reads are what is counted.
 * A read gets the element's own style, as jsdom would give, without its report.
 */
function pseudoReadsDuring(run: () => void): string[] {
  const real = window.getComputedStyle.bind(window);
  const reads: string[] = [];
  const spy = vi.spyOn(window, "getComputedStyle").mockImplementation(((
    el: Element,
    pseudo?: string | null,
  ) => {
    if (pseudo) reads.push(pseudo);
    return real(el);
  }) as typeof window.getComputedStyle);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return reads;
}

/** Fake `navigator.userAgent` on `Navigator.prototype`'s own getter. */
function fakePrototypeAgent(): () => void {
  const proto = Object.getPrototypeOf(navigator) as object;
  const original = Object.getOwnPropertyDescriptor(proto, "userAgent")!;
  Object.defineProperty(proto, "userAgent", {
    ...original,
    get: () => PHONE,
  });
  return () => Object.defineProperty(proto, "userAgent", original);
}

describe("extraction under jsdom", () => {
  it("makes no pseudo-element read", () => {
    document.body.innerHTML = `<button>one</button><button>two</button>`;
    const reads = pseudoReadsDuring(() => {
      const { nodes } = extractDomTree(document.body);
      const names = [...nodes.values()].map((n) => n.a11y.name);
      expect(names).toContain("one");
      expect(generatedText(document.body).before.text).toBe("");
    });
    expect(reads).toEqual([]);
  });

  // A test of code that detects a phone fakes the user agent, on the instance
  // or by replacing the global. Neither may bring the pseudo-element read back.
  // The realm's earlier answer is forgotten first, so this one is asked anew.
  it.each([
    [
      "an own property on navigator",
      () => {
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          get: () => PHONE,
        });
        return () => {
          delete (navigator as { userAgent?: string }).userAgent;
        };
      },
    ],
    [
      "a replaced global navigator",
      () => {
        vi.stubGlobal("navigator", { userAgent: PHONE });
        return () => vi.unstubAllGlobals();
      },
    ],
  ])("still makes none when a test fakes a phone with %s", (_, fake) => {
    resetRealmSingletons();
    document.body.innerHTML = `<main><button>Send</button></main>`;
    let restore = () => {};
    try {
      restore = fake();
      expect(navigator.userAgent).toBe(PHONE);
      const reads = pseudoReadsDuring(() => {
        const { nodes } = extractDomTree(document.body);
        expect([...nodes.values()].map((n) => n.a11y.name)).toContain("Send");
      });
      expect(reads).toEqual([]);
    } finally {
      restore();
    }
    expect(navigator.userAgent).toMatch(/jsdom/);
  });

  // Faking the prototype's own getter is the one fake the read cannot see past.
  // What it gets then is not kept; what it gets from jsdom itself is.
  it("keeps the jsdom answer, and not one a faked prototype gave", () => {
    resetRealmSingletons();
    document.body.innerHTML = `<main><button>Send</button></main>`;
    const extract = () => extractDomTree(document.body);

    const restore = fakePrototypeAgent();
    try {
      expect(pseudoReadsDuring(extract)).not.toEqual([]);
    } finally {
      restore();
    }
    expect(pseudoReadsDuring(extract)).toEqual([]);

    const again = fakePrototypeAgent();
    try {
      expect(pseudoReadsDuring(extract)).toEqual([]);
    } finally {
      again();
    }
  });

  // Every published package bundles its own copy of this code. A copy used
  // for the first time after the fake still knows what another copy found.
  it("shares the jsdom answer with a copy first used after a fake", async () => {
    resetRealmSingletons();
    document.body.innerHTML = `<main><button>Send</button></main>`;
    expect(pseudoReadsDuring(() => extractDomTree(document.body))).toEqual([]);

    vi.resetModules();
    const other = await import("./dom-extractor.js");
    expect(other.extractDomTree).not.toBe(extractDomTree);
    const restore = fakePrototypeAgent();
    try {
      expect(
        pseudoReadsDuring(() => other.extractDomTree(document.body)),
      ).toEqual([]);
    } finally {
      restore();
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
