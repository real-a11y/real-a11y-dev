import { describe, it, expect, afterEach } from "vitest";

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

  it("starts the outermost kept node at indent 0", () => {
    // The extractor keeps the root even when it's generic (`<body>`, or a
    // mount wrapper). Dropping it at print time must not leave every line
    // indented by the level it occupied.
    document.body.innerHTML = `<main><h1>Sign in</h1></main>`;
    expect(serializeTree(document.body)).toBe(
      ["main", '  heading "Sign in" (level 1)'].join("\n"),
    );
  });

  it("re-parents children of a dropped NAMED generic", () => {
    // A generic with an accessible name survives extraction, so the serializer
    // is what drops it — and its children must not keep the indent level of a
    // parent that is no longer printed. Before this was fixed, `button "Save"`
    // rendered one level deeper than `heading`, i.e. as the heading's child.
    document.body.innerHTML = `
      <main>
        <h1>Dash</h1>
        <div aria-label="Decor"><button>Save</button></div>
      </main>`;
    expect(serializeTree(document.body)).toBe(
      ["main", '  heading "Dash" (level 1)', '  button "Save"'].join("\n"),
    );
  });

  it("re-parents across a dropped generic in dom mode", () => {
    // `dom` mode does no extraction-time flattening, so every wrapper is a
    // generic the serializer drops — the indent must close up behind each one.
    document.body.innerHTML = `<main><div><span><button>Save</button></span></div></main>`;
    expect(serializeTree(document.body, { mode: "dom" })).toBe(
      ["main", '  button "Save"'].join("\n"),
    );
  });

  it("keeps true nesting intact when generics are included", () => {
    document.body.innerHTML = `<main><div aria-label="Decor"><button>Save</button></div></main>`;
    expect(serializeTree(document.body, { includeGeneric: true })).toBe(
      ["generic", "  main", '    generic "Decor"', '      button "Save"'].join(
        "\n",
      ),
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

  it("redacts EVERY occurrence in a name, not just the first", () => {
    // Regression: redactText used a plain `.replace`, which replaces only the
    // FIRST match unless the RegExp is global — so a name with two matches of a
    // (natural, non-global) pattern leaked every occurrence after the first.
    document.body.innerHTML = `<button aria-label="Paid $28.50 then $2.00">x</button>`;
    const out = serializeTree(document.body, { redact: [/\$[\d.]+/] });
    expect(out).toContain("Paid [REDACTED] then [REDACTED]");
    expect(out).not.toContain("$28.50");
    expect(out).not.toContain("$2.00");
  });

  it("respects a pattern that is already global", () => {
    document.body.innerHTML = `<button aria-label="a1 b2 c3">x</button>`;
    const out = serializeTree(document.body, { redact: [/\d/g] });
    expect(out).toContain("a[REDACTED] b[REDACTED] c[REDACTED]");
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

describe("focus marker (markFocus)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("marks the focused node in the tree by default", () => {
    document.body.innerHTML = `
      <main>
        <label>Email <input id="e" /></label>
        <button>Sign in</button>
      </main>`;
    document.getElementById("e")!.focus();
    const out = serializeTree(document.body);
    expect(out).toContain('textbox "Email" [focused]');
    expect(out).not.toContain('button "Sign in" [focused]');
  });

  it("omits the marker when nothing is focused", () => {
    document.body.innerHTML = `<main><button>Go</button></main>`;
    expect(serializeTree(document.body)).not.toContain("[focused]");
  });

  it("markFocus:false produces marker-free output even with focus", () => {
    document.body.innerHTML = `<main><input aria-label="Email" id="e" /></main>`;
    document.getElementById("e")!.focus();
    expect(serializeTree(document.body, { markFocus: false })).not.toContain(
      "[focused]",
    );
  });

  it("marks only the focused node among duplicate names", () => {
    document.body.innerHTML = `
      <input aria-label="Email" id="a" />
      <input aria-label="Email" id="b" />`;
    document.getElementById("b")!.focus();
    const out = serializeTree(document.body);
    // Exactly one marker, and it's on the second textbox (document order).
    expect(out.match(/\[focused\]/g)).toHaveLength(1);
    const emailLines = out.split("\n").filter((l) => l.includes('"Email"'));
    expect(emailLines[0]).not.toContain("[focused]");
    expect(emailLines[1]).toContain("[focused]");
  });

  it("keeps the marker after the (level N) suffix on a heading", () => {
    document.body.innerHTML = `<h2 tabindex="-1" id="h">Delete account</h2>`;
    document.getElementById("h")!.focus();
    expect(serializeTree(document.body)).toContain(
      'heading "Delete account" (level 2) [focused]',
    );
  });

  it("marks a focused heading in the outline (modal orientation)", () => {
    document.body.innerHTML = `
      <h1>Dashboard</h1>
      <div role="dialog" aria-label="Confirm">
        <h2 tabindex="-1" id="h">Delete account</h2>
      </div>`;
    document.getElementById("h")!.focus();
    const out = serializeOutline(document.body);
    expect(out).toContain("h2 Delete account [focused]");
    expect(out).not.toContain("h1 Dashboard [focused]");
  });

  it("marks the focused stop in the tab sequence", () => {
    document.body.innerHTML = `<a href="#a">Home</a><button id="g">Go</button>`;
    document.getElementById("g")!.focus();
    const out = serializeTabSequence(document.body);
    expect(out).toContain('button "Go" [focused]');
    expect(out).not.toContain('link "Home" [focused]');
  });
});
