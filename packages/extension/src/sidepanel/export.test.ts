import { describe, it, expect } from "vitest";

import { ALL_VIEWS, buildExportMarkdown, exportViewsFor } from "./export.js";

import type { ExportMeta } from "./export.js";

const META: ExportMeta = {
  producer: "native",
  pageTitle: "Sign in",
  pageUrl: "https://example.com/login",
  capturedAt: "2026-06-27T10:00:00.000Z",
  extensionVersion: "0.1.4",
  viewLabel: "Native accessibility tree",
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

  it("names the producer that built the tree", () => {
    expect(buildExportMarkdown(VIEWS, META, ["tree", "outline"])).toContain(
      "- **Producer:** native (Chromium's own accessibility tree)",
    );
    // Even a headings-only export says which producer it came from.
    expect(buildExportMarkdown(VIEWS, META, ["outline"])).toContain(
      "**Producer:** native",
    );
  });

  it("says the tab sequence is the page's own walk's, in a report of Chrome's tree", () => {
    // The header names one producer, and Chrome's tree has no tab order: the
    // tab sequence comes from the content script's walk, and says so where
    // it starts.
    const md = buildExportMarkdown(VIEWS, META);
    const tabs = md.slice(md.indexOf("## Tab sequence"));
    expect(tabs).toMatch(
      /^## Tab sequence\n\n\*\*Producer:\*\* dom \(the extension's own in-page walk\)\n\n```/,
    );
    // Once: the tree's sections are Chrome's, as the header says.
    expect(md.match(/Producer:\*\* dom/g)).toHaveLength(1);
  });

  it("names the walk in the header of a report of the tab sequence alone", () => {
    const md = buildExportMarkdown(VIEWS, { ...META, producer: "dom" }, [
      "tab",
    ]);
    expect(md).toContain(
      "- **Producer:** dom (the extension's own in-page walk)",
    );
    // The header already says it: the section doesn't again.
    expect(md).toMatch(/## Tab sequence\n\n```/);
  });

  it("labels the tree section by the current view", () => {
    expect(buildExportMarkdown(VIEWS, META)).toContain(
      "## Native accessibility tree",
    );
  });

  it("emits all views by default, in canonical order", () => {
    const md = buildExportMarkdown(VIEWS, META);
    const headings = [
      "## Native accessibility tree",
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
    expect(md).not.toContain("## Native accessibility tree");
    expect(md).not.toContain("## Tab sequence");
    expect(md).toContain("# Accessibility report — Sign in"); // header always present
  });

  it("says the tab sequence is the whole page's when the tree is scoped", () => {
    const views = { ...VIEWS, tabSequence: '01. button "Go"' };
    const scoped = buildExportMarkdown(views, {
      ...META,
      scope: 'banner "Top"',
    });
    const tab = scoped.slice(scoped.indexOf("## Tab sequence"));
    expect(tab).toContain("**Scope:** the whole page");
    expect(scoped.slice(0, scoped.indexOf("## Tab sequence"))).not.toContain(
      "the whole page",
    );
    expect(buildExportMarkdown(views, META)).not.toContain("the whole page");
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

describe("exportViewsFor", () => {
  it("offers the tab sequence only while the TAB view shows it", () => {
    // Chrome's tree has no tab order, and the page sends its whole walk only
    // while TAB shows: rendering an empty sequence as "(nothing focusable)"
    // would misreport a missing capability as a finding.
    expect(exportViewsFor(true, true)).toEqual(ALL_VIEWS);
    expect(exportViewsFor(true, false)).toEqual(["tree", "outline"]);
  });

  it("offers the tab sequence alone where Chrome's tree couldn't be read", () => {
    expect(exportViewsFor(false, true)).toEqual(["tab"]);
    expect(exportViewsFor(false, false)).toEqual([]);
  });

  it("never renders a Tab sequence section when used as the selection", () => {
    const md = buildExportMarkdown(VIEWS, META, exportViewsFor(true, false));
    expect(md).not.toContain("## Tab sequence");
    expect(md).toContain("## Native accessibility tree");
    expect(md).toContain("## Heading outline");
  });
});
