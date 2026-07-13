import type { Finding } from "@real-a11y-dev/testing";
import { describe, expect, it } from "vitest";

import { fingerprintFindings } from "../fingerprint.js";
import {
  buildArtifact,
  type SnapshotArtifact,
  type SnapshotPage,
} from "../snapshot-artifact.js";

import { diffArtifacts } from "./page-diff.js";

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
