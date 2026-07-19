import type { Finding } from "@real-a11y-dev/audit";
import { buildSnapshotPage, type SnapshotPage } from "@real-a11y-dev/snapshot";
import { describe, expect, it } from "vitest";

import {
  CheckpointStore,
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

const page = (name: string, findings: Finding[]): SnapshotPage =>
  buildSnapshotPage(
    name,
    "https://example.com/",
    {
      findings,
      tree: "button",
      outline: "(no headings)",
      tabOrder: "1. button",
    },
    { root: "body" },
  );

describe("CheckpointStore", () => {
  it("evicts the least-recently-saved when over capacity", () => {
    const store = new CheckpointStore(2);
    store.save("a", page("a", []));
    store.save("b", page("b", []));
    store.save("c", page("c", [])); // evicts "a"
    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(true);
    expect(store.has("c")).toBe(true);
    expect(store.size).toBe(2);
  });

  it("re-saving a name refreshes its recency", () => {
    const store = new CheckpointStore(2);
    store.save("a", page("a", []));
    store.save("b", page("b", []));
    store.save("a", page("a", [])); // "a" is now newest
    store.save("c", page("c", [])); // evicts "b" (now oldest), not "a"
    expect(store.has("a")).toBe(true);
    expect(store.has("b")).toBe(false);
  });

  it("clear() empties the store", () => {
    const store = new CheckpointStore();
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

  it("reports a FIXED finding", () => {
    const before = page("home", [finding()]);
    const after = page("home", []);
    const out = renderDiff(diffCheckpointPages(before, after));
    expect(out).toMatch(/1 fixed/);
    expect(out).toMatch(/FIXED/);
  });
});
