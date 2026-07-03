import { describe, it, expect } from "vitest";

import { buildExportMarkdown } from "./export.js";

const META = {
  pageTitle: "Sign in",
  pageUrl: "https://example.com/login",
  capturedAt: "2026-06-27T10:00:00.000Z",
  extensionVersion: "0.1.4",
  viewLabel: "Accessibility tree",
};

const VIEWS = {
  tree: 'main\n  heading "Sign in" (level 1)\n  button "Go"',
  outline: "h1 Sign in",
  tabSequence: '01. button "Go"',
};

describe("buildExportMarkdown", () => {
  it("includes a metadata header with title, url, and tool version", () => {
    const md = buildExportMarkdown(VIEWS, META);
    expect(md).toContain("# Accessibility report — Sign in");
    expect(md).toContain("**URL:** https://example.com/login");
    expect(md).toContain("**Captured:** 2026-06-27T10:00:00.000Z");
    expect(md).toContain("Semantic Navigator 0.1.4");
  });

  it("labels the tree section by the current view", () => {
    expect(buildExportMarkdown(VIEWS, META)).toContain("## Accessibility tree");
    expect(
      buildExportMarkdown(VIEWS, { ...META, viewLabel: "DOM tree" }),
    ).toContain("## DOM tree");
  });

  it("emits all views by default, in canonical order", () => {
    const md = buildExportMarkdown(VIEWS, META);
    const headings = [
      "## Accessibility tree",
      "## Heading outline",
      "## Tab sequence",
    ];
    for (const h of headings) expect(md).toContain(h);
    const positions = headings.map((h) => md.indexOf(h));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("emits only the selected view when a subset is given", () => {
    const md = buildExportMarkdown(VIEWS, META, ["outline"]);
    expect(md).toContain("## Heading outline");
    expect(md).not.toContain("## Accessibility tree");
    expect(md).not.toContain("## Tab sequence");
    expect(md).toContain("# Accessibility report — Sign in"); // header always present
  });

  it("adds a Scope line only when scoped", () => {
    expect(buildExportMarkdown(VIEWS, META)).not.toContain("**Scope:**");
    expect(
      buildExportMarkdown(VIEWS, { ...META, scope: 'banner "Top"' }),
    ).toContain('- **Scope:** banner "Top"');
  });

  it("falls back to the URL when the page has no title", () => {
    const md = buildExportMarkdown(VIEWS, { ...META, pageTitle: "" });
    expect(md).toContain("# Accessibility report — https://example.com/login");
  });

  it("renders (empty) for a view with no content", () => {
    const md = buildExportMarkdown({ ...VIEWS, outline: "" }, META, [
      "outline",
    ]);
    expect(md).toMatch(/## Heading outline\n\n```\n\(empty\)\n```/);
  });
});
