import type { Finding } from "@real-a11y-dev/audit";
import { describe, expect, it } from "vitest";

import { fingerprintFindings } from "../fingerprint.js";
import {
  buildArtifact,
  type SnapshotArtifact,
  type SnapshotPage,
  type SnapshotView,
} from "../snapshot-artifact.js";

import { diffArtifacts, noPagesMatched } from "./page-diff.js";

const button: Finding = {
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  role: "button",
  tagName: "button",
  locator: "#save",
};

function page(
  name: string,
  findings: Finding[],
  over: Partial<SnapshotPage> = {},
): SnapshotPage {
  return {
    name,
    url: `http://x/${name}`,
    root: "body",
    status: "ok",
    findings: fingerprintFindings(name, findings),
    tree: "main",
    outline: "",
    tabs: "",
    ...over,
  };
}

function artifact(pages: SnapshotPage[]): SnapshotArtifact {
  return buildArtifact(pages, { toolName: "cli", toolVersion: "0.0.1" });
}

describe("diffArtifacts", () => {
  it("joins pages by name and diffs each pair", () => {
    const base = artifact([page("Home", [button])]);
    const pr = artifact([page("Home", [button, button])]);
    const result = diffArtifacts(base, pr);
    expect(result.summary.new).toBe(1);
    expect(result.pages[0].status).toBe("ok");
  });

  it("treats a page only in the PR as added (all new)", () => {
    const base = artifact([page("Home", [])]);
    const pr = artifact([page("Home", []), page("Login", [button])]);
    const result = diffArtifacts(base, pr);
    const login = result.pages.find((p) => p.name === "Login");
    expect(login?.status).toBe("added");
    expect(result.summary.new).toBe(1);
  });

  it("treats a page only in base as removed (all fixed)", () => {
    const base = artifact([page("Home", []), page("Gone", [button])]);
    const pr = artifact([page("Home", [])]);
    const result = diffArtifacts(base, pr);
    const gone = result.pages.find((p) => p.name === "Gone");
    expect(gone?.status).toBe("removed");
    expect(result.summary.removed).toBe(1);
    expect(result.summary.new).toBe(0);
  });

  it("marks a page incomparable when either side errored", () => {
    const base = artifact([page("Home", [button])]);
    const pr = artifact([
      page("Home", [], { status: "error", error: "could not open" }),
    ]);
    const result = diffArtifacts(base, pr);
    expect(result.pages[0].status).toBe("incomparable");
    expect(result.pages[0].note).toContain("could not open");
    // Incomparable pages contribute no new/removed findings.
    expect(result.summary.new).toBe(0);
  });

  it("diffs the structural views for matching pages (tabs stripped of NN.)", () => {
    const base = artifact([page("Home", [], { tabs: "01. link Home" })]);
    const pr = artifact([page("Home", [], { tabs: "01. link Docs" })]);
    const result = diffArtifacts(base, pr);
    // The tab-order number is dropped so a renumber isn't a change.
    expect(result.pages[0].views.tabs.added).toEqual(["link Docs"]);
    expect(result.pages[0].views.tabs.removed).toEqual(["link Home"]);
  });

  it("populates structural on ok pages; [] on added/removed/incomparable", () => {
    const base = artifact([
      page("Home", [], { tree: 'main\n  navigation "Old"' }),
      page("Gone", []),
      page("Down", []),
    ]);
    const pr = artifact([
      page("Home", [], { tree: 'main\n  navigation "New"' }),
      page("Fresh", []),
      page("Down", [], { status: "error", error: "boom" }),
    ]);
    const result = diffArtifacts(base, pr);
    const byName = new Map(result.pages.map((p) => [p.name, p]));
    expect(byName.get("Home")?.structural).toEqual([
      expect.objectContaining({ kind: "landmark-renamed" }),
    ]);
    expect(byName.get("Fresh")?.structural).toEqual([]);
    expect(byName.get("Gone")?.structural).toEqual([]);
    expect(byName.get("Down")?.structural).toEqual([]);
  });

  it("plumbs ignoreViewLine through views AND structural", () => {
    const base = artifact([
      page("Home", [], { tree: 'main\n  time "Last updated: yesterday"' }),
    ]);
    const pr = artifact([
      page("Home", [], { tree: 'main\n  time "Last updated: today"' }),
    ]);
    const noisy = diffArtifacts(base, pr);
    expect(noisy.pages[0].views.tree.added).toHaveLength(1);
    expect(noisy.pages[0].structural).not.toEqual([]);
    const filtered = diffArtifacts(base, pr, {
      ignoreViewLine: [/^time "/],
    });
    expect(filtered.pages[0].views.tree.added).toEqual([]);
    expect(filtered.pages[0].structural).toEqual([]);
  });

  it("a pure tab reorder yields a statement despite empty view diffs", () => {
    const base = artifact([
      page("Home", [], { tabs: '01. link "A"\n02. link "B"' }),
    ]);
    const pr = artifact([
      page("Home", [], { tabs: '01. link "B"\n02. link "A"' }),
    ]);
    const result = diffArtifacts(base, pr);
    expect(result.pages[0].views.tabs).toEqual({ added: [], removed: [] });
    expect(result.pages[0].structural).toEqual([
      expect.objectContaining({ kind: "tab-order-reordered" }),
    ]);
    // The unified diff DOES see the reorder (numbered lines differ) even though
    // the multiset didn't — so the page isn't invisible in neutral output.
    expect(result.pages[0].viewHunks.tabs.length).toBeGreaterThan(0);
  });

  it("builds a per-view unified diff (context + indentation), [] when clean", () => {
    const base = artifact([
      page("Home", [], { tree: 'main\n  link "Home"\n  button "Go"' }),
    ]);
    const pr = artifact([
      page("Home", [], { tree: 'main\n  link "Home"\n  button "Submit"' }),
    ]);
    const hunks = diffArtifacts(base, pr).pages[0].viewHunks;
    expect(hunks.tree).toHaveLength(1);
    expect(hunks.tree[0].lines).toContainEqual({
      tag: "-",
      text: '  button "Go"',
    });
    expect(hunks.tree[0].lines).toContainEqual({
      tag: "+",
      text: '  button "Submit"',
    });
    expect(hunks.outline).toEqual([]);
    // A clean page has no hunks on any view.
    const clean = diffArtifacts(base, base).pages[0].viewHunks;
    expect(clean).toEqual({ tree: [], outline: [], tabs: [] });
  });

  it("--ignore-view-line keeps volatile lines out of the unified diff too", () => {
    const base = artifact([
      page("Home", [], { tree: 'main\n  time "yesterday"\n  link "x"' }),
    ]);
    const pr = artifact([
      page("Home", [], { tree: 'main\n  time "today"\n  link "x"' }),
    ]);
    const filtered = diffArtifacts(base, pr, { ignoreViewLine: [/^time "/] });
    expect(filtered.pages[0].viewHunks.tree).toEqual([]);
  });
});

describe("noPagesMatched", () => {
  it("is true when both sides have pages but share no name", () => {
    const base = artifact([page("http://localhost:3000/", [])]);
    const pr = artifact([page("http://localhost:4173/", [])]);
    expect(noPagesMatched(base, pr)).toBe(true);
    // The diff still runs — it just compares nothing.
    const result = diffArtifacts(base, pr);
    expect(result.pages.map((p) => p.status)).toEqual(["added", "removed"]);
  });

  it("is false when at least one name is on both sides", () => {
    const base = artifact([page("Home", []), page("Gone", [])]);
    const pr = artifact([page("Home", []), page("New", [])]);
    expect(noPagesMatched(base, pr)).toBe(false);
  });

  it("is false when either side has no pages — nothing to match against", () => {
    const empty = artifact([]);
    const home = artifact([page("Home", [])]);
    expect(noPagesMatched(empty, home)).toBe(false);
    expect(noPagesMatched(home, empty)).toBe(false);
    expect(noPagesMatched(empty, empty)).toBe(false);
  });
});

describe("an unmeasured view is skipped, not read as emptied", () => {
  /** A DOM-era artifact: three tab stops, and no `meta.views` at all. */
  const domEra = () =>
    artifact([
      page("Home", [], { tabs: 'link "Home"\nbutton "Save"\nlink "Docs"' }),
    ]);
  /** A native artifact: same page, no tabs view, and it says so. */
  const native = () =>
    buildArtifact([page("Home", [], { tabs: undefined })], {
      toolName: "cli",
      toolVersion: "0.0.1",
      views: ["tree", "outline"],
    });

  it("reports NO tab-stop removals across a producer migration", () => {
    // The failure this guards: base has N stops, PR measured none, and every
    // stop reads as removed — "Keyboard tab stop removed" per focusable
    // element, per page, on an upgrade where nothing about the page changed.
    const result = diffArtifacts(domEra(), native());
    const p = result.pages[0];
    expect(p.views.tabs).toEqual({ added: [], removed: [] });
    expect(p.viewHunks.tabs).toEqual([]);
    expect(p.structural.map((s) => s.kind)).not.toContain("focus-stop-removed");
    expect(p.structural.map((s) => s.kind)).not.toContain("tabs-emptied");
  });

  it("names the skipped axis, so silence isn't read as 'tab order is fine'", () => {
    expect(diffArtifacts(domEra(), native()).skippedViews).toEqual(["tabs"]);
  });

  it("skips it in either direction — an old PR against a new base too", () => {
    expect(diffArtifacts(native(), domEra()).skippedViews).toEqual(["tabs"]);
    expect(diffArtifacts(native(), native()).skippedViews).toEqual(["tabs"]);
  });

  it("compares tab order normally when both sides measured it", () => {
    const base = domEra();
    const pr = artifact([
      page("Home", [], { tabs: 'link "Home"\nlink "Docs"' }),
    ]);
    const result = diffArtifacts(base, pr);
    expect(result.skippedViews).toEqual([]);
    expect(result.pages[0].views.tabs.removed).toContain('button "Save"');
    expect(result.pages[0].structural.map((s) => s.kind)).toContain(
      "focus-stop-removed",
    );
  });

  it("still reports the emptied-view sentinel when tab order WAS measured", () => {
    // The alarm must stay loud for the real case: a page that genuinely lost
    // every one of its tab stops.
    const pr = artifact([page("Home", [], { tabs: "(nothing focusable)" })]);
    const result = diffArtifacts(domEra(), pr);
    expect(result.skippedViews).toEqual([]);
    expect(result.pages[0].structural.map((s) => s.kind)).toContain(
      "tabs-emptied",
    );
  });

  it("leaves the tree and outline axes fully compared", () => {
    // Skipping is per-axis: losing tab order must not blind the other views.
    const base = native();
    const pr = buildArtifact(
      [page("Home", [], { tabs: undefined, tree: "main\n  button" })],
      { toolName: "cli", toolVersion: "0.0.1", views: ["tree", "outline"] },
    );
    const result = diffArtifacts(base, pr);
    expect(result.pages[0].views.tree.added).toContain("button");
    expect(result.pages[0].viewHunks.tree.length).toBeGreaterThan(0);
  });
});

describe("skippedViews is honest about every axis, not just tabs", () => {
  /** An artifact declaring an arbitrary measured subset. */
  const withViews = (views: SnapshotView[], over: Partial<SnapshotPage> = {}) =>
    buildArtifact(
      [page("Home", [], { tree: "main", outline: "h1 A", ...over })],
      {
        toolName: "cli",
        toolVersion: "0.0.1",
        views,
      },
    );

  it("skips an unmeasured outline instead of diffing it anyway", () => {
    // Only `tabs` can go unmeasured today, so this is latent rather than live —
    // but `meta.views` is a general list. Naming an axis in `skippedViews`
    // while still comparing it would be the same lie, one view over.
    const base = withViews(["tree", "outline", "tabs"], { outline: "h1 A" });
    const pr = withViews(["tree", "tabs"], { outline: "h1 TOTALLY DIFFERENT" });
    const result = diffArtifacts(base, pr);
    expect(result.skippedViews).toEqual(["outline"]);
    // …and it really wasn't compared.
    expect(result.pages[0].views.outline).toEqual({ added: [], removed: [] });
    expect(result.pages[0].viewHunks.outline).toEqual([]);
  });

  it("still compares the axes both sides did measure", () => {
    const base = withViews(["tree", "tabs"], { tree: "main" });
    const pr = withViews(["tree", "tabs"], { tree: "main\n  button" });
    const result = diffArtifacts(base, pr);
    expect(result.skippedViews).toEqual(["outline"]);
    expect(result.pages[0].views.tree.added).toContain("button");
  });
});
