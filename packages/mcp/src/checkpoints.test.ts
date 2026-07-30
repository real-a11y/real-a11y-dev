import type { Finding } from "@real-a11y-dev/audit";
import { buildSnapshotPage, type SnapshotPage } from "@real-a11y-dev/snapshot";
import { describe, expect, it } from "vitest";

import {
  CheckpointStore,
  differentUrl,
  diffCheckpointPages,
  diffLabeledCheckpoints,
  renderDiff,
} from "./checkpoints.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  role: "button",
  tagName: "BUTTON",
  locator: "#save",
  ...over,
});

const page = (
  name: string,
  findings: Finding[],
  tree = "button",
  url = "https://example.com/",
): SnapshotPage =>
  buildSnapshotPage(
    name,
    url,
    {
      findings,
      tree,
      outline: "(no headings)",
      tabOrder: "1. button",
    },
    { root: "body" },
  );

const at = (url: string) => page("home", [finding()], "button", url);

describe("CheckpointStore", () => {
  it("evicts the least-recently-saved when over capacity", () => {
    const store = new CheckpointStore<SnapshotPage>(2);
    store.save("a", page("a", []));
    store.save("b", page("b", []));
    store.save("c", page("c", [])); // evicts "a"
    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(true);
    expect(store.has("c")).toBe(true);
    expect(store.size).toBe(2);
  });

  it("re-saving a name refreshes its recency", () => {
    const store = new CheckpointStore<SnapshotPage>(2);
    store.save("a", page("a", []));
    store.save("b", page("b", []));
    store.save("a", page("a", [])); // "a" is now newest
    store.save("c", page("c", [])); // evicts "b" (now oldest), not "a"
    expect(store.has("a")).toBe(true);
    expect(store.has("b")).toBe(false);
  });

  it("clear() empties the store", () => {
    const store = new CheckpointStore<SnapshotPage>();
    store.save("a", page("a", []));
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe("diffLabeledCheckpoints", () => {
  it("matches the same finding across differently-LABELED checkpoints", () => {
    // Two checkpoints of the same page saved under different labels. `page` is
    // part of the v1 fingerprint, so a naive diff would read the identical
    // finding as removed+new. Re-fingerprinting under one name must fix that.
    const before = page("before", [finding()]);
    const after = page("after", [finding()]);
    const diff = diffLabeledCheckpoints(before, after);
    expect(diff.summary.new).toBe(0);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.unchanged).toBe(1);
  });

  it("still surfaces a genuinely new finding", () => {
    const before = page("before", [finding()]);
    const after = page("after", [finding(), finding({ locator: "#cancel" })]);
    const diff = diffLabeledCheckpoints(before, after);
    expect(diff.summary.new).toBe(1);
    expect(diff.summary.unchanged).toBe(1);
  });
});

describe("renderDiff", () => {
  it("reports no change when nothing differs", () => {
    const p = page("home", [finding()]);
    expect(renderDiff(diffCheckpointPages(p, p))).toMatch(
      /No accessibility findings changed/,
    );
  });

  it("lists a NEW finding and flags it as gating", () => {
    const before = page("home", [finding()]);
    const after = page("home", [finding(), finding({ locator: "#cancel" })]);
    const out = renderDiff(diffCheckpointPages(before, after));
    expect(out).toMatch(/1 new/);
    expect(out).toMatch(/NEW — gates CI/);
  });

  it("still reports structural changes when no findings changed", () => {
    // A deploy can reshuffle the page without adding a finding — the advisory
    // structural summary is the whole signal there, so it must not be skipped.
    const before = page("home", [finding()], "button");
    const after = page("home", [finding()], 'button\nlink "Docs"');
    const out = renderDiff(diffCheckpointPages(before, after));
    expect(out).toMatch(/0 new, 0 fixed/);
    expect(out).toMatch(/structure did/);
    expect(out).toMatch(/Structural changes/);
  });

  it("reports a FIXED finding", () => {
    const before = page("home", [finding()]);
    const after = page("home", []);
    const out = renderDiff(diffCheckpointPages(before, after));
    expect(out).toMatch(/1 fixed/);
    expect(out).toMatch(/FIXED/);
  });
});

describe("differentUrl", () => {
  it("ignores the origin — the cross-deploy diff is the documented workflow", () => {
    // staging → prod, localhost:3000 → :3001, http → https. `SnapshotPage.name`
    // is the join key precisely because "host/port legitimately differ", so a
    // structural summary across these two is the whole point of the tool.
    expect(
      differentUrl(
        at("https://staging.example.com/pricing"),
        at("https://example.com/pricing"),
      ),
    ).toBeUndefined();
    expect(
      differentUrl(
        at("http://localhost:3000/a"),
        at("http://localhost:3001/a"),
      ),
    ).toBeUndefined();
  });

  it("flags a different path, and reports both addresses", () => {
    expect(
      differentUrl(
        at("https://example.com/pricing"),
        at("https://example.com/careers"),
      ),
    ).toEqual({
      from: "https://example.com/pricing",
      to: "https://example.com/careers",
    });
  });

  it("treats a trailing slash as the same page", () => {
    expect(
      differentUrl(
        at("https://example.com/pricing"),
        at("https://example.com/pricing/"),
      ),
    ).toBeUndefined();
  });

  it("counts query and fragment — they select content within a route", () => {
    expect(
      differentUrl(
        at("https://example.com/search?q=cats"),
        at("https://example.com/search?q=dogs"),
      ),
    ).toBeDefined();
    // Hash routing: the fragment IS the route in a hash-router SPA.
    expect(
      differentUrl(
        at("https://example.com/#/pricing"),
        at("https://example.com/#/careers"),
      ),
    ).toBeDefined();
  });

  it("never claims a mismatch it can't show", () => {
    // `redactUrl` passes non-URLs through as sanitized text, so a page's `url`
    // is not guaranteed parseable. Suppressing a section on a guess is worse
    // than printing a noisy one, so an unknown address is never a mismatch.
    expect(
      differentUrl(at("not a url"), at("https://example.com/")),
    ).toBeUndefined();
    expect(differentUrl(at(""), at("https://example.com/"))).toBeUndefined();
    expect(differentUrl(at(""), at(""))).toBeUndefined();
  });
});

describe("renderDiff across two different pages", () => {
  // Same page content on both sides except the tree, so structural churn is
  // guaranteed — the section would print if it weren't suppressed.
  const before = page("home", [finding()], "button", "https://example.com/a");
  const after = page(
    "home",
    [finding()],
    'button\nlink "Docs"\nheading "Careers"',
    "https://example.com/b",
  );
  const differing = differentUrl(before, after);
  const out = renderDiff(diffCheckpointPages(before, after), {
    differentUrl: differing,
  });

  it("suppresses the structural summary and says why", () => {
    expect(out).not.toMatch(/Structural changes/);
    expect(out).toMatch(/different page/);
    expect(out).toMatch(/suppressed/);
  });

  it("names both addresses so the agent can see the mistake", () => {
    expect(out).toContain("https://example.com/a");
    expect(out).toContain("https://example.com/b");
  });

  it("still diffs findings — fingerprints don't depend on position", () => {
    expect(out).toMatch(/0 new, 0 fixed/);
    expect(out).toMatch(/Findings are still matched by fingerprint/);
  });

  it("does not announce structure it then fails to print", () => {
    // The bug this guards: `structuralChanged` ignoring the suppression would
    // leave the "but the structure did:" lead-in with nothing under it.
    expect(out).not.toMatch(/structure did/);
    expect(out).toMatch(/No accessibility findings changed\./);
  });

  it("keeps the summary when the pages ARE the same route", () => {
    const sameRoute = page(
      "home",
      [finding()],
      'button\nlink "Docs"',
      "https://staging.example.com/a",
    );
    const out = renderDiff(diffCheckpointPages(before, sameRoute), {
      differentUrl: differentUrl(before, sameRoute),
    });
    expect(out).toMatch(/Structural changes/);
    expect(out).not.toMatch(/different page/);
  });
});
