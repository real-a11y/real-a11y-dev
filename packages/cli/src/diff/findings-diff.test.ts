import type { Finding } from "@real-a11y-dev/testing";
import { describe, expect, it } from "vitest";

import { fingerprintFindings } from "../fingerprint.js";
import { diffFindings, summarize, type DiffEntry } from "./findings-diff.js";

const button = (over: Partial<Finding> = {}): Finding => ({
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  role: "button",
  tagName: "button",
  locator: "body > main > button",
  context: "in <main>",
  ...over,
});

const doc = (message: string, over: Partial<Finding> = {}): Finding => ({
  rule: "landmark-structure",
  severity: "warning",
  message,
  ...over,
});

/** Fingerprint both sides under the same page, then diff. */
function diff(base: Finding[], pr: Finding[]): DiffEntry[] {
  return diffFindings(
    fingerprintFindings("Home", base),
    fingerprintFindings("Home", pr),
  );
}

describe("diffFindings — tier 1 (exact)", () => {
  it("classifies identical findings as unchanged", () => {
    const entries = diff(
      [button(), button({ role: "link" })],
      [button(), button({ role: "link" })],
    );
    expect(summarize(entries)).toMatchObject({
      new: 0,
      removed: 0,
      changed: 0,
    });
  });

  it("a finding only in the PR is NEW; only in base is REMOVED", () => {
    expect(summarize(diff([], [button()]))).toMatchObject({ new: 1 });
    expect(summarize(diff([button()], []))).toMatchObject({ removed: 1 });
  });

  it("is churn-stable: a re-numbered :nth-of-type locator stays unchanged", () => {
    const entries = diff(
      [button({ locator: "body > main > button:nth-of-type(1)" })],
      [button({ locator: "body > main > button:nth-of-type(3)" })],
    );
    expect(summarize(entries)).toMatchObject({ unchanged: 1, new: 0 });
  });

  it("an inserted duplicate sibling reads as one NEW, not all-changed", () => {
    // Base: one unlabeled button. PR: two identical ones.
    const entries = diff([button()], [button(), button()]);
    const s = summarize(entries);
    expect(s.new).toBe(1);
    expect(s.unchanged).toBe(1);
    expect(s.removed).toBe(0);
  });
});

describe("diffFindings — tier 2 (fuzzy)", () => {
  it("a changed tag on the same element reads as CHANGED, not new+removed", () => {
    const entries = diff(
      [button()],
      [
        button({
          tagName: "a",
          message: "Unlabeled interactive element: button <a>",
        }),
      ],
    );
    const s = summarize(entries);
    expect(s.changed).toBe(1);
    expect(s.new).toBe(0);
    expect(s.removed).toBe(0);
    const changed = entries.find((e) => e.kind === "changed");
    expect(changed?.changes?.some((c) => /tag <button> → <a>/.test(c))).toBe(
      true,
    );
  });

  it("two unrelated buttons with different locators don't pair (new + removed)", () => {
    const entries = diff(
      [button({ locator: "#save", context: undefined })],
      [button({ locator: "#cancel", context: undefined })],
    );
    const s = summarize(entries);
    expect(s.new).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.changed).toBe(0);
  });

  it("context alone can't pair two different-id buttons below threshold", () => {
    // Different bare #id → locatorSim 0; tag equal → 0.5; context equal → 1;
    // total 1.5 < 2, so they stay new + removed.
    const entries = diff(
      [button({ locator: "#a" })],
      [button({ locator: "#b" })],
    );
    expect(summarize(entries)).toMatchObject({ new: 1, removed: 1 });
  });
});

describe("diffFindings — doc-scoped findings", () => {
  it("a changed count on a doc finding reads as CHANGED", () => {
    const entries = diff(
      [doc("Expected exactly one <main> landmark, found 2.")],
      [doc("Expected exactly one <main> landmark, found 3.")],
    );
    expect(summarize(entries)).toMatchObject({ changed: 1, new: 0 });
    const changed = entries.find((e) => e.kind === "changed");
    expect(changed?.changes?.some((c) => /found 2.*found 3/.test(c))).toBe(
      true,
    );
  });

  it("distinguishes skipped-level findings by heading name (not one CHANGED)", () => {
    const entries = diff(
      [
        doc('Heading level skipped: "Details" is h4…', {
          rule: "heading-order",
          name: "Details",
        }),
      ],
      [
        doc('Heading level skipped: "Pricing" is h4…', {
          rule: "heading-order",
          name: "Pricing",
        }),
      ],
    );
    expect(summarize(entries)).toMatchObject({
      new: 1,
      removed: 1,
      changed: 0,
    });
  });

  it("re-occurring skipped-level (occ shift) matches by kind+name", () => {
    // Same skipped-level name, but a sibling insert bumped its occ — tier 2
    // pairs them by (kind, name), so it's not new+removed.
    const base = fingerprintFindings("Home", [
      doc('Heading level skipped: "X"', { rule: "heading-order", name: "X" }),
    ]);
    const pr = fingerprintFindings("Home", [
      doc("unrelated", { rule: "heading-order", name: "Y" }),
      doc('Heading level skipped: "X"', { rule: "heading-order", name: "X" }),
    ]);
    // The "X" findings share a fingerprint (occ 0 both) → tier 1 unchanged.
    const s = summarize(diffFindings(base, pr));
    expect(s.unchanged).toBe(1);
    expect(s.new).toBe(1); // the "Y" finding
  });
});

describe("determinism", () => {
  it("produces the same classification regardless of input order stability", () => {
    const a = diff([button(), button({ role: "link" })], [button()]);
    const b = diff([button({ role: "link" }), button()], [button()]);
    expect(summarize(a)).toEqual(summarize(b));
  });
});
