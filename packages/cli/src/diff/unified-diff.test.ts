import { describe, expect, it } from "vitest";

import { hunkHeader, hunkLineCount, unifiedDiff } from "./unified-diff.js";

/** Render a hunk to the familiar unified-diff text for compact assertions. */
function render(base: string, pr: string, context?: number): string {
  return unifiedDiff(base, pr, context)
    .map((h) =>
      [hunkHeader(h), ...h.lines.map((l) => `${l.tag}${l.text}`)].join("\n"),
    )
    .join("\n--\n");
}

describe("unifiedDiff", () => {
  it("returns no hunks for identical text", () => {
    expect(unifiedDiff("a\nb\nc", "a\nb\nc")).toEqual([]);
    expect(unifiedDiff("", "")).toEqual([]);
  });

  it("surrounds a change with context on both sides", () => {
    const base = "a\nb\nc\nd\ne\nf\ng";
    const pr = "a\nb\nc\nX\ne\nf\ng";
    expect(render(base, pr, 2)).toBe(
      ["@@ -2,5 +2,5 @@", " b", " c", "-d", "+X", " e", " f"].join("\n"),
    );
  });

  it("preserves indentation (the tag is column 0, the line keeps its own spaces)", () => {
    const base = 'main\n  heading "Setup" (level 2)\n  link "Home"';
    const pr = 'main\n  heading "Setup" (level 3)\n  link "Home"';
    const out = render(base, pr, 3);
    expect(out).toContain('-  heading "Setup" (level 2)');
    expect(out).toContain('+  heading "Setup" (level 3)');
    expect(out).toContain(" main");
    expect(out).toContain('   link "Home"'); // context line: " " tag + "  link"
  });

  it("emits ONE hunk when two changes are within 2·context", () => {
    // changes at index 1 and 4, 2 equal lines between; 2 <= 2*context(3).
    const base = "a\nb\nc\nd\ne\nf";
    const pr = "a\nB\nc\nd\nE\nf";
    expect(unifiedDiff(base, pr, 3)).toHaveLength(1);
  });

  it("splits into TWO hunks when changes are far apart", () => {
    const base = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj";
    const pr = "A\nb\nc\nd\ne\nf\ng\nh\ni\nJ";
    const hunks = unifiedDiff(base, pr, 2);
    expect(hunks).toHaveLength(2);
    // First hunk starts at line 1, last hunk ends at line 10.
    expect(hunks[0].lines[0]).toEqual({ tag: "-", text: "a" });
    expect(hunks[1].lines.at(-1)).toEqual({ tag: "+", text: "J" });
  });

  it("computes @@ line numbers (git omits ,len when it is 1)", () => {
    // Pure insertion at the top: base range is 0 length at line 0.
    const h = unifiedDiff("a\nb", "x\na\nb", 3);
    expect(hunkHeader(h[0])).toBe("@@ -1,2 +1,3 @@");
    const single = unifiedDiff("a", "a\nb", 3);
    expect(hunkHeader(single[0])).toBe("@@ -1 +1,2 @@");
  });

  it("handles a whole side being empty (sentinel ↔ content)", () => {
    const gained = render("(no headings)", "h1 Intro\nh2 Setup");
    expect(gained).toContain("-(no headings)");
    expect(gained).toContain("+h1 Intro");
    expect(gained).toContain("+h2 Setup");
  });

  it("a name containing @@ or backticks is just a line, not a header", () => {
    const out = render('code "@@ x"', 'code "@@ y"');
    // The literal @@ line is content (has a -/+ tag), our header starts with @@.
    expect(out).toContain('-code "@@ x"');
    expect(out).toContain('+code "@@ y"');
  });

  it("hunkLineCount counts header + body lines", () => {
    const hunks = unifiedDiff("a\nb\nc\nd\ne", "a\nb\nX\nd\ne", 1);
    // one hunk: header + (context b, -c, +X, context d) = 1 + 4
    expect(hunkLineCount(hunks)).toBe(hunkLineCount(hunks));
    expect(hunkLineCount(hunks)).toBe(5);
  });

  it("is deterministic — same inputs, same hunks", () => {
    const a = "a\nb\nc\nd";
    const b = "a\nX\nc\nY";
    expect(JSON.stringify(unifiedDiff(a, b))).toBe(
      JSON.stringify(unifiedDiff(a, b)),
    );
  });
});
