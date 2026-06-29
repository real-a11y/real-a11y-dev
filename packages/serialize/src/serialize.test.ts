import { describe, it, expect } from "vitest";

import {
  serializeTree,
  serializeOutline,
  serializeTabSequence,
} from "./index.js";

describe("serializeTree", () => {
  it("renders roles, accessible names, and heading levels", () => {
    document.body.innerHTML = `
      <main aria-label="Sign-in form">
        <h1>Sign in</h1>
        <button>Go</button>
      </main>`;
    const out = serializeTree(document.body);
    expect(out).toContain('heading "Sign in" (level 1)');
    expect(out).toContain('button "Go"');
  });

  it("drops generic wrappers by default and keeps them with includeGeneric", () => {
    document.body.innerHTML = `<div><button>Save</button></div>`;
    expect(serializeTree(document.body)).not.toContain("generic");
    expect(serializeTree(document.body, { includeGeneric: true })).toContain(
      "generic",
    );
  });

  it("redacts matching substrings in accessible names", () => {
    document.body.innerHTML = `<button aria-label="Saved 2 minutes ago">x</button>`;
    const out = serializeTree(document.body, {
      redact: [/\d+ (seconds?|minutes?|hours?) ago/],
    });
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("2 minutes ago");
  });

  it("collapses whitespace and newlines in accessible names", () => {
    // Pages sometimes leave raw newlines/indentation inside a name; the
    // serializer must flatten them so the name stays on one line.
    document.body.innerHTML =
      '<button aria-label="Amazon\n\n\n   Subtotal (2)">x</button>';
    const out = serializeTree(document.body);
    expect(out).toContain('button "Amazon Subtotal (2)"');
  });
});

describe("serializeOutline", () => {
  it("lists headings and reports when there are none", () => {
    document.body.innerHTML = `<h1>A</h1><h2>B</h2>`;
    const out = serializeOutline(document.body);
    expect(out).toContain("h1 A");
    expect(out).toContain("  h2 B");

    document.body.innerHTML = `<p>no headings here</p>`;
    expect(serializeOutline(document.body)).toBe("(no headings)");
  });
});

describe("serializeTabSequence", () => {
  it("numbers focusable nodes in tab order", () => {
    document.body.innerHTML = `<a href="#a">Home</a><button>Go</button>`;
    const out = serializeTabSequence(document.body);
    expect(out).toContain('01. link "Home"');
    expect(out).toContain('02. button "Go"');
  });
});
